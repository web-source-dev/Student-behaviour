import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import config from '../config';

// Frame processing rate (ms)
const PROCESS_INTERVAL = 5000; // Increased from 3s to 5s to reduce request frequency
const MAX_RETRIES = 3; // Maximum retries for failed requests
const MIN_RETRY_DELAY = 500; // Minimum delay before retry (ms)
const MAX_RETRY_DELAY = 2000; // Maximum delay before retry (ms)

const BehaviorDetection = ({ videoTrack, userId, channelName, isEnabled, username = "Unknown User" }) => {
  const canvasRef = useRef(null);
  const processingRef = useRef(false);
  const intervalRef = useRef(null);
  const [active, setActive] = useState(false);
  const retryCountRef = useRef(0);
  const lastCaptureTimeRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Set mounted flag
    mountedRef.current = true;
    
    // Reset on unmount
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Only initialize if all required params are available
    if (!isEnabled || !videoTrack || !videoTrack.getCurrentFrameData) {
      console.log('BehaviorDetection disabled or videoTrack not available for', username || userId);
      setActive(false);
      clearInterval(intervalRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('Canvas reference not available');
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Could not get 2D context from canvas');
      return;
    }

    setActive(true);
    console.log(`Behavior detection activated for ${username} (ID: ${userId})`);

    const processFrame = async () => {
      // Prevent processing if component unmounted, already in progress or too soon after last capture
      const now = Date.now();
      if (!mountedRef.current || processingRef.current || now - lastCaptureTimeRef.current < 2000) return;
      
      // Check for too many consecutive errors - pause processing if we've had too many
      if (consecutiveErrorsRef.current > 5) {
        console.warn(`Pausing behavior detection for ${username} due to too many consecutive errors`);
        clearInterval(intervalRef.current);
        // Try again after a longer delay
        setTimeout(() => {
          if (mountedRef.current) {
            consecutiveErrorsRef.current = 0;
            console.log(`Resuming behavior detection for ${username} after pause`);
            intervalRef.current = setInterval(processFrame, getProcessingInterval());
          }
        }, 15000); // Increased from 10s to 15s for better recovery
        return;
      }
      
      processingRef.current = true;
      lastCaptureTimeRef.current = now;

      try {
        // Make sure videoTrack is still valid
        if (!videoTrack || !videoTrack.getCurrentFrameData) {
          console.warn('Video track no longer available');
          processingRef.current = false;
          return;
        }
        
        // Capture video frame with error handling
        try {
          videoTrack.getCurrentFrameData(canvas);
        } catch (captureError) {
          console.error('Error capturing frame:', captureError);
          processingRef.current = false;
          consecutiveErrorsRef.current++;
          return;
        }
        
        // Convert canvas to blob with error handling
        canvas.toBlob(async (blob) => {
          if (!blob || !mountedRef.current) {
            console.warn('Failed to convert canvas to blob or component unmounted');
            processingRef.current = false;
            return;
          }

          // Create form data
          const formData = new FormData();
          formData.append('frame', blob, 'frame.jpg');
          formData.append('userId', userId);
          formData.append('channelName', channelName);
          if (username) {
            formData.append('username', username);
          }

          // Send to backend for analysis
          try {
            await axios.post(config.getApiURL('api/behavior/analyze'), formData, {
              headers: {
                'Content-Type': 'multipart/form-data'
              },
              timeout: 8000 // 8 second timeout for more reliability
            });
            
            // Reset error counters on success
            retryCountRef.current = 0;
            consecutiveErrorsRef.current = 0;
          } catch (error) {
            console.error('Error sending frame for analysis:', error);
            consecutiveErrorsRef.current++;
            
            // Implement retry logic with exponential backoff
            retryCountRef.current += 1;
            if (retryCountRef.current < MAX_RETRIES && mountedRef.current) {
              // Calculate backoff delay
              const backoffDelay = Math.min(
                MIN_RETRY_DELAY * Math.pow(2, retryCountRef.current - 1),
                MAX_RETRY_DELAY
              );
              
              console.log(`Retrying in ${backoffDelay}ms (attempt ${retryCountRef.current})`);
              
              setTimeout(() => {
                if (mountedRef.current) {
                  processingRef.current = false;
                  processFrame(); // Retry the frame processing
                }
              }, backoffDelay);
              return; // Exit early to avoid setting processingRef.current = false below
            } else {
              console.warn(`Max retries reached for ${username}, will continue monitoring but errors may persist`);
              retryCountRef.current = 0;
            }
          } finally {
            if (retryCountRef.current === 0 && mountedRef.current) { // Only reset if not retrying
              processingRef.current = false;
            }
          }
        }, 'image/jpeg', 0.85); // 85% quality JPEG for better image quality
      } catch (error) {
        console.error('Error processing frame:', error);
        processingRef.current = false;
        consecutiveErrorsRef.current++;
      }
    };

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Reset error counters when restarting
    consecutiveErrorsRef.current = 0;
    retryCountRef.current = 0;
    
    // Use the jittered interval for this instance
    const processingInterval = getProcessingInterval();
    console.log(`Using processing interval of ${processingInterval}ms for ${username}`);
    
    // Start processing frames with a random initial delay to prevent all clients
    // from sending requests at the exact same time
    const initialDelay = Math.random() * 2000; // Random delay between 0-2000ms
    setTimeout(() => {
      if (mountedRef.current) {
        // Start interval and process first frame after delay
        intervalRef.current = setInterval(processFrame, processingInterval);
        processFrame(); // Process first frame immediately after delay
      }
    }, initialDelay);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        console.log('Stopping behavior detection for', username || `user ${userId}`);
        intervalRef.current = null;
      }
      setActive(false);
    };
  }, [videoTrack, userId, channelName, isEnabled, username]);

  // Handle video track changes specifically
  useEffect(() => {
    // Reset processing state when video track changes
    processingRef.current = false;
    retryCountRef.current = 0;
    consecutiveErrorsRef.current = 0;
    
    // If active and video track becomes available, try processing right away
    if (active && videoTrack && videoTrack.getCurrentFrameData && mountedRef.current) {
      const canvas = canvasRef.current;
      if (canvas) {
        setTimeout(() => {
          if (mountedRef.current) {
            try {
              videoTrack.getCurrentFrameData(canvas);
              console.log('Successfully captured initial frame after video track change');
            } catch (error) {
              console.warn('Failed to capture initial frame after video track change:', error);
            }
          }
        }, 500); // Short delay to ensure track is ready
      }
    }
  }, [videoTrack, active]);

  // Generate a stable but randomized processing interval for this component instance
  // This helps prevent all clients from sending frames at the exact same time
  const getProcessingInterval = () => {
    // Create a hash-like value from username and userId
    const userString = `${username}_${userId}`;
    let hash = 0;
    for (let i = 0; i < userString.length; i++) {
      hash = ((hash << 5) - hash) + userString.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    
    // Use the hash to generate a value between -1000 and 1000 ms
    const jitter = (hash % 2000) - 1000;
    
    // Add the jitter to the base interval, with a minimum of 4000ms
    return Math.max(4000, PROCESS_INTERVAL + jitter);
  };

  return (
    <canvas 
      ref={canvasRef} 
      width="640" 
      height="480" 
      style={{ display: 'none' }} 
      data-active={active ? 'true' : 'false'}
      data-interval={getProcessingInterval()}
    />
  );
};

export default BehaviorDetection; 