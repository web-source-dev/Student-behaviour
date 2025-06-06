# Student Live Behavior Monitoring System

A video conferencing application with real-time behavior detection for educational settings. The system allows teachers to monitor student behavior during online classes.

## Features

- Video conferencing using Agora Web SDK
- Real-time behavior detection for monitoring student attention
- Host-focused monitoring interface
- WebSocket-based alerts for behavior detection
- Room-based conference system

## Project Structure

The project consists of two main parts:

- **Backend**: Python FastAPI application for behavior detection and API endpoints
- **Frontend**: React application for the user interface and video conferencing

## Setup Instructions

### Prerequisites

- Node.js and npm for the frontend
- Python 3.8+ for the backend
- Agora account with App ID and App Certificate

### Backend Setup

1. Navigate to the backend directory:
   ```
   cd backend
   ```

2. Create a virtual environment:
   ```
   python -m venv venv
   ```

3. Activate the virtual environment:
   - Windows:
     ```
     venv\Scripts\activate
     ```
   - macOS/Linux:
     ```
     source venv/bin/activate
     ```

4. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

5. Create a `.env` file in the backend directory with the following contents:
   ```
   AGORA_APP_ID=your-agora-app-id
   AGORA_APP_CERTIFICATE=your-agora-app-certificate
   PORT=8000
   HOST=0.0.0.0
   DEBUG=True
   ```

6. Start the backend server:
   ```
   python main.py
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm start
   ```

## Usage

1. Open your browser and go to `http://localhost:3000`
2. Create a new room or join an existing one
3. As a host, you'll be able to see behavior alerts for participants
4. Participants can join the room using the room ID

## Behavior Detection Features

The system currently detects the following behaviors:
- Face presence/absence
- Eye visibility
- Random behaviors for demonstration (looking away, distraction, etc.)

## Technology Stack

- **Frontend**:
  - React
  - Material-UI
  - Agora Web SDK for video conferencing
  - WebSockets for real-time alerts

- **Backend**:
  - FastAPI (Python)
  - OpenCV for image processing and behavior detection
  - WebSockets for real-time communication
  - Agora Token Builder for token generation

## Note

This application requires a valid Agora App ID and App Certificate to function. For testing purposes, you can create a free account at [Agora.io](https://www.agora.io/). 