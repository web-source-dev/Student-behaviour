import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, 
  Button, 
  TextField, 
  Typography, 
  Paper, 
  CircularProgress, 
  Avatar,
  Container,
  IconButton,
  Tooltip
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonIcon from '@mui/icons-material/Person';
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
        const response = await axios.get(config.getApiURL(`api/rooms/${roomId}`));
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
      const response = await axios.post(config.getApiURL(`api/rooms/${roomId}/join`), {
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
      <Box 
        display="flex" 
        flexDirection="column" 
        justifyContent="center" 
        alignItems="center" 
        minHeight="100vh"
        sx={{ bgcolor: '#f5f5f5' }}
      >
        <CircularProgress size={60} thickness={4} />
        <Typography variant="h6" sx={{ mt: 3, color: 'text.secondary' }}>
          Loading room...
        </Typography>
      </Box>
    );
  }
  
  if (error && !roomData) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Paper 
          elevation={3} 
          sx={{ 
            p: 4, 
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center'
          }}
        >
          <Typography variant="h5" color="error" gutterBottom>
            {error}
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            The room you are trying to join may not exist or has been closed.
          </Typography>
          <Button 
            variant="contained" 
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/')}
            sx={{ mt: 2 }}
          >
            Return to Home
          </Button>
        </Paper>
      </Container>
    );
  }
  
  if (!roomData?.joined) {
    return (
      <Box 
        display="flex" 
        justifyContent="center" 
        alignItems="center" 
        minHeight="100vh"
        sx={{ bgcolor: '#f5f5f5' }}
      >
        <Paper 
          elevation={3} 
          sx={{ 
            p: 4, 
            maxWidth: 500, 
            width: '100%', 
            mx: 2,
            borderRadius: 2 
          }}
        >
          <Box sx={{ mb: 3, textAlign: 'center' }}>
            <Typography variant="h5" color="primary" fontWeight="bold" gutterBottom>
              Join Meeting
            </Typography>
            <Typography variant="subtitle1" color="text.secondary">
              Room: {roomData?.name || roomId}
            </Typography>
          </Box>
          
          <Box 
            sx={{ 
              mb: 4, 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center' 
            }}
          >
            <Avatar 
              sx={{ 
                width: 80, 
                height: 80, 
                bgcolor: 'primary.main',
                mb: 2
              }}
            >
              <PersonIcon fontSize="large" />
            </Avatar>
            
            {error && (
              <Typography 
                variant="body2" 
                color="error" 
                sx={{ mb: 2, p: 1, bgcolor: '#ffebee', width: '100%', borderRadius: 1, textAlign: 'center' }}
              >
                {error}
              </Typography>
            )}
          </Box>
          
          <TextField
            fullWidth
            label="Your Name"
            variant="outlined"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            sx={{ mb: 3 }}
            placeholder="Enter your name to join"
            autoFocus
            InputProps={{
              sx: { borderRadius: 2 }
            }}
          />
          
          <Button 
            variant="contained" 
            fullWidth 
            onClick={handleJoinRoom}
            disabled={joining || !username.trim()}
            startIcon={<VideocamIcon />}
            sx={{ 
              py: 1.5, 
              borderRadius: 2,
              fontSize: '1rem'
            }}
          >
            {joining ? <CircularProgress size={24} color="inherit" /> : 'Join Meeting'}
          </Button>
          
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Button 
              variant="text" 
              size="small" 
              onClick={handleLeaveRoom}
              sx={{ color: 'text.secondary' }}
            >
              Cancel
            </Button>
          </Box>
        </Paper>
      </Box>
    );
  }
  
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#f5f5f5' }}>
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