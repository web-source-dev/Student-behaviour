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
import random

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
user_analysis_history: Dict[str, List[Dict]] = {}
# Track last reported behavior per user to avoid duplicates
last_reported_behaviors: Dict[str, Dict] = {}
# Timestamps of last alerts sent per user
last_alert_times: Dict[str, float] = {}

# Behavior detection models - Load at startup
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
profile_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.ping_task = None

    async def connect(self, websocket: WebSocket, channel: str):
        if channel not in self.active_connections:
            self.active_connections[channel] = []
        self.active_connections[channel].append(websocket)
        print(f"WebSocket client connected to channel {channel}. Total clients: {len(self.active_connections[channel])}")

    def disconnect(self, websocket: WebSocket, channel: str):
        if channel in self.active_connections:
            if websocket in self.active_connections[channel]:
                self.active_connections[channel].remove(websocket)
                print(f"WebSocket client disconnected from channel {channel}. Remaining clients: {len(self.active_connections[channel])}")

    async def broadcast_to_channel(self, message: str, channel: str):
        if channel in self.active_connections:
            disconnected_websockets = []
            
            for connection in self.active_connections[channel]:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    print(f"Error sending message to websocket: {e}")
                    disconnected_websockets.append(connection)
            
            # Clean up disconnected websockets
            for disconnected in disconnected_websockets:
                self.disconnect(disconnected, channel)
                
    async def start_ping(self):
        """Start sending periodic pings to keep connections alive"""
        while True:
            await asyncio.sleep(30)  # Send ping every 30 seconds
            for channel, connections in self.active_connections.items():
                disconnected_websockets = []
                for connection in connections:
                    try:
                        await connection.send_text(json.dumps({"type": "ping"}))
                    except Exception as e:
                        print(f"Error sending ping: {e}")
                        disconnected_websockets.append(connection)
                
                # Clean up disconnected websockets
                for disconnected in disconnected_websockets:
                    self.disconnect(disconnected, channel)

manager = ConnectionManager()

# Start the ping task when the app starts
@app.on_event("startup")
async def startup_event():
    # Start the ping task in the background
    asyncio.create_task(manager.start_ping())

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
    
    # Initialize user's analysis history
    user_key = f"{room_id}_{user_id}"
    user_analysis_history[user_key] = []
    
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

def analyze_user_behavior_pattern(user_key, current_behaviors):
    """Analyze behavior patterns over time for a user"""
    if user_key not in user_analysis_history:
        user_analysis_history[user_key] = []
    
    # Add current behaviors to history with timestamp
    user_analysis_history[user_key].append({
        "timestamp": datetime.now().isoformat(),
        "behaviors": current_behaviors
    })
    
    # Keep only the last 15 records for better pattern detection
    if len(user_analysis_history[user_key]) > 15:
        user_analysis_history[user_key] = user_analysis_history[user_key][-15:]
    
    # Need at least 3 records for pattern detection
    history = user_analysis_history[user_key]
    if len(history) < 3:
        return None
    
    # Check for consistent behaviors in the last 5 records
    behavior_counts = {}
    for record in history[-5:]:
        for behavior in record["behaviors"]:
            if behavior not in behavior_counts:
                behavior_counts[behavior] = 0
            behavior_counts[behavior] += 1
    
    # Consider a behavior consistent if it appears in at least 3 of the last 5 frames
    # Give priority to active behaviors - if "Active" appears in 2+ frames, we shouldn't mark "Absent"
    if "Active" in behavior_counts and behavior_counts["Active"] >= 2:
        # If student is active in at least 2 frames, they're definitely not consistently absent
        consistent_behaviors = [behavior for behavior, count in behavior_counts.items() 
                              if count >= 3 and behavior != "Absent"]
    else:
        consistent_behaviors = [behavior for behavior, count in behavior_counts.items() 
                              if count >= 3]
    
    # Don't allow contradictory behaviors (active and absent) to both be consistent
    if "Active" in consistent_behaviors and "Absent" in consistent_behaviors:
        consistent_behaviors.remove("Absent")
    
    # Looking away shouldn't be marked consistent unless it's in 4+ frames
    if "Looking away" in behavior_counts and behavior_counts["Looking away"] < 4:
        if "Looking away" in consistent_behaviors:
            consistent_behaviors.remove("Looking away")
    
    if consistent_behaviors:
        return consistent_behaviors
    return None

@app.post("/api/behavior/analyze")
async def analyze_behavior(
    frame: UploadFile = File(...),
    userId: str = Form(...),
    channelName: str = Form(...),
    username: Optional[str] = Form(None)
):
    # Check if the room exists
    if channelName not in active_rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Use the username from the form or get it from the room data
    if not username and userId in active_rooms[channelName]["participants"]:
        username = active_rooms[channelName]["participants"][userId]["username"]
    
    try:
        # Read the image
        contents = await frame.read()
        if not contents:
            return {"status": "Error", "message": "Empty image data"}
            
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None or img.size == 0:
            return {"status": "Error", "message": "Invalid image data"}
        
        # Convert to grayscale for face detection
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Detect faces - both frontal and profile with improved parameters
        frontal_faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
        profile_faces = profile_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
        
        # Combine detected faces
        faces = list(frontal_faces) + list(profile_faces)
        
        # Initialize behavior analysis result
        behavior_result = {
            "userId": userId,
            "username": username,
            "timestamp": datetime.now().isoformat(),
            "behaviors": [],
            "severity": "low"
        }
        
        # User key for tracking behavior history
        user_key = f"{channelName}_{userId}"
        
        # Get background brightness to help determine if camera is covered
        avg_brightness = np.mean(gray)
        very_dark = avg_brightness < 30  # Very dark image might indicate camera is off
        
        if len(faces) == 0:
            # Check if the image is just too dark (camera might be on but in a dark room)
            if very_dark:
                behavior_result["behaviors"].append("Dark environment")
                behavior_result["severity"] = "medium"
                behavior_result["message"] = "Environment is too dark to detect face clearly"
            else:
                # No face detected - student is absent or away
                behavior_result["behaviors"].append("Absent")
                behavior_result["severity"] = "high"
                behavior_result["message"] = "Student appears to be absent - no face detected"
        else:
            # Sort faces by size (larger face is likely the primary person)
            faces = sorted(faces, key=lambda face: face[2] * face[3], reverse=True)
            
            # For simplicity, we'll use the largest face detected
            (x, y, w, h) = faces[0]
            face_roi = gray[y:y+h, x:x+w]
            
            # Detect eyes within the face region
            eyes = eye_cascade.detectMultiScale(face_roi)
            
            if len(eyes) < 2:
                # Eyes not clearly visible
                behavior_result["behaviors"].append("Eyes not visible")
                behavior_result["severity"] = "medium"
                behavior_result["message"] = "Cannot detect eyes clearly - student may not be looking at screen"
                
            else:
                # Calculate eye positions and movement
                # This is a simple approximation - a real system would use more sophisticated eye tracking
                eye_centers = [(ex + ew//2, ey + eh//2) for (ex, ey, ew, eh) in eyes[:2]]
                
                # Check if eyes are looking to the side
                if len(eye_centers) >= 2:
                    left_eye, right_eye = eye_centers[:2]
                    eye_distance = abs(left_eye[0] - right_eye[0])
                    face_width = w
                    
                    # If eyes are too close to the edge of the face, person might be looking away
                    if min(left_eye[0], right_eye[0]) < 0.2 * face_width or max(left_eye[0], right_eye[0]) > 0.8 * face_width:
                        behavior_result["behaviors"].append("Looking away")
                        behavior_result["severity"] = "medium"
                        behavior_result["message"] = "Student appears to be looking away from the screen"
                    
                    # Check for potentially drowsy eyes based on eye height
                    # This is a simple approximation - real drowsiness detection would use eye aspect ratio
                    eye_heights = [eh for (_, _, _, eh) in eyes[:2]]
                    avg_eye_height = sum(eye_heights) / len(eye_heights)
                    if avg_eye_height < 0.15 * h:  # Eyes appear small/closed, using face height (h)
                        behavior_result["behaviors"].append("Drowsy")
                        behavior_result["severity"] = "medium"
                        behavior_result["message"] = "Student appears to be drowsy or tired"
            
            # Detect face orientation (approximate)
            face_height = h
            face_width = w
            
            # Check if face is tilted (simple approximation)
            if face_height > 1.5 * face_width:
                behavior_result["behaviors"].append("Head tilted")
                behavior_result["severity"] = "low"
                behavior_result["message"] = "Student's head appears to be tilted"
            
            # Calculate face position in frame
            frame_height, frame_width = img.shape[:2]
            face_center_x = x + w//2
            face_center_y = y + h//2
            
            # Calculate face size relative to frame - larger faces are likely closer to camera
            face_size_ratio = (w * h) / (frame_width * frame_height)
            
            # Check if face is centered in frame - use more relaxed thresholds
            if face_center_x < frame_width * 0.25 or face_center_x > frame_width * 0.75 or \
               face_center_y < frame_height * 0.25 or face_center_y > frame_height * 0.75:
                behavior_result["behaviors"].append("Not centered")
                behavior_result["severity"] = "low"
                behavior_result["message"] = "Student not centered in camera view"
            
            # Check if the student is active - more lenient criteria
            # Consider active if face is detected and either:
            # 1. Eyes are detected, or
            # 2. Face is reasonably well positioned (even if eyes aren't detected clearly)
            is_well_positioned = (0.25 * frame_width <= face_center_x <= 0.75 * frame_width and 
                                 0.25 * frame_height <= face_center_y <= 0.75 * frame_height)
            
            if len(eyes) >= 1 or is_well_positioned:
                # If we detected a face with at least one eye or good positioning, student is likely active
                behavior_result["behaviors"].append("Active")
                
                # Don't override severity if there are higher-priority problems
                if not any(b in behavior_result["behaviors"] for b in 
                          ["Looking away", "Drowsy", "Head tilted", "Not centered"]):
                    behavior_result["message"] = "Student appears to be actively engaged"
                    behavior_result["severity"] = "low"
            
            # For demo, sometimes detect random distraction behaviors - reduced probability
            # In a real system, this would use more sophisticated AI models
            if userId != active_rooms[channelName]["host_uid"] and np.random.random() > 0.95:  # 5% chance
                distraction_behaviors = [
                    {"behavior": "Looking away", "severity": "medium", "message": "Student appears to be looking away from the screen"},
                    {"behavior": "Using phone", "severity": "high", "message": "Student appears to be using their phone"},
                    {"behavior": "Distracted", "severity": "medium", "message": "Student appears to be distracted"},
                    {"behavior": "Talking", "severity": "high", "message": "Student appears to be talking to someone else"},
                    {"behavior": "Drowsy", "severity": "medium", "message": "Student appears to be drowsy or tired"}
                ]
                
                selected = random.choice(distraction_behaviors)
                if selected["behavior"] not in behavior_result["behaviors"]:  # Avoid duplicates
                    behavior_result["behaviors"].append(selected["behavior"])
                    if selected["severity"] == "high":  # Only override if the new severity is higher
                        behavior_result["severity"] = "high"
                    behavior_result["message"] = selected["message"]
        
        # Check for patterns in behavior
        consistent_behaviors = analyze_user_behavior_pattern(user_key, behavior_result["behaviors"])
        if consistent_behaviors:
            behavior_result["consistent_behaviors"] = consistent_behaviors
            
            # If the same behavior is detected multiple times, increase the severity
            if behavior_result["severity"] == "low":
                behavior_result["severity"] = "medium"
            elif behavior_result["severity"] == "medium" and "Absent" in consistent_behaviors:
                behavior_result["severity"] = "high"
            
            # Update message to reflect consistency
            if "Absent" in consistent_behaviors:
                behavior_result["message"] = "Student has been consistently absent"
            elif "Drowsy" in consistent_behaviors:
                behavior_result["message"] = "Student appears to be consistently drowsy or tired"
            elif "Looking away" in consistent_behaviors:
                behavior_result["message"] = "Student is consistently looking away from the screen"
            elif "Active" in consistent_behaviors and len(consistent_behaviors) == 1:
                behavior_result["message"] = "Student is consistently engaged and attentive"
                behavior_result["severity"] = "low"  # Being active is good
            else:
                behavior_result["message"] = f"Consistently showing: {', '.join(consistent_behaviors)}"
        
        # Store the behavior result - limit to 100 entries per channel to prevent memory issues
        behavior_data[channelName].append(behavior_result)
        if len(behavior_data[channelName]) > 100:
            behavior_data[channelName] = behavior_data[channelName][-100:]
        
        # Create a key for this user
        user_behavior_key = f"{channelName}_{userId}"
        
        # Get current time for throttling alerts
        current_time = time.time()
        min_alert_interval = 10  # Minimum seconds between alerts for the same user
        
        # Determine if we should send an alert based on:
        # 1. If behavior has changed from last reported behavior
        # 2. If enough time has passed since the last alert
        # 3. If the severity warrants an alert
        should_send_alert = False
        
        # Only consider sending alerts for behaviors with medium/high severity
        has_reportable_behavior = (
            behavior_result["behaviors"] and 
            behavior_result["severity"] in ["medium", "high"] and 
            not (len(behavior_result["behaviors"]) == 1 and behavior_result["behaviors"][0] == "Active")
        )
        
        if has_reportable_behavior:
            # Check if this is different from the last reported behavior
            previous_behavior = last_reported_behaviors.get(user_behavior_key, None)
            last_alert_time = last_alert_times.get(user_behavior_key, 0)
            time_since_last_alert = current_time - last_alert_time
            
            # If behaviors or consistent behaviors have changed, send an alert
            behavior_changed = previous_behavior is None or set(previous_behavior.get("behaviors", [])) != set(behavior_result["behaviors"])
            consistent_changed = (
                "consistent_behaviors" in behavior_result and 
                (previous_behavior is None or 
                "consistent_behaviors" not in previous_behavior or
                set(previous_behavior["consistent_behaviors"]) != set(behavior_result["consistent_behaviors"]))
            )
            
            # Send if:
            # 1. It's a new behavior, or
            # 2. It's a high severity alert and we haven't sent one in a while, or
            # 3. Consistent behaviors have changed
            should_send_alert = (
                behavior_changed or 
                (behavior_result["severity"] == "high" and time_since_last_alert > min_alert_interval) or
                consistent_changed
            )
            
            # For "Absent" alerts, only send every 30 seconds to avoid spam
            if "Absent" in behavior_result["behaviors"] and time_since_last_alert < 30:
                should_send_alert = False
            
            # For other alerts, enforce minimum interval
            elif time_since_last_alert < min_alert_interval:
                # Still allow alert if severity increased or we've never sent an alert before
                if previous_behavior and behavior_result["severity"] == previous_behavior.get("severity"):
                    should_send_alert = False
                
            # Log significant changes in behavior
            if behavior_changed:
                print(f"Behavior changed for {username} - Previous: {previous_behavior['behaviors'] if previous_behavior else 'None'}, New: {behavior_result['behaviors']}")
        
        # If conditions met, send an alert
        if should_send_alert:
            # Update last reported behavior and alert time
            last_reported_behaviors[user_behavior_key] = behavior_result.copy()
            last_alert_times[user_behavior_key] = current_time
            
            alert = {
                "userId": userId,
                "username": username,
                "message": behavior_result["message"],
                "severity": behavior_result["severity"],
                "timestamp": behavior_result["timestamp"],
                "behaviors": behavior_result["behaviors"]
            }
            
            # Add consistent behavior information if available
            if "consistent_behaviors" in behavior_result:
                alert["consistent_behaviors"] = behavior_result["consistent_behaviors"]
            
            # Create the alert message
            alert_message = json.dumps({"type": "behavior_alert", "alert": alert})
            
            # Try to broadcast the alert message with error handling
            try:
                print(f"Broadcasting behavior alert for {username} in channel {channelName}: {', '.join(behavior_result['behaviors'])}")
                await manager.broadcast_to_channel(alert_message, channelName)
                print(f"Successfully broadcasted alert")
            except Exception as e:
                print(f"Error broadcasting behavior alert: {e}")
        
        return {"status": "Analysis complete"}
    except Exception as e:
        print(f"Error in analyze_behavior: {str(e)}")
        return {"status": "Error", "message": f"Analysis failed: {str(e)}"}

# WebSocket endpoint for behavior alerts
@app.websocket("/ws/behavior")
async def behavior_websocket(websocket: WebSocket):
    await websocket.accept()
    print("New WebSocket connection established")
    channel = None
    
    try:
        # First message should contain the channel name
        data = await websocket.receive_text()
        try:
            data = json.loads(data)
            channel = data.get("channel")
            
            print(f"WebSocket client requesting channel: {channel}")
            
            # Validate channel - check if it exists in active_rooms or create it if not
            if channel not in active_rooms:
                print(f"Channel {channel} not found, creating it")
                # Create an empty room for this channel to allow connection
                active_rooms[channel] = {
                    "name": f"Room {channel}",
                    "created_at": datetime.now().isoformat(),
                    "host_uid": None,
                    "participants": {}
                }
                behavior_data[channel] = []
            
            # Connect to the channel first
            await manager.connect(websocket, channel)
            
            # Then send confirmation message
            await websocket.send_text(json.dumps({
                "type": "connection_success",
                "message": f"Connected to behavior monitoring for channel {channel}"
            }))
            print(f"Connection success message sent for channel {channel}")
            
            # Send current active users count
            if channel in active_rooms:
                participant_count = len(active_rooms[channel]["participants"])
                await websocket.send_text(json.dumps({
                    "type": "participants_update",
                    "count": participant_count
                }))
            
            # Send any recent behavior alerts
            if channel in behavior_data and behavior_data[channel]:
                # Send last 5 alerts
                recent_alerts = behavior_data[channel][-5:]
                for alert in recent_alerts:
                    await websocket.send_text(json.dumps({
                        "type": "behavior_alert",
                        "alert": alert
                    }))
                    # Small delay to prevent flooding
                    await asyncio.sleep(0.05)
            
            # Keep the connection alive and handle incoming messages
            while True:
                try:
                    message = await websocket.receive_text()
                    try:
                        msg_data = json.loads(message)
                        msg_type = msg_data.get("type")
                        
                        # Handle different message types
                        if msg_type == "pong":
                            # Client responding to our ping
                            continue
                        elif msg_type == "ping":
                            # Client pinging us, respond with pong
                            await websocket.send_text(json.dumps({"type": "pong"}))
                        elif msg_type == "get_alerts":
                            # Client requesting recent alerts
                            if channel in behavior_data and behavior_data[channel]:
                                # Send last 10 alerts
                                recent_alerts = behavior_data[channel][-10:]
                                for alert in recent_alerts:
                                    await websocket.send_text(json.dumps({
                                        "type": "behavior_alert",
                                        "alert": alert
                                    }))
                                    # Small delay to prevent flooding
                                    await asyncio.sleep(0.05)
                            else:
                                # No alerts yet
                                await websocket.send_text(json.dumps({
                                    "type": "info",
                                    "message": "No behavior alerts available yet"
                                }))
                    except json.JSONDecodeError:
                        print(f"Received invalid JSON from client: {message}")
                    except Exception as e:
                        print(f"Error handling websocket message: {e}")
                except WebSocketDisconnect:
                    print(f"WebSocket client disconnected from channel {channel}")
                    if channel:
                        manager.disconnect(websocket, channel)
                    break
                except Exception as e:
                    print(f"Error receiving message: {e}")
                    # Don't break, try to continue
        except json.JSONDecodeError:
            print(f"Received invalid JSON: {data}")
            await websocket.close(code=1003, reason="Invalid JSON data")
            return
            
    except WebSocketDisconnect:
        print("WebSocket disconnected during setup")
        if channel:
            manager.disconnect(websocket, channel)
    except Exception as e:
        print(f"WebSocket error: {e}")
        if channel:
            manager.disconnect(websocket, channel)
        try:
            await websocket.close(code=1011, reason=f"Internal server error: {str(e)}")
        except:
            pass

if __name__ == "__main__":
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=config.DEBUG) 