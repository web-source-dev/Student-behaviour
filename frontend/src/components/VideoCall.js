import React, { useState, useEffect, useRef } from 'react';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { Grid, Button, Typography, Box, Paper, IconButton, Stack, Tooltip, Avatar, CircularProgress } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import WarningIcon from '@mui/icons-material/Warning';
import PersonIcon from '@mui/icons-material/Person';
import axios from 'axios';
import BehaviorDetection from './BehaviorDetection';
import config from '../config';

// Create client outside component to ensure it's a singleton
let client = null;

// Initialize client only once
const getClient = () => {
  if (!client) {
    client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    console.log('Agora client created');
  }
  return client;
};

const VideoCall = ({ appId, channelName, token, uid, username, isHost }) => {
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [behaviorAlerts, setBehaviorAlerts] = useState([]);
  const [joined, setJoined] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [connectionState, setConnectionState] = useState('DISCONNECTED');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const localVideoRef = useRef(null);
  const wsRef = useRef(null);
  const volumeDetectionRef = useRef(null);
  const clientRef = useRef(null);
  const [monitoringStatus, setMonitoringStatus] = useState('connecting');
  const [lastAlertTime, setLastAlertTime] = useState(null);
  const pingIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  
  // Initialize client once on component mount
  useEffect(() => {
    clientRef.current = getClient();
    
    // Clean up function
    return () => {
      // If component unmounts, make sure to clean up
      if (clientRef.current && connectionState !== 'DISCONNECTED') {
        console.log('Component unmounting, cleaning up client');
        leaveChannelInternal();
      }
    };
  }, []);
  
  // Track connection state changes
  useEffect(() => {
    const handleConnectionStateChange = (curState, prevState) => {
      console.log(`Connection state changed from ${prevState} to ${curState}`);
      setConnectionState(curState);
      
      if (curState === 'CONNECTED') {
        setJoined(true);
        setIsJoining(false);
        setJoinError(null);
      } else if (curState === 'DISCONNECTED') {
        // Only reset joined state if we were previously connected
        if (prevState === 'CONNECTED' || prevState === 'CONNECTING') {
          setJoined(false);
          setIsJoining(false);
        }
      }
    };

    if (clientRef.current) {
      // Set up the event listener for connection state changes
      clientRef.current.on('connection-state-change', handleConnectionStateChange);
      
      return () => {
        if (clientRef.current) {
          clientRef.current.off('connection-state-change', handleConnectionStateChange);
        }
      };
    }
  }, []);
  
  // Socket connection for receiving behavior updates
  useEffect(() => {
    if (!isHost || !joined) return;
    
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const MAX_CONNECTION_TIMEOUT = 5000;
    let isComponentMounted = true;
    
    console.log(`Setting up WebSocket connection for host: ${isHost}, joined: ${joined}, channel: ${channelName}`);
    
    // Prevent multiple WebSocket connections for the same session
    const connectionKey = `ws_connected_${channelName}`;
    const alreadyConnectedThisSession = sessionStorage.getItem(connectionKey);
    
    const connectWebSocket = () => {
      // Skip connection if the component is about to unmount or already connected this session
      if (!isComponentMounted) {
        console.log('Component unmounting, skipping WebSocket connection');
        return;
      }
      
      try {
        // Set flag to prevent multiple connections in the same session
        sessionStorage.setItem(connectionKey, 'true');
        
        const wsUrl = config.getWebSocketURL('ws/behavior');
        console.log(`Connecting to behavior WebSocket at ${wsUrl}`);
        
        // Close any existing connection first
        if (wsRef.current && 
            (wsRef.current.readyState === WebSocket.OPEN || 
             wsRef.current.readyState === WebSocket.CONNECTING)) {
          console.log('Closing existing WebSocket connection before creating a new one');
          wsRef.current.close();
          // Give some time for the connection to close properly
          setTimeout(() => {
            initializeNewConnection(wsUrl);
          }, 500);
        } else {
          initializeNewConnection(wsUrl);
        }
      } catch (connectionError) {
        console.error('Error starting WebSocket connection:', connectionError);
        if (isComponentMounted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(5000, 1000 * Math.pow(1.5, reconnectAttempts));
          reconnectAttempts++;
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
        }
      }
    };
    
    const initializeNewConnection = (wsUrl) => {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      setMonitoringStatus('connecting');
      
      // Set connection timeout
      const connectionTimeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN && isComponentMounted) {
          console.log('WebSocket connection timeout - closing and retrying');
          try {
            socket.close();
          } catch (err) {
            console.error('Error closing timed out socket:', err);
          }
          
          if (isComponentMounted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(3000, 1000 * Math.pow(1.5, reconnectAttempts));
            reconnectAttempts++;
            reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
          } else if (isComponentMounted) {
            setMonitoringStatus('error');
          }
        }
      }, MAX_CONNECTION_TIMEOUT);
      
      // Socket event handlers
      socket.onopen = () => {
        if (!isComponentMounted) return;
        
        console.log('Behavior WebSocket connection established');
        clearTimeout(connectionTimeout);
        reconnectAttempts = 0;
        setMonitoringStatus('connected');
        
        // Send channel info
        try {
          socket.send(JSON.stringify({ channel: channelName }));
          console.log(`Sent channel info for ${channelName}`);
          
          // Request recent alerts
          setTimeout(() => {
            if (socket && socket.readyState === WebSocket.OPEN && isComponentMounted) {
              socket.send(JSON.stringify({ type: 'get_alerts' }));
            }
          }, 1000);
        } catch (sendError) {
          console.error('Error sending initial data to WebSocket:', sendError);
        }
        
        // Set up ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        
        pingIntervalRef.current = setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN && isComponentMounted) {
            try {
              socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            } catch (pingError) {
              console.error('Error sending ping:', pingError);
            }
          }
        }, 30000);
      };
      
      socket.onmessage = (event) => {
        if (!isComponentMounted) return;
        
        try {
          const data = JSON.parse(event.data);
            
          // Handle different message types
          if (data.type === 'behavior_alert') {
            console.log('Received behavior alert:', data.alert);
            setLastAlertTime(new Date());
            setBehaviorAlerts(prev => {
              // Check if this alert already exists to avoid duplicates
              const isDuplicate = prev.some(alert => 
                alert.userId === data.alert.userId && 
                alert.timestamp === data.alert.timestamp
              );
              
              if (isDuplicate) {
                return prev;
              }
              
              // Keep only the latest 50 alerts to prevent memory issues
              const newAlerts = [...prev, data.alert];
              if (newAlerts.length > 50) {
                return newAlerts.slice(newAlerts.length - 50);
              }
              return newAlerts;
            });
          } else if (data.type === 'connection_success') {
            console.log('Connection success:', data.message);
            setMonitoringStatus('active');
          } else if (data.type === 'participants_update') {
            console.log(`Participants count: ${data.count}`);
          } else if (data.type === 'ping') {
            // Server sent ping, respond with pong
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
          } else if (data.type === 'pong') {
            // Server responded to our ping, connection is healthy
            console.log('Received pong from server');
          } else if (data.type === 'info') {
            // Informational message from server
            console.log('Server info:', data.message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      socket.onerror = (error) => {
        if (!isComponentMounted) return;
        
        console.error('WebSocket error:', error);
        clearTimeout(connectionTimeout);
        setMonitoringStatus('error');
      };
      
      socket.onclose = (event) => {
        if (!isComponentMounted) return;
        
        console.log(`WebSocket closed with code ${event.code}. Reason: ${event.reason || 'No reason provided'}`);
        clearTimeout(connectionTimeout);
        
        // Only set disconnected if we were previously connected or connecting
        if (monitoringStatus === 'connected' || monitoringStatus === 'active' || monitoringStatus === 'connecting') {
          setMonitoringStatus('disconnected');
        }
        
        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Only attempt reconnect if it wasn't a normal closure and not unmounting
        if (isComponentMounted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS && event.code !== 1000) {
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          
          const delay = Math.min(5000, 1000 * Math.pow(1.5, reconnectAttempts));
          reconnectAttempts++;
          
          console.log(`Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}: Reconnecting in ${delay}ms`);
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
        } else if (event.code !== 1000 && isComponentMounted) {
          console.error('Max reconnection attempts reached or normal closure. Giving up.');
          setMonitoringStatus('error');
        }
      };
    };
    
    // Only connect if we haven't already connected in this session
    if (!alreadyConnectedThisSession) {
      // Add a small delay before connecting to give the component time to fully mount
      const initialConnectTimeout = setTimeout(() => {
        if (isComponentMounted) {
          connectWebSocket();
        }
      }, 1000);
      
      return () => {
        clearTimeout(initialConnectTimeout);
      };
    }
    
    return () => {
      console.log('WebSocket effect cleanup - component unmounting');
      isComponentMounted = false;
      
      // Clean up
      if (wsRef.current) {
        console.log('Closing behavior WebSocket connection due to component unmount');
        try {
          if (wsRef.current.readyState === WebSocket.OPEN || 
              wsRef.current.readyState === WebSocket.CONNECTING) {
            wsRef.current.close(1000, "Component unmounting");
          }
        } catch (error) {
          console.error('Error closing WebSocket:', error);
        }
        wsRef.current = null;
      }
      
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [isHost, joined, channelName]);

  // Audio volume monitoring for speaking detection
  useEffect(() => {
    if (localAudioTrack && joined && clientRef.current) {
      // Setup volume detection
      const handleVolumeIndicator = (volumes) => {
        // volumes is an array of objects with uid and level properties
        // level ranges from 0 (silence) to 100 (loudest)
        volumes.forEach(volume => {
          if (volume.uid === uid) {
            // For local user
            const isSpeaking = volume.level > 30; // Threshold for speaking
            setSpeaking(isSpeaking);
          } else {
            // For remote users
            setRemoteUsers(prev => 
              prev.map(user => 
                user.uid === volume.uid 
                  ? { ...user, speaking: volume.level > 30 } 
                  : user
              )
            );
          }
        });
      };

      // Enable volume indicator
      clientRef.current.enableAudioVolumeIndicator();
      clientRef.current.on('volume-indicator', handleVolumeIndicator);

      // Save the interval reference
      volumeDetectionRef.current = setInterval(() => {
        // Keep the volume detection active
      }, 1000);

      return () => {
        if (clientRef.current) {
          clientRef.current.off('volume-indicator', handleVolumeIndicator);
        }
        if (volumeDetectionRef.current) {
          clearInterval(volumeDetectionRef.current);
        }
      };
    }
  }, [localAudioTrack, joined, uid]);

  // Helper function to wait for a specific connection state
  const waitForConnectionState = async (targetState, timeoutMs = 10000) => {
    if (!clientRef.current) return false;
    
    // If already in the target state, return immediately
    if (clientRef.current.connectionState === targetState) {
      return true;
    }
    
    // Set up a promise that resolves when the state changes to the target state
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false); // Timeout reached
      }, timeoutMs);
      
      const stateChangeHandler = (currentState) => {
        if (currentState === targetState) {
          cleanup();
          resolve(true);
        }
      };
      
      const cleanup = () => {
        clearTimeout(timeout);
        clientRef.current.off('connection-state-change', stateChangeHandler);
      };
      
      clientRef.current.on('connection-state-change', stateChangeHandler);
    });
  };

  const leaveChannelInternal = async () => {
    try {
      // Stop and close tracks first
      if (localAudioTrack) {
        localAudioTrack.stop();
        localAudioTrack.close();
        setLocalAudioTrack(null);
      }
      
      if (localVideoTrack) {
        localVideoTrack.stop();
        localVideoTrack.close();
        setLocalVideoTrack(null);
      }
      
      // Then leave the channel if client exists and is connected
      if (clientRef.current && 
          (clientRef.current.connectionState === 'CONNECTED' || 
           clientRef.current.connectionState === 'CONNECTING')) {
        await clientRef.current.leave();
        console.log('Left channel successfully');
      }
      
      // Reset UI state
      setRemoteUsers([]);
      setJoined(false);
      setAudioEnabled(true);
      setVideoEnabled(true);
    } catch (error) {
      console.error('Error in leaveChannelInternal:', error);
    }
  };

  const joinChannel = async () => {
    // Prevent multiple join attempts or joining when already connected
    if (isJoining || 
        !clientRef.current || 
        clientRef.current.connectionState === 'CONNECTING' || 
        clientRef.current.connectionState === 'CONNECTED') {
      console.log('Already joining or connected, ignoring join request');
      return;
    }
    
    try {
      setIsJoining(true);
      setJoinError(null);
      
      // Ensure we're disconnected before joining
      if (clientRef.current.connectionState !== 'DISCONNECTED') {
        console.log('Client not in DISCONNECTED state, attempting to leave first');
        await leaveChannelInternal();
        
        // Wait for the client to fully disconnect
        const disconnected = await waitForConnectionState('DISCONNECTED', 5000);
        if (!disconnected) {
          throw new Error('Failed to disconnect before joining');
        }
      }
      
      // Create audio and video tracks BEFORE joining
      let audioTrack = null;
      let videoTrack = null;
      
      try {
        // Try to create audio track first
        audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
          AEC: true,
          ANS: true,
          AGC: true
        });
        setLocalAudioTrack(audioTrack);
        setAudioEnabled(true);
      } catch (audioError) {
        console.error('Error creating audio track:', audioError);
        setAudioEnabled(false);
      }
      
      try {
        // Try to create video track separately
        videoTrack = await AgoraRTC.createCameraVideoTrack({
          encoderConfig: {
            width: 640,
            height: 360,
            frameRate: 30,
          }
        });
        setLocalVideoTrack(videoTrack);
        setVideoEnabled(true);
        
        if (localVideoRef.current && videoTrack) {
          videoTrack.play(localVideoRef.current);
        }
      } catch (videoError) {
        console.error('Error creating video track:', videoError);
        setVideoEnabled(false);
      }
      
      // Join the channel AFTER creating tracks but BEFORE publishing
      console.log(`Joining channel ${channelName} with UID ${uid}`);
      
      try {
        await clientRef.current.join(appId, channelName, token, uid);
        console.log('Successfully joined the channel');
      } catch (joinError) {
        console.error('Error joining channel:', joinError);
        throw joinError;
      }
      
      // Wait for connection to be fully established
      const connected = await waitForConnectionState('CONNECTED', 5000);
      if (!connected) {
        throw new Error('Failed to establish connection after joining');
      }
      
      // Only after successfully joining and confirming connection, publish the tracks
      const tracksToPublish = [audioTrack, videoTrack].filter(track => track !== null);
      
      if (tracksToPublish.length > 0) {
        console.log(`Publishing ${tracksToPublish.length} tracks`);
        
        // Verify we're still connected before publishing
        if (clientRef.current.connectionState === 'CONNECTED') {
          try {
            await clientRef.current.publish(tracksToPublish);
            console.log('Successfully published tracks');
          } catch (publishError) {
            console.error('Error publishing tracks:', publishError);
            throw publishError;
          }
          
          // Share user's username as metadata
          if (username) {
            // Store username in session storage for retrieving later
            try {
              sessionStorage.setItem(`user_${uid}`, username);
              // Also broadcast username to other users in a compatible way
              console.log(`Stored username ${username} for user ${uid}`);
            } catch (e) {
              console.warn('Could not save username to session storage');
            }
          }
        } else {
          console.error('Connection not ready for publishing. Current state:', clientRef.current.connectionState);
          throw new Error(`Connection not in CONNECTED state: ${clientRef.current.connectionState}`);
        }
      }
      
      // Start behavior detection if host and video is available
      if (isHost && videoTrack) {
        startBehaviorDetection();
      }

      // Enable volume detection
      if (clientRef.current) {
        clientRef.current.enableAudioVolumeIndicator();
      }
    } catch (error) {
      console.error('Error in join process:', error);
      setJoinError(`Failed to join: ${error.message || 'Unknown error'}`);
      
      // Clean up any created tracks on error
      if (localAudioTrack) {
        localAudioTrack.close();
        setLocalAudioTrack(null);
      }
      
      if (localVideoTrack) {
        localVideoTrack.close();
        setLocalVideoTrack(null);
      }
      
      // If we joined but failed to publish, leave the channel
      if (clientRef.current && clientRef.current.connectionState === 'CONNECTED') {
        await leaveChannelInternal();
      }
    } finally {
      setIsJoining(false);
    }
  };

  const leaveChannel = async () => {
    await leaveChannelInternal();
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
      await axios.post(config.getApiURL('api/behavior/start'), {
        channelName,
        uid,
        username
      });
      console.log('Behavior detection started for host', username);
    } catch (error) {
      console.error('Error starting behavior detection:', error);
    }
  };

  // Try to get username from user attributes or from session storage
  const getUsernameFromUID = (user) => {
    // First check if user has username in attributes
    if (user.username) return user.username;
    
    // Try to get from session storage
    try {
      const storedUsername = sessionStorage.getItem(`user_${user.uid}`);
      if (storedUsername) return storedUsername;
    } catch (e) {
      // Ignore storage errors
    }
    
    // Default fallback
    return `User ${user.uid}`;
  };

  // Set up client event listeners
  useEffect(() => {
    if (!clientRef.current) return;
    
    // Set up event listeners for user joining/leaving
    const handleUserPublished = async (user, mediaType) => {
      console.log(`User ${user.uid} published ${mediaType} track`);
      await clientRef.current.subscribe(user, mediaType);
      
      if (mediaType === 'video') {
        setRemoteUsers(prevUsers => {
          const existingUser = prevUsers.find(u => u.uid === user.uid);
          if (existingUser) {
            console.log(`Updating video track for user ${user.uid}`);
            return prevUsers.map(u => 
              u.uid === user.uid ? { 
                ...u, 
                videoTrack: user.videoTrack,
                username: getUsernameFromUID(user)
              } : u
            );
          } else {
            console.log(`Adding new user ${user.uid} with video`);
            return [...prevUsers, { 
              uid: user.uid,
              videoTrack: user.videoTrack,
              audioTrack: user.audioTrack,
              username: getUsernameFromUID(user),
              speaking: false
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
              u.uid === user.uid ? { 
                ...u, 
                audioTrack: user.audioTrack,
                username: getUsernameFromUID(user)
              } : u
            );
          } else {
            console.log(`Adding new user ${user.uid} with audio`);
            return [...prevUsers, { 
              uid: user.uid,
              videoTrack: user.videoTrack,
              audioTrack: user.audioTrack,
              username: getUsernameFromUID(user),
              speaking: false
            }];
          }
        });
      }
    };

    const handleUserUnpublished = (user, mediaType) => {
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
    };

    const handleUserLeft = (user) => {
      console.log(`User ${user.uid} left the channel`);
      setRemoteUsers(prevUsers => prevUsers.filter(u => u.uid !== user.uid));
    };

    const handleUserJoined = (user) => {
      console.log(`User ${user.uid} joined the channel`);
      // Update user list with any available metadata
      if (user.username) {
        try {
          sessionStorage.setItem(`user_${user.uid}`, user.username);
        } catch (e) {
          console.warn('Could not save username to session storage');
        }
      }
    };

    clientRef.current.on('user-published', handleUserPublished);
    clientRef.current.on('user-unpublished', handleUserUnpublished);
    clientRef.current.on('user-left', handleUserLeft);
    clientRef.current.on('user-joined', handleUserJoined);

    return () => {
      if (clientRef.current) {
        clientRef.current.off('user-published', handleUserPublished);
        clientRef.current.off('user-unpublished', handleUserUnpublished);
        clientRef.current.off('user-left', handleUserLeft);
        clientRef.current.off('user-joined', handleUserJoined);
      }
    };
  }, [isHost]);

  // Play video tracks when remote users or container change
  useEffect(() => {
    remoteUsers.forEach(user => {
      if (user.videoTrack) {
        // Small delay to ensure the DOM element is available
        setTimeout(() => {
          const container = document.getElementById(`remote-video-${user.uid}`);
          if (container) {
            // Try to play with optimized settings and error handling
            try {
              user.videoTrack.play(container, { fit: 'cover' });
              console.log(`Successfully played video for user ${user.uid}`);
            } catch (error) {
              console.error(`Error playing video for user ${user.uid}:`, error);
              // Try again with a longer delay
              setTimeout(() => {
                try {
                  user.videoTrack.play(container, { fit: 'cover' });
                } catch (innerError) {
                  console.error(`Failed second attempt to play video for user ${user.uid}:`, innerError);
                }
              }, 1000);
            }
          } else {
            console.warn(`Container for remote-video-${user.uid} not found`);
          }
        }, 200);
      }
    });
  }, [remoteUsers]);

  // Fix for local video playing
  useEffect(() => {
    if (localVideoTrack && localVideoRef.current && videoEnabled) {
      try {
        localVideoTrack.play(localVideoRef.current);
        console.log('Local video track played successfully');
      } catch (error) {
        console.error('Error playing local video:', error);
        // Try again with a delay
        setTimeout(() => {
          try {
            localVideoTrack.play(localVideoRef.current);
          } catch (innerError) {
            console.error('Failed second attempt to play local video:', innerError);
          }
        }, 1000);
      }
    }
  }, [localVideoTrack, videoEnabled]);

  // Calculate grid layout
  const totalUsers = remoteUsers.length + 1; // +1 for local user
  const getGridLayout = () => {
    
    // Optimized gallery view layout for better visibility
    if (totalUsers === 1) return { xs: 12, md: 12 }; 
    if (totalUsers === 2) return { xs: 12, sm: 12, md: 6 };
    if (totalUsers === 3) return { xs: 12, sm: 6, md: 4 };
    if (totalUsers === 4) return { xs: 12, sm: 6, md: 6 };
    if (totalUsers <= 6) return { xs: 12, sm: 6, md: 4 };
    return { xs: 12, sm: 6, md: 3 }; // For more than 6 users
  };

  const gridSize = getGridLayout();

  return (
    <Box sx={{ 
      p: 2, 
      display: 'flex', 
      flexDirection: 'column',
      height: '100vh',
      bgcolor: '#f5f5f5'
    }}>
      {/* Header */}
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight="bold" color="primary">
          {channelName}
        </Typography>
            {!joined ? (
          <Button 
            variant="contained" 
            color="primary" 
            onClick={joinChannel}
            startIcon={isJoining ? <CircularProgress size={20} color="inherit" /> : <VideocamIcon />}
            disabled={isJoining || connectionState === 'CONNECTING'}
            sx={{ borderRadius: 8, px: 3 }}
          >
            {isJoining ? 'Joining...' : 'Join Meeting'}
              </Button>
            ) : (
          <Typography variant="subtitle1" color="text.secondary">
            {remoteUsers.length + 1} Participants
          </Typography>
            )}
          </Box>
      
      {/* Connection status indicator */}
      {connectionState !== 'CONNECTED' && connectionState !== 'DISCONNECTED' && (
        <Box sx={{ mb: 2, p: 1, bgcolor: '#e3f2fd', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={16} thickness={5} />
          <Typography variant="body2" color="primary">
            Connection status: {connectionState}
          </Typography>
        </Box>
      )}
      
      {/* Join error message */}
      {joinError && (
        <Box sx={{ mb: 2, p: 2, bgcolor: '#ffebee', borderRadius: 2 }}>
          <Typography color="error" variant="body2">
            {joinError}
          </Typography>
        </Box>
      )}
      
      {/* Main Content Area */}
      <Box sx={{ 
        display: 'flex', 
        flexDirection: { xs: 'column', md: isHost ? 'row' : 'column' },
        flexGrow: 1,
        gap: 2,
        height: { xs: 'auto', md: isHost ? 'calc(100vh - 180px)' : 'calc(100vh - 140px)' },
        overflow: 'hidden'
      }}>
        {/* Video Grid - Full width gallery view */}
        <Box sx={{ 
          flexGrow: 1, 
          width: { xs: '100%', md: isHost ? '70%' : '100%' },
          height: { xs: 'auto', md: '100%' },
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Gallery header */}
          <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight="medium" color="text.secondary">
              {joined ? 'Meeting in progress' : 'Ready to join'}
            </Typography>
            {joined && (
              <Typography variant="body2" color="text.secondary">
                {remoteUsers.filter(u => u.videoTrack).length + (videoEnabled ? 1 : 0)} cameras • 
                {remoteUsers.filter(u => u.audioTrack).length + (audioEnabled ? 1 : 0)} microphones
              </Typography>
            )}
          </Box>
          
          {/* Gallery view */}
          <Grid 
            container 
            spacing={2} 
            sx={{ 
              flexGrow: 1, 
              alignContent: 'flex-start',
              height: '100%'
            }}
          >
            {/* Local Video */}
            <Grid item {...gridSize}>
              <Paper 
                elevation={3} 
                sx={{ 
                  borderRadius: 2,
                  overflow: 'hidden',
                  position: 'relative',
                  backgroundColor: '#000',
                  aspectRatio: remoteUsers.length <= 1 ? '16/9' : remoteUsers.length <= 3 ? '4/3' : '1/1',
                  height: { 
                    xs: 'auto',
                    sm: remoteUsers.length <= 1 ? '60vh' : remoteUsers.length <= 3 ? '45vh' : '35vh'
                  },
                  maxHeight: '70vh',
                  minHeight: { xs: '220px', sm: '300px' },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  '&:hover .controls': {
                    opacity: 1
                  },
                  border: speaking ? '3px solid' : '3px solid transparent',
                  borderColor: speaking ? 'primary.main' : 'transparent',
                }}
                onMouseEnter={() => setControlsVisible(true)}
                onMouseLeave={() => setControlsVisible(false)}
              >
                {localVideoTrack && videoEnabled ? (
                  <Box 
                    ref={localVideoRef} 
                    sx={{ 
                      width: '100%', 
                      height: '100%', 
                      overflow: 'hidden',
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
                      backgroundColor: '#212121',
                    }}
                  >
                    <Avatar sx={{ width: 80, height: 80, bgcolor: 'primary.main', fontSize: '2rem' }}>
                      {username.charAt(0).toUpperCase()}
                    </Avatar>
                  </Box>
                )}
                
                {/* Username overlay */}
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 10,
                    left: 10,
                    padding: '4px 8px',
                    borderRadius: 1,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    color: 'white',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5
                  }}
                >
                  {speaking && audioEnabled && (
                    <MicIcon fontSize="small" sx={{ color: 'primary.light' }} />
                  )}
                  <Typography variant="body2" fontWeight="medium">
                    {username} (You)
                  </Typography>
                </Box>
                
                {/* Control overlay */}
                {joined && (
                  <Box 
                    className="controls"
                    sx={{ 
                      position: 'absolute', 
                      bottom: 10, 
                      right: 10, 
                      zIndex: 10,
                      display: 'flex',
                      gap: 1,
                      opacity: controlsVisible ? 1 : 0,
                      transition: 'opacity 0.2s ease-in-out'
                    }}
                  >
                    <IconButton 
                      size="small" 
                      onClick={toggleAudio}
                      disabled={!localAudioTrack}
                      sx={{ 
                        bgcolor: audioEnabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,0,0,0.3)', 
                        color: 'white',
                        '&:hover': { bgcolor: audioEnabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,0,0,0.5)' }
                      }}
                    >
                      {audioEnabled ? <MicIcon /> : <MicOffIcon />}
                    </IconButton>
                    <IconButton 
                      size="small" 
                      onClick={toggleVideo}
                      disabled={!localVideoTrack}
                      sx={{ 
                        bgcolor: videoEnabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,0,0,0.3)',  
                        color: 'white',
                        '&:hover': { bgcolor: videoEnabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,0,0,0.5)' }
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
              <Grid item {...gridSize} key={user.uid}>
                <Paper 
                  elevation={3} 
                  sx={{ 
                    borderRadius: 2,
                    overflow: 'hidden',
                    position: 'relative',
                    backgroundColor: '#000',
                    aspectRatio: remoteUsers.length <= 1 ? '16/9' : remoteUsers.length <= 3 ? '4/3' : '1/1',
                    height: { 
                      xs: 'auto',
                      sm: remoteUsers.length <= 1 ? '60vh' : remoteUsers.length <= 3 ? '45vh' : '35vh'
                    },
                    maxHeight: '70vh',
                    minHeight: { xs: '220px', sm: '300px' },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: user.speaking ? '3px solid' : '3px solid transparent',
                    borderColor: user.speaking ? 'primary.main' : 'transparent',
                  }}
                >
                  {user.videoTrack ? (
                    <Box 
                      id={`remote-video-${user.uid}`} 
                      sx={{ 
                        width: '100%', 
                        height: '100%', 
                        overflow: 'hidden',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
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
                        backgroundColor: '#212121',
                      }}
                    >
                      <Avatar sx={{ width: 80, height: 80, bgcolor: 'secondary.main', fontSize: '2rem' }}>
                        {user.username ? user.username.charAt(0).toUpperCase() : <PersonIcon fontSize="large" />}
                      </Avatar>
                    </Box>
                  )}
                  
                  {/* Username and audio indicator */}
                    <Box 
                      sx={{ 
                        position: 'absolute', 
                      bottom: 10,
                      left: 10,
                      padding: '4px 8px',
                      borderRadius: 1,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                        color: 'white',
                      zIndex: 10,
                        display: 'flex',
                        alignItems: 'center',
                      gap: 0.5
                    }}
                  >
                    {user.audioTrack && (
                      <MicIcon 
                        fontSize="small" 
                        sx={{ color: user.speaking ? 'primary.light' : 'white' }}
                      />
                    )}
                    <Typography variant="body2" fontWeight="medium">
                      {user.username || `User ${user.uid}`}
                    </Typography>
                  </Box>
                </Paper>
              </Grid>
            ))}
            
            {/* Empty placeholders for better grid alignment when few users */}
            {remoteUsers.length === 0 && !joined && (
              <Grid item {...gridSize}>
                <Paper
                  elevation={3}
                  sx={{
                    borderRadius: 2,
                    aspectRatio: '16/9',
                    height: { xs: 'auto', md: '40vh' },
                    minHeight: '200px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: 2,
                    bgcolor: 'rgba(0,0,0,0.02)',
                    border: '1px dashed',
                    borderColor: 'divider'
                  }}
                >
                  <Typography variant="body2" color="text.secondary" align="center">
                    Join the meeting to start video conferencing
                  </Typography>
                </Paper>
          </Grid>
            )}
            
            {/* Waiting for others message when joined but no remote users */}
            {remoteUsers.length === 0 && joined && (
              <Grid item {...gridSize}>
                <Paper
                  elevation={3}
                  sx={{
                    borderRadius: 2,
                    aspectRatio: '16/9',
                    height: { xs: 'auto', md: '40vh' },
                    minHeight: '200px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: 2,
                    bgcolor: 'rgba(0,0,0,0.02)',
                    border: '1px dashed',
                    borderColor: 'divider'
                  }}
                >
                  <CircularProgress size={24} sx={{ mb: 1 }} />
                  <Typography variant="body2" color="text.secondary" align="center">
                    Waiting for others to join...
                  </Typography>
                </Paper>
        </Grid>
            )}
          </Grid>
        </Box>
        
        {/* Behavior Panel (Only visible for host) */}
        {isHost && (
          <Box sx={{ 
            width: { xs: '100%', md: '30%' },
            minWidth: { md: '320px' },
            maxHeight: { xs: '300px', md: 'none' },
            overflow: 'auto',
          }}>
            <Paper 
              elevation={3} 
              sx={{ 
                p: 2, 
                height: '100%', 
                borderRadius: 2,
                bgcolor: '#fff'
              }}
            >
              <Typography variant="h6" fontWeight="bold" color="primary" gutterBottom>
                Behavior Monitoring
              </Typography>
              
              {/* Monitoring status indicator */}
              <Box sx={{ 
                mb: 2, 
                p: 1.5, 
                borderRadius: 2, 
                bgcolor: 
                  monitoringStatus === 'active' ? 'rgba(46, 125, 50, 0.15)' : 
                  monitoringStatus === 'connected' ? 'rgba(2, 136, 209, 0.15)' :
                  monitoringStatus === 'connecting' ? 'rgba(237, 108, 2, 0.15)' :
                  'rgba(211, 47, 47, 0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                border: '1px solid',
                borderColor:
                  monitoringStatus === 'active' ? 'success.light' : 
                  monitoringStatus === 'connected' ? 'info.light' :
                  monitoringStatus === 'connecting' ? 'warning.light' :
                  'error.light',
              }}>
                <Box 
                  sx={{ 
                    width: 12, 
                    height: 12, 
                    borderRadius: '50%', 
                    bgcolor: monitoringStatus === 'active' ? 'success.main' : 
                            monitoringStatus === 'connected' ? 'info.main' : 
                            monitoringStatus === 'connecting' ? 'warning.main' : 
                            'error.main',
                    animation: monitoringStatus === 'active' ? 'pulse 2s infinite' : 
                               monitoringStatus === 'connecting' ? 'pulse 1.5s infinite' : 'none',
                    boxShadow: theme => `0 0 8px ${
                      monitoringStatus === 'active' ? theme.palette.success.main : 
                      monitoringStatus === 'connected' ? theme.palette.info.main : 
                      monitoringStatus === 'connecting' ? theme.palette.warning.main : 
                      theme.palette.error.main
                    }`
                  }} 
                />
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="body2" fontWeight="medium" color="text.primary">
                    {monitoringStatus === 'active' && 'Monitoring active'}
                    {monitoringStatus === 'connected' && 'Connected, initializing monitoring'}
                    {monitoringStatus === 'connecting' && 'Connecting to monitoring service'}
                    {monitoringStatus === 'disconnected' && 'Reconnecting to monitoring service'}
                    {monitoringStatus === 'error' && 'Connection error, retrying'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {monitoringStatus === 'active' && 'Real-time behavior detection is working'}
                    {monitoringStatus === 'connected' && 'Connection established, starting behavior detection'}
                    {monitoringStatus === 'connecting' && 'Establishing secure connection to monitoring service'}
                    {monitoringStatus === 'disconnected' && 'Connection lost, automatically reconnecting'}
                    {monitoringStatus === 'error' && 'Error connecting to monitoring service, retrying'}
                  </Typography>
                </Box>
                {lastAlertTime && (
                  <Typography variant="caption" color="text.secondary" sx={{ 
                    ml: 'auto',
                    whiteSpace: 'nowrap',
                    fontSize: '0.65rem'
                  }}>
                    Last alert: {new Date(lastAlertTime).toLocaleTimeString()}
                  </Typography>
                )}
              </Box>
              
              {/* Connected users summary */}
              <Box sx={{ mb: 3, p: 1.5, bgcolor: 'primary.light', borderRadius: 2, color: 'white' }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  Connected Users: {remoteUsers.length + 1} 
                  {remoteUsers.length > 0 && ` (You + ${remoteUsers.length})`}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {remoteUsers.filter(u => u.videoTrack).length} with video • {remoteUsers.filter(u => u.audioTrack).length} with audio
                </Typography>
              </Box>
              
              {/* Behavior alerts section */}
              <Typography variant="subtitle1" fontWeight="bold" color="text.primary" gutterBottom>
                Recent Behavior Alerts
              </Typography>
              
              {behaviorAlerts.length > 0 ? (
                <Stack spacing={1.5} sx={{ maxHeight: '500px', overflow: 'auto', pr: 1 }}>
                  {behaviorAlerts.slice().reverse().map((alert, index) => (
                    <Paper 
                      key={index} 
                      sx={{ 
                        p: 1.5, 
                        borderRadius: 2,
                        borderLeft: '4px solid',
                        borderColor: alert.severity === 'high' ? 'error.main' : 
                                    alert.severity === 'medium' ? 'warning.main' : 'success.main',
                        animation: index === 0 ? 'fadeIn 0.5s ease-in-out' : 'none',
                        transition: 'all 0.3s ease',
                        position: 'relative',
                        overflow: 'hidden',
                        '&::after': index === 0 ? {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: 'rgba(255, 255, 255, 0.1)',
                          animation: 'fadeOut 2s ease-in-out forwards',
                        } : {}
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                        {alert.severity === 'high' && (
                          <WarningIcon color="error" fontSize="small" />
                        )}
                        <Typography variant="body2" fontWeight="bold" sx={{ 
                          display: 'flex', 
                          alignItems: 'center',
                          gap: 0.5 
                        }}>
                        {alert.username || `User ${alert.userId}`} {alert.userId === uid ? "(You)" : ""}
                          {index === 0 && (
                            <Box 
                              component="span" 
                              sx={{ 
                                ml: 1,
                                fontSize: '0.7rem', 
                                bgcolor: 'primary.main', 
                                color: 'white', 
                                px: 0.7, 
                                py: 0.2, 
                                borderRadius: '10px',
                                animation: 'pulse 2s infinite'
                              }}
                            >
                              NEW
                            </Box>
                          )}
                      </Typography>
                      </Box>
                      <Typography variant="body2">
                        {alert.message}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </Typography>
                        {alert.severity && (
                          <Box
                            component="span"
                            sx={{ 
                              fontSize: '0.7rem',
                              px: 1,
                              py: 0.3,
                              borderRadius: '12px',
                              backgroundColor: alert.severity === 'high' ? 'error.light' : 
                                              alert.severity === 'medium' ? 'warning.light' : 'success.light',
                              color: alert.severity === 'high' ? 'error.contrastText' : 
                                     alert.severity === 'medium' ? 'warning.contrastText' : 'success.contrastText',
                            }}
                          >
                            {alert.severity.toUpperCase()}
                          </Box>
                        )}
                      </Box>
                      {alert.behaviors && alert.behaviors.length > 0 && (
                        <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {alert.behaviors.map((behavior, i) => (
                            <Box
                              key={i}
                              component="span"
                              sx={{ 
                                mr: 0.5,
                                backgroundColor: 'rgba(0,0,0,0.05)',
                                padding: '2px 6px',
                                borderRadius: '12px',
                                fontSize: '0.7rem'
                              }}
                            >
                              {behavior}
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Box sx={{ 
                  p: 3, 
                  display: 'flex', 
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  color: 'text.secondary',
                  bgcolor: 'background.paper',
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider'
                }}>
                  <Typography variant="body2">
                  No behavior alerts yet. Monitoring is active for all users with video.
                </Typography>
                </Box>
              )}
            </Paper>
              </Box>
        )}
      </Box>
      
      {/* Bottom control bar */}
      {joined && (
        <Paper 
          elevation={3} 
          sx={{ 
            mt: 2, 
            p: 1.5,
            borderRadius: 4,
            display: 'flex',
            justifyContent: 'center',
            gap: 2
          }}
        >
          <Tooltip title={audioEnabled ? "Mute microphone" : "Unmute microphone"}>
            <IconButton 
              color={audioEnabled ? "primary" : "error"}
              onClick={toggleAudio}
              disabled={!localAudioTrack}
              sx={{ bgcolor: 'background.paper' }}
            >
              {audioEnabled ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
          </Tooltip>
          
          <Tooltip title={videoEnabled ? "Turn off camera" : "Turn on camera"}>
            <IconButton 
              color={videoEnabled ? "primary" : "error"}
              onClick={toggleVideo}
              disabled={!localVideoTrack}
              sx={{ bgcolor: 'background.paper' }}
            >
              {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Leave meeting">
            <IconButton 
              color="error" 
              onClick={leaveChannel}
              sx={{ bgcolor: 'error.light', color: 'white', '&:hover': { bgcolor: 'error.main' } }}
            >
              <CallEndIcon />
            </IconButton>
          </Tooltip>
            </Paper>
        )}

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