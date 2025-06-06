import React, { useState, useEffect, useRef } from 'react';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { Grid, Button, Typography, Box, Paper, IconButton } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import axios from 'axios';
import BehaviorDetection from './BehaviorDetection';
import config from '../config';

const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

const VideoCall = ({ appId, channelName, token, uid, username, isHost }) => {
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [behaviorAlerts, setBehaviorAlerts] = useState([]);
  const [joined, setJoined] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const localVideoRef = useRef(null);
  const wsRef = useRef(null);
  
  // Socket connection for receiving behavior updates
  useEffect(() => {
    if (!isHost || !joined) return;
    
    const connectWebSocket = () => {
      const socket = new WebSocket(`ws://${config.API_URL.replace('http://', '')}/ws/behavior`);
      wsRef.current = socket;
      
      socket.onopen = () => {
        // Send channel info when connection is established
        socket.send(JSON.stringify({ channel: channelName }));
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'behavior_alert') {
            setBehaviorAlerts(prev => {
              // Keep only the latest 50 alerts to prevent memory issues
              const newAlerts = [...prev, data.alert];
              if (newAlerts.length > 50) {
                return newAlerts.slice(newAlerts.length - 50);
              }
              return newAlerts;
            });
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      socket.onclose = () => {
        // Try to reconnect after a delay
        setTimeout(connectWebSocket, 3000);
      };
    };
    
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isHost, joined, channelName]);

  const joinChannel = async () => {
    try {
      await client.join(appId, channelName, token, uid);
      
      // Create audio and video tracks separately to handle cases where camera might not be available
      let audioTrack = null;
      let videoTrack = null;
      
      try {
        // Try to create audio track first
        audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        setLocalAudioTrack(audioTrack);
        setAudioEnabled(true);
      } catch (audioError) {
        console.error('Error creating audio track:', audioError);
        setAudioEnabled(false);
      }
      
      try {
        // Try to create video track separately
        videoTrack = await AgoraRTC.createCameraVideoTrack();
        setLocalVideoTrack(videoTrack);
        setVideoEnabled(true);
        
        if (localVideoRef.current && videoTrack) {
          videoTrack.play(localVideoRef.current);
        }
      } catch (videoError) {
        console.error('Error creating video track:', videoError);
        setVideoEnabled(false);
      }
      
      // Publish whatever tracks were successfully created
      const tracksToPublish = [audioTrack, videoTrack].filter(track => track !== null);
      if (tracksToPublish.length > 0) {
        await client.publish(tracksToPublish);
      }
      
      setJoined(true);
      
      // Start behavior detection if host and video is available
      if (isHost && videoTrack) {
        startBehaviorDetection();
      }
    } catch (error) {
      console.error('Error joining channel:', error);
    }
  };

  const leaveChannel = async () => {
    try {
      if (localAudioTrack) {
        localAudioTrack.close();
      }
      if (localVideoTrack) {
        localVideoTrack.close();
      }
      
      await client.leave();
    } catch (error) {
      console.error('Error leaving channel:', error);
    } finally {
      setJoined(false);
      setRemoteUsers([]);
      setLocalAudioTrack(null);
      setLocalVideoTrack(null);
    }
  };

  const toggleAudio = async () => {
    if (localAudioTrack) {
      await localAudioTrack.setEnabled(!audioEnabled);
      setAudioEnabled(!audioEnabled);
    }
  };

  const toggleVideo = async () => {
    if (localVideoTrack) {
      await localVideoTrack.setEnabled(!videoEnabled);
      setVideoEnabled(!videoEnabled);
    }
  };

  const startBehaviorDetection = async () => {
    try {
      await axios.post(`${config.API_URL}/api/behavior/start`, {
        channelName,
        uid,
        username
      });
      console.log('Behavior detection started for host', username);
    } catch (error) {
      console.error('Error starting behavior detection:', error);
    }
  };

  // Set up client event listeners
  useEffect(() => {
    // Set up event listeners for user joining/leaving
    client.on('user-published', async (user, mediaType) => {
      console.log(`User ${user.uid} published ${mediaType} track`);
      await client.subscribe(user, mediaType);
      
      if (mediaType === 'video') {
        setRemoteUsers(prevUsers => {
          const existingUser = prevUsers.find(u => u.uid === user.uid);
          if (existingUser) {
            console.log(`Updating video track for user ${user.uid}`);
            return prevUsers.map(u => 
              u.uid === user.uid ? { ...u, videoTrack: user.videoTrack } : u
            );
          } else {
            console.log(`Adding new user ${user.uid} with video`);
            return [...prevUsers, { 
              uid: user.uid,
              videoTrack: user.videoTrack,
              audioTrack: user.audioTrack
            }];
          }
        });

        // If host, automatically start behavior detection on this user
        if (isHost) {
          console.log(`Host will monitor behavior for user ${user.uid}`);
        }
      }
      
      if (mediaType === 'audio') {
        user.audioTrack.play();
        setRemoteUsers(prevUsers => {
          const existingUser = prevUsers.find(u => u.uid === user.uid);
          if (existingUser) {
            console.log(`Updating audio track for user ${user.uid}`);
            return prevUsers.map(u => 
              u.uid === user.uid ? { ...u, audioTrack: user.audioTrack } : u
            );
          } else {
            console.log(`Adding new user ${user.uid} with audio`);
            return [...prevUsers, { 
              uid: user.uid,
              videoTrack: user.videoTrack,
              audioTrack: user.audioTrack
            }];
          }
        });
      }
    });

    client.on('user-unpublished', (user, mediaType) => {
      console.log(`User ${user.uid} unpublished ${mediaType} track`);
      if (mediaType === 'video') {
        setRemoteUsers(prevUsers => 
          prevUsers.map(u => 
            u.uid === user.uid ? { ...u, videoTrack: undefined } : u
          )
        );
      }
      if (mediaType === 'audio') {
        setRemoteUsers(prevUsers => 
          prevUsers.map(u => 
            u.uid === user.uid ? { ...u, audioTrack: undefined } : u
          )
        );
      }
    });

    client.on('user-left', (user) => {
      console.log(`User ${user.uid} left the channel`);
      setRemoteUsers(prevUsers => prevUsers.filter(u => u.uid !== user.uid));
    });

    client.on('user-joined', (user) => {
      console.log(`User ${user.uid} joined the channel`);
      // We'll update the user when they publish their tracks
    });

    client.on('connection-state-change', (curState, prevState) => {
      console.log(`Connection state changed from ${prevState} to ${curState}`);
      if (curState === 'CONNECTED') {
        // Successfully connected to Agora
        console.log('Successfully connected to Agora RTM channel');
      } else if (curState === 'DISCONNECTED') {
        // Handle disconnection - could try to reconnect
        console.log('Disconnected from Agora RTM channel');
      }
    });

    return () => {
      client.removeAllListeners();
      if (joined) {
        leaveChannel();
      }
    };
  }, []);

  // Play video tracks when remote users or container change
  useEffect(() => {
    remoteUsers.forEach(user => {
      if (user.videoTrack) {
        // Small delay to ensure the DOM element is available
        setTimeout(() => {
          const container = document.getElementById(`remote-video-${user.uid}`);
          if (container) {
            user.videoTrack.play(container);
          }
        }, 200);
      }
    });
  }, [remoteUsers]);

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h5">Video Conference - {channelName}</Typography>
            {!joined ? (
              <Button variant="contained" color="primary" onClick={joinChannel}>
                Join Meeting
              </Button>
            ) : (
              <Button variant="contained" color="error" onClick={leaveChannel}>
                Leave Meeting
              </Button>
            )}
          </Box>
        </Grid>
        
        <Grid item xs={12} md={isHost ? 8 : 12}>
          <Grid container spacing={2}>
            {/* Local Video */}
            <Grid item xs={12} md={remoteUsers.length > 0 ? 6 : 12}>
              <Paper 
                elevation={3} 
                sx={{ 
                  p: 1, 
                  height: 240, 
                  position: 'relative',
                  backgroundColor: '#f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Typography 
                  variant="caption" 
                  sx={{ 
                    position: 'absolute', 
                    bottom: 8, 
                    left: 8, 
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: 1,
                    zIndex: 2
                  }}
                >
                  You (Local) {localAudioTrack && !localVideoTrack && '(Audio Only)'}
                </Typography>
                {localVideoTrack ? (
                  <Box 
                    ref={localVideoRef} 
                    sx={{ 
                      width: '100%', 
                      height: '100%', 
                      overflow: 'hidden',
                      borderRadius: 1,
                      position: 'relative'
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#e0e0e0',
                      borderRadius: 1
                    }}
                  >
                    <Typography variant="body1" color="text.secondary">
                      {joined ? (localAudioTrack ? 'Audio Only (No Camera)' : 'No Audio/Video') : 'Waiting to join...'}
                    </Typography>
                  </Box>
                )}
                {joined && (
                  <Box 
                    sx={{ 
                      position: 'absolute', 
                      bottom: 8, 
                      right: 8, 
                      zIndex: 2,
                      display: 'flex',
                      gap: 1
                    }}
                  >
                    <IconButton 
                      size="small" 
                      onClick={toggleAudio}
                      disabled={!localAudioTrack}
                      sx={{ 
                        bgcolor: 'rgba(0,0,0,0.5)', 
                        color: 'white',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
                      }}
                    >
                      {audioEnabled ? <MicIcon /> : <MicOffIcon />}
                    </IconButton>
                    <IconButton 
                      size="small" 
                      onClick={toggleVideo}
                      disabled={!localVideoTrack}
                      sx={{ 
                        bgcolor: 'rgba(0,0,0,0.5)', 
                        color: 'white',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
                      }}
                    >
                      {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
                    </IconButton>
                  </Box>
                )}
              </Paper>
            </Grid>
            
            {/* Remote Videos */}
            {remoteUsers.map(user => (
              <Grid item xs={12} md={remoteUsers.length > 3 ? 4 : 6} key={user.uid}>
                <Paper 
                  elevation={3} 
                  sx={{ 
                    p: 1, 
                    height: 240, 
                    position: 'relative',
                    backgroundColor: '#f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      position: 'absolute', 
                      bottom: 8, 
                      left: 8, 
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: 1,
                      zIndex: 2
                    }}
                  >
                    User {user.uid} {user.audioTrack && !user.videoTrack && '(Audio Only)'}
                  </Typography>
                  {user.videoTrack ? (
                    <Box 
                      id={`remote-video-${user.uid}`} 
                      sx={{ 
                        width: '100%', 
                        height: '100%', 
                        overflow: 'hidden',
                        borderRadius: 1
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#e0e0e0',
                        borderRadius: 1
                      }}
                    >
                      <Typography variant="body1" color="text.secondary">
                        {user.audioTrack ? 'Audio Only' : 'Connecting...'}
                      </Typography>
                    </Box>
                  )}
                  {user.audioTrack && (
                    <Box 
                      sx={{ 
                        position: 'absolute', 
                        top: 8, 
                        right: 8,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '50%',
                        zIndex: 2,
                        width: 24,
                        height: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <MicIcon fontSize="small" />
                    </Box>
                  )}
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Grid>
        
        {/* Behavior Panel (Only visible for host) */}
        {isHost && (
          <Grid item xs={12} md={4}>
            <Paper elevation={3} sx={{ p: 2, height: '100%', maxHeight: 500, overflow: 'auto' }}>
              <Typography variant="h6" gutterBottom>
                Behavior Monitoring
              </Typography>
              
              {/* Connected users summary */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Connected Users: {remoteUsers.length + 1} 
                  {remoteUsers.length > 0 && ` (You + ${remoteUsers.length} participants)`}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {remoteUsers.filter(u => u.videoTrack).length} users with video | {remoteUsers.filter(u => u.audioTrack).length} users with audio
                </Typography>
              </Box>
              
              {/* Behavior alerts section */}
              <Typography variant="subtitle2" gutterBottom>
                Recent Behavior Alerts
              </Typography>
              
              {behaviorAlerts.length > 0 ? (
                <Box>
                  {behaviorAlerts.map((alert, index) => (
                    <Paper 
                      key={index} 
                      sx={{ 
                        p: 1, 
                        mb: 1, 
                        backgroundColor: alert.severity === 'high' ? '#ffebee' : 
                                        alert.severity === 'medium' ? '#fff8e1' : '#e8f5e9'
                      }}
                    >
                      <Typography variant="body2" fontWeight="bold">
                        {alert.username || `User ${alert.userId}`} {alert.userId === uid ? "(You)" : ""}
                      </Typography>
                      <Typography variant="body2">
                        {alert.message}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </Typography>
                      {alert.behaviors && alert.behaviors.length > 0 && (
                        <Box sx={{ mt: 0.5 }}>
                          {alert.behaviors.map((behavior, i) => (
                            <Typography key={i} variant="caption" component="span" 
                              sx={{ 
                                mr: 0.5,
                                backgroundColor: 'rgba(0,0,0,0.05)',
                                padding: '2px 4px',
                                borderRadius: '4px',
                                fontSize: '0.7rem'
                              }}
                            >
                              {behavior}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </Paper>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No behavior alerts yet. Monitoring is active for all users with video.
                </Typography>
              )}
              
              {/* Monitoring status */}
              <Box sx={{ mt: 2, pt: 1, borderTop: '1px solid #eee' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Behavior monitoring active for {remoteUsers.filter(u => u.videoTrack).length + (localVideoTrack ? 1 : 0)} users
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Alerts will appear automatically as behaviors are detected
                </Typography>
              </Box>
            </Paper>
          </Grid>
        )}
      </Grid>

      {/* Behavior Detection Component - Hidden from UI */}
      {isHost && localVideoTrack && (
        <BehaviorDetection
          videoTrack={localVideoTrack}
          userId={uid}
          channelName={channelName}
          isEnabled={joined && isHost}
          username={username}
        />
      )}
      
      {/* Apply behavior detection to all remote users when host is viewing */}
      {isHost && joined && remoteUsers.map(user => (
        <BehaviorDetection
          key={`behavior-${user.uid}`}
          videoTrack={user.videoTrack}
          userId={user.uid}
          channelName={channelName}
          isEnabled={Boolean(user.videoTrack)}
          username={user.username || `User ${user.uid}`}
        />
      ))}
    </Box>
  );
};

export default VideoCall; 