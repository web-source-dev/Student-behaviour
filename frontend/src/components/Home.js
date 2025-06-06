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
  Divider,
  Card,
  CardContent,
  CardActions,
  Alert,
  useTheme,
  useMediaQuery
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import SchoolIcon from '@mui/icons-material/School';
import axios from 'axios';
import config from '../config';

const Home = () => {
  const navigate = useNavigate();
  const [newRoomName, setNewRoomName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) {
      setError('Please enter a room name');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.post(config.getApiURL('api/rooms'), {
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
    <Box 
      sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        flexDirection: 'column',
        bgcolor: '#f5f5f5',
        py: 6
      }}
    >
      <Container maxWidth="md">
        <Box 
          sx={{ 
            textAlign: 'center', 
            mb: 6 
          }}
        >
          <Typography 
            variant="h3" 
            component="h1" 
            fontWeight="bold" 
            color="primary"
            gutterBottom
          >
            Student Behavior Monitoring
          </Typography>
          
          <Typography 
            variant="h6" 
            color="text.secondary" 
            paragraph
            sx={{ maxWidth: '800px', mx: 'auto' }}
          >
            Video conferencing with advanced real-time behavior detection
          </Typography>
          
          <Box 
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              mb: 3
            }}
          >
            <SchoolIcon fontSize="large" color="primary" sx={{ mr: 1 }} />
          </Box>
        </Box>
        
        {error && (
          <Alert 
            severity="error" 
            sx={{ mb: 4, borderRadius: 2 }}
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}
        
        <Grid container spacing={4}>
          {/* Create Room */}
          <Grid item xs={12} md={6}>
            <Card 
              elevation={3} 
              sx={{ 
                borderRadius: 2,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform 0.2s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-5px)',
                  boxShadow: 6
                }
              }}
            >
              <CardContent sx={{ flexGrow: 1, p: 3 }}>
                <Box sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
                  <VideocamIcon fontSize="large" color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h5" fontWeight="bold" gutterBottom>
                    Create a New Room
                  </Typography>
                </Box>
                
                <Typography variant="body1" color="text.secondary" paragraph>
                  Start a new conference as a host with behavior monitoring capabilities.
                </Typography>
                
                <TextField
                  fullWidth
                  label="Room Name"
                  placeholder="Enter a name for your meeting"
                  variant="outlined"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  sx={{ 
                    mb: 2,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2
                    }
                  }}
                />
              </CardContent>
              
              <CardActions sx={{ p: 3, pt: 0 }}>
                <Button 
                  variant="contained" 
                  fullWidth 
                  onClick={handleCreateRoom}
                  disabled={loading || !newRoomName.trim()}
                  startIcon={<VideocamIcon />}
                  sx={{ 
                    py: isMobile ? 1 : 1.5, 
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 'bold'
                  }}
                >
                  {loading ? <CircularProgress size={24} color="inherit" /> : 'Create Meeting Room'}
                </Button>
              </CardActions>
            </Card>
          </Grid>
          
          {/* Join Room */}
          <Grid item xs={12} md={6}>
            <Card 
              elevation={3} 
              sx={{ 
                borderRadius: 2,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform 0.2s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-5px)',
                  boxShadow: 6
                }
              }}
            >
              <CardContent sx={{ flexGrow: 1, p: 3 }}>
                <Box sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
                  <MeetingRoomIcon fontSize="large" color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h5" fontWeight="bold" gutterBottom>
                    Join Existing Room
                  </Typography>
                </Box>
                
                <Typography variant="body1" color="text.secondary" paragraph>
                  Join an existing conference by entering the room ID.
                </Typography>
                
                <TextField
                  fullWidth
                  label="Room ID"
                  placeholder="Enter the room ID to join"
                  variant="outlined"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  sx={{ 
                    mb: 2,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2
                    }
                  }}
                />
              </CardContent>
              
              <CardActions sx={{ p: 3, pt: 0 }}>
                <Button 
                  variant="outlined" 
                  fullWidth 
                  onClick={handleJoinRoom}
                  disabled={!joinRoomId.trim()}
                  startIcon={<MeetingRoomIcon />}
                  sx={{ 
                    py: isMobile ? 1 : 1.5, 
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 'bold'
                  }}
                >
                  Join Meeting
                </Button>
              </CardActions>
            </Card>
          </Grid>
        </Grid>
        
        <Box sx={{ mt: 6, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            This system monitors student behavior during online classes to help instructors identify engagement issues.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};

export default Home; 