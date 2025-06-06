import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  Button, 
  TextField, 
  Typography, 
  Paper, 
  Grid, 
  Container, 
  CircularProgress,
  Divider
} from '@mui/material';
import axios from 'axios';
import config from '../config';

const Home = () => {
  const navigate = useNavigate();
  const [newRoomName, setNewRoomName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) {
      setError('Please enter a room name');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.post(`${config.API_URL}/api/rooms`, {
        name: newRoomName
      });
      
      navigate(`/room/${response.data.roomId}`);
    } catch (err) {
      setError('Failed to create room');
      console.error('Error creating room:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleJoinRoom = () => {
    if (!joinRoomId.trim()) {
      setError('Please enter a room ID');
      return;
    }
    
    navigate(`/room/${joinRoomId}`);
  };
  
  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Typography variant="h3" component="h1" align="center" gutterBottom>
          Student Behavior Monitoring
        </Typography>
        <Typography variant="h5" align="center" color="text.secondary" paragraph>
          Video conferencing with real-time behavior detection
        </Typography>
        
        {error && (
          <Typography variant="body2" color="error" align="center" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}
        
        <Grid container spacing={4} sx={{ mt: 2 }}>
          {/* Create Room */}
          <Grid item xs={12} md={6}>
            <Paper elevation={3} sx={{ p: 3 }}>
              <Typography variant="h5" gutterBottom>
                Create a New Room
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Start a new conference as a host with behavior monitoring capabilities.
              </Typography>
              
              <TextField
                fullWidth
                label="Room Name"
                variant="outlined"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                sx={{ mb: 2 }}
              />
              
              <Button 
                variant="contained" 
                fullWidth 
                onClick={handleCreateRoom}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : 'Create Room'}
              </Button>
            </Paper>
          </Grid>
          
          {/* Join Room */}
          <Grid item xs={12} md={6}>
            <Paper elevation={3} sx={{ p: 3 }}>
              <Typography variant="h5" gutterBottom>
                Join Existing Room
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Join an existing conference with your room ID.
              </Typography>
              
              <TextField
                fullWidth
                label="Room ID"
                variant="outlined"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                sx={{ mb: 2 }}
              />
              
              <Button 
                variant="outlined" 
                fullWidth 
                onClick={handleJoinRoom}
              >
                Join Room
              </Button>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </Container>
  );
};

export default Home; 