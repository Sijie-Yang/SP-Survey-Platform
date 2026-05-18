import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  Chip
} from '@mui/material';
import {
  CloudSync,
  CheckCircle,
  Error,
  Info
} from '@mui/icons-material';
import { isR2Configured, checkR2Status } from '../../lib/r2';

export default function ImageManager({ images, onChange }) {
  const [checking, setChecking] = useState(false);
  const [folderStatus, setFolderStatus] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  // Auto-check status on component mount and every 10 seconds
  useEffect(() => {
    if (isR2Configured()) {
      handleCheckStatus();
      const checkInterval = setInterval(() => {
        handleCheckStatus();
      }, 10000);
      return () => clearInterval(checkInterval);
    }
  }, []);

  const handleCheckStatus = async () => {
    setChecking(true);
    setFolderStatus(null);
    try {
      const raw = await checkR2Status();
      setFolderStatus({
        success: raw.connected,
        connected: raw.connected,
        bucketExists: raw.connected,
        imageCount: raw.imageCount || 0,
        error: raw.error,
      });
      setLastChecked(new Date().toLocaleString());
    } catch (error) {
      console.error('Error checking R2 status:', error);
      setFolderStatus({ success: false, error: error.message, bucketExists: false, imageCount: 0 });
    } finally {
      setChecking(false);
    }
  };

  const getStatusIcon = () => {
    if (!folderStatus) return <Info color="action" />;
    if (folderStatus.success && folderStatus.bucketExists) return <CheckCircle color="success" />;
    return <Error color="error" />;
  };

  const getStatusMessage = () => {
    if (!isR2Configured()) {
      return {
        type: 'error',
        message: 'Cloudflare R2 is not configured. Please set REACT_APP_R2_PUBLIC_URL and the server-side R2 environment variables.'
      };
    }
    if (!folderStatus) {
      return { type: 'info', message: 'Click "Check R2 Storage Status" to verify your setup.' };
    }
    if (folderStatus.success && folderStatus.bucketExists) {
      return { type: 'success', message: `✅ Connected to Cloudflare R2! Found ${folderStatus.imageCount} image(s) in the bucket.` };
    }
    return { type: 'error', message: `❌ Connection failed: ${folderStatus.error || 'Unknown error'}` };
  };

  const statusInfo = getStatusMessage();

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, color: 'primary.main' }}>
          Image Manager
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Simplified image management - just check your image folder status and follow the setup guide.
        </Typography>
        
        {/* Setup Instructions */}
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            📋 Setup Instructions:
          </Typography>
          <Typography variant="body2" component="div">
            1. Create a Cloudflare R2 bucket and enable public access (or set a custom domain)<br/>
            2. Create an R2 API token with <strong>Object Read &amp; Write</strong> permissions<br/>
            3. Set server-side env vars: <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>,{' '}
               <code>R2_SECRET_ACCESS_KEY</code>, <code>R2_BUCKET_NAME</code>, <code>R2_PUBLIC_URL</code><br/>
            4. Set client-side env var: <code>REACT_APP_R2_PUBLIC_URL</code> (same value as <code>R2_PUBLIC_URL</code>)<br/>
            5. Click "Check R2 Storage Status" below to verify
          </Typography>
        </Alert>

        {/* Status Alert */}
        <Alert severity={statusInfo.type} sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {getStatusIcon()}
            <Typography variant="body2">
              {statusInfo.message}
            </Typography>
          </Box>
          {lastChecked && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Last checked: {lastChecked}
            </Typography>
          )}
        </Alert>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<CloudSync />}
            onClick={handleCheckStatus}
            disabled={checking || !isR2Configured()}
            size="large"
          >
            {checking ? 'Checking...' : 'Check R2 Storage Status'}
          </Button>
          
        </Box>

        {/* Status Details */}
        {folderStatus && folderStatus.success && (
          <Box sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              📊 Folder Status Details:
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip 
                label={`Bucket: ${folderStatus.bucketExists ? '✅ Found' : '❌ Missing'}`}
                color={folderStatus.bucketExists ? 'success' : 'error'}
                variant="outlined"
              />
              <Chip 
                label={`Images: ${folderStatus.imageCount}`}
                color={folderStatus.imageCount > 0 ? 'success' : 'warning'}
                variant="outlined"
              />
              <Chip 
                label={`R2 Connection: ${folderStatus.connected ? '✅ OK' : '❌ Failed'}`}
                color={folderStatus.connected ? 'success' : 'error'}
                variant="outlined"
              />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
