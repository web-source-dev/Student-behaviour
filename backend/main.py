from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Dict, List, Optional, Set
import uvicorn
import json
import uuid
import os
from datetime import datetime
import asyncio
import config

# For behavior detection
import cv2
import numpy as np
from PIL import Image
import io
import time

# For Agora token generation
from agora_token_builder import RtcTokenBuilder

app = FastAPI(title="Student Behavior Detection API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage - In production, use a database
active_rooms = {}
connected_clients: Dict[str, Set[WebSocket]] = {}
behavior_data: Dict[str, List[Dict]] = {}

# Behavior detection models - Load at startup
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, channel: str):
        await websocket.accept()
        if channel not in self.active_connections:
            self.active_connections[channel] = []
        self.active_connections[channel].append(websocket)

    def disconnect(self, websocket: WebSocket, channel: str):
        if channel in self.active_connections:
            if websocket in self.active_connections[channel]:
                self.active_connections[channel].remove(websocket)

    async def broadcast_to_channel(self, message: str, channel: str):
        if channel in self.active_connections:
            for connection in self.active_connections[channel]:
                await connection.send_text(message)

manager = ConnectionManager()

# Request body parser middleware
@app.middleware("http")
async def parse_json_body(request: Request, call_next):
    if request.method in ["POST", "PUT", "PATCH"] and request.headers.get("content-type") == "application/json":
        try:
            request.state.json_body = await request.json()
        except json.JSONDecodeError:
            request.state.json_body = {}
    else:
        request.state.json_body = {}
    
    return await call_next(request)

# Room APIs
@app.post("/api/rooms")
async def create_room(request: Request):
    data = request.state.json_body
    room_id = str(uuid.uuid4())[:8]  # Generate a shorter room ID
    expiration_time = 24 * 3600  # 24 hours in seconds
    
    # Store room info
    active_rooms[room_id] = {
        "name": data.get("name", f"Room {room_id}"),
        "created_at": datetime.now().isoformat(),
        "host_uid": None,
        "participants": {}
    }
    
    # Initialize behavior data for this room
    behavior_data[room_id] = []
    
    return {"roomId": room_id}

@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str):
    if room_id not in active_rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    return {
        "name": active_rooms[room_id]["name"],
        "appId": config.AGORA_APP_ID,
        "participants": len(active_rooms[room_id]["participants"])
    }

@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, request: Request):
    data = request.state.json_body
    
    if room_id not in active_rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    user_id = data.get("userId")
    username = data.get("username", f"User {user_id}")
    
    # First user is the host
    is_host = len(active_rooms[room_id]["participants"]) == 0
    if is_host:
        active_rooms[room_id]["host_uid"] = user_id
    
    # Generate Agora token
    expiration_time = 24 * 3600  # 24 hours in seconds
    current_timestamp = int(time.time())
    privilege_expired_ts = current_timestamp + expiration_time
    
    token = RtcTokenBuilder.buildTokenWithUid(
        config.AGORA_APP_ID, 
        config.AGORA_APP_CERTIFICATE,
        room_id, 
        user_id, 
        1,  # Role as publisher
        privilege_expired_ts
    )
    
    # Add user to room
    active_rooms[room_id]["participants"][user_id] = {
        "username": username,
        "joined_at": datetime.now().isoformat(),
        "is_host": is_host
    }
    
    return {
        "token": token,
        "isHost": is_host
    }

# Behavior detection APIs
@app.post("/api/behavior/start")
async def start_behavior_detection(request: Request):
    data = request.state.json_body
    channel_name = data.get("channelName")
    host_uid = data.get("uid")
    
    if channel_name not in active_rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Verify if the requester is the host
    if active_rooms[channel_name]["host_uid"] != host_uid:
        raise HTTPException(status_code=403, detail="Only the host can start behavior detection")
    
    return {"status": "Behavior detection started"}

@app.post("/api/behavior/analyze")
async def analyze_behavior(
    frame: UploadFile = File(...),
    userId: str = Form(...),
    channelName: str = Form(...)
):
    # Check if the room exists
    if channelName not in active_rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Read the image
    contents = await frame.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # Convert to grayscale for face detection
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Detect faces
    faces = face_cascade.detectMultiScale(gray, 1.3, 5)
    
    # Initialize behavior analysis result
    behavior_result = {
        "userId": userId,
        "timestamp": datetime.now().isoformat(),
        "behaviors": [],
        "severity": "low"
    }
    
    if len(faces) == 0:
        # No face detected
        behavior_result["behaviors"].append("No face visible")
        behavior_result["severity"] = "medium"
        behavior_result["message"] = "Cannot detect face - student may be away or not visible"
    else:
        # For simplicity, we'll just use the first face detected
        (x, y, w, h) = faces[0]
        face_roi = gray[y:y+h, x:x+w]
        
        # Detect eyes within the face region
        eyes = eye_cascade.detectMultiScale(face_roi)
        
        if len(eyes) < 2:
            # Eyes not clearly visible
            behavior_result["behaviors"].append("Eyes not visible")
            behavior_result["severity"] = "medium"
            behavior_result["message"] = "Cannot detect eyes - student may not be paying attention"
        
        # Add more sophisticated behavior detection here
        # For demo purposes, we're using simple face/eye detection
        # In a real system, you would use more advanced AI models
        
        # Simulate some random behaviors for demonstration
        if userId != active_rooms[channelName]["host_uid"] and np.random.random() > 0.7:
            behaviors = [
                "Looking away from screen",
                "Talking to someone else",
                "Using phone",
                "Appears distracted"
            ]
            selected_behavior = np.random.choice(behaviors)
            behavior_result["behaviors"].append(selected_behavior)
            behavior_result["severity"] = "high"
            behavior_result["message"] = f"Student appears to be {selected_behavior.lower()}"
    
    # Store the behavior result
    behavior_data[channelName].append(behavior_result)
    
    # If behaviors detected, send an alert through WebSocket
    if behavior_result["behaviors"] and behavior_result["severity"] in ["medium", "high"]:
        alert = {
            "userId": userId,
            "message": behavior_result["message"],
            "severity": behavior_result["severity"],
            "timestamp": behavior_result["timestamp"]
        }
        
        await manager.broadcast_to_channel(
            json.dumps({"type": "behavior_alert", "alert": alert}),
            channelName
        )
    
    return {"status": "Analysis complete"}

# WebSocket endpoint for behavior alerts
@app.websocket("/ws/behavior")
async def behavior_websocket(websocket: WebSocket):
    await websocket.accept()
    channel = None
    
    try:
        # First message should contain the channel name
        data = await websocket.receive_text()
        data = json.loads(data)
        channel = data.get("channel")
        
        if not channel:
            await websocket.close(code=1000)
            return
        
        # Connect to the channel
        await manager.connect(websocket, channel)
        
        # Keep the connection alive
        while True:
            await asyncio.sleep(1)
            
    except WebSocketDisconnect:
        if channel:
            manager.disconnect(websocket, channel)
    except Exception as e:
        print(f"WebSocket error: {e}")
        if channel:
            manager.disconnect(websocket, channel)

if __name__ == "__main__":
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=config.DEBUG) 