import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Button, TextField, Typography, Paper, CircularProgress } from '@mui/material';
import axios from 'axios';
import VideoCall from './VideoCall';
import config from '../config';

const Room = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [username, setUsername] = useState('');
  const [joining, setJoining] = useState(false);
  
  // Generate a random user ID
  const [userId] = useState(() => Math.floor(Math.random() * 1000000));
  
  useEffect(() => {
    const fetchRoomData = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${config.API_URL}/api/rooms/${roomId}`);
        setRoomData(response.data);
        setError(null);
      } catch (err) {
        setError('Room not found or cannot be accessed');
        console.error('Error fetching room:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRoomData();
  }, [roomId]);
  
  const handleJoinRoom = async () => {
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }
    
    try {
      setJoining(true);
      const response = await axios.post(`${config.API_URL}/api/rooms/${roomId}/join`, {
        username,
        userId
      });
      
      setRoomData(prev => ({
        ...prev,
        token: response.data.token,
        joined: true,
        username: username,
        isHost: response.data.isHost
      }));
      
      setError(null);
    } catch (err) {
      setError('Failed to join the room');
      console.error('Error joining room:', err);
    } finally {
      setJoining(false);
    }
  };
  
  const handleLeaveRoom = () => {
    navigate('/');
  };
  
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }
  
  if (error && !roomData) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <Paper elevation={3} sx={{ p: 4, maxWidth: 500 }}>
          <Typography variant="h5" color="error" gutterBottom>
            {error}
          </Typography>
          <Button variant="contained" onClick={() => navigate('/')}>
            Return to Home
          </Button>
        </Paper>
      </Box>
    );
  }
  
  if (!roomData?.joined) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <Paper elevation={3} sx={{ p: 4, maxWidth: 500 }}>
          <Typography variant="h5" gutterBottom>
            Join Room: {roomData?.name || roomId}
          </Typography>
          
          {error && (
            <Typography variant="body2" color="error" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}
          
          <TextField
            fullWidth
            label="Your Name"
            variant="outlined"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            sx={{ mb: 3 }}
          />
          
          <Button 
            variant="contained" 
            fullWidth 
            onClick={handleJoinRoom}
            disabled={joining}
          >
            {joining ? <CircularProgress size={24} /> : 'Join Meeting'}
          </Button>
        </Paper>
      </Box>
    );
  }
  
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        <VideoCall
          appId={roomData.appId}
          channelName={roomId}
          token={roomData.token}
          uid={userId}
          username={roomData.username || username}
          isHost={roomData.isHost}
        />
      </Box>
    </Box>
  );
};

export default Room; 