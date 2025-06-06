import React, { useEffect, useRef } from 'react';
import axios from 'axios';
import config from '../config';

// Frame processing rate (ms)
const PROCESS_INTERVAL = 2000; // Process frames every 2 seconds

const BehaviorDetection = ({ videoTrack, userId, channelName, isEnabled, username = "Unknown User" }) => {
  const canvasRef = useRef(null);
  const processingRef = useRef(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    // Only initialize if all required params are available
    if (!isEnabled || !videoTrack || !videoTrack.getCurrentFrameData) {
      console.log('BehaviorDetection disabled or videoTrack not available for', username || userId);
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

    const processFrame = async () => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        // Make sure videoTrack is still valid
        if (!videoTrack || !videoTrack.getCurrentFrameData) {
          processingRef.current = false;
          return;
        }
        
        // Capture video frame
        videoTrack.getCurrentFrameData(canvas);
        
        // Convert canvas to blob
        canvas.toBlob(async (blob) => {
          if (!blob) {
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
            await axios.post(`${config.API_URL}/api/behavior/analyze`, formData, {
              headers: {
                'Content-Type': 'multipart/form-data'
              }
            });
          } catch (error) {
            console.error('Error sending frame for analysis:', error);
          } finally {
            processingRef.current = false;
          }
        }, 'image/jpeg', 0.8); // 80% quality JPEG
      } catch (error) {
        console.error('Error processing frame:', error);
        processingRef.current = false;
      }
    };

    // Start processing frames
    console.log('Starting behavior detection for', username || `user ${userId}`);
    intervalRef.current = setInterval(processFrame, PROCESS_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        console.log('Stopping behavior detection for', username || `user ${userId}`);
      }
    };
  }, [videoTrack, userId, channelName, isEnabled, username]);

  return (
    <canvas 
      ref={canvasRef} 
      width="640" 
      height="480" 
      style={{ display: 'none' }} 
    />
  );
};

export default BehaviorDetection; 