import React from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  IconButton,
  Typography,
  Avatar,
  Paper,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Switch,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
  Tooltip,
  InputAdornment
} from '@mui/material';
import {
  Send,
  Settings,
  SmartToy,
  PersonOutline,
  Clear,
  Download,
  CheckCircle,
  TipsAndUpdates,
  History,
  Close
} from '@mui/icons-material';

/**
 * ChatAssistant Component
 * A ChatGPT-style interface for survey generation/adjustment
 */
export default function ChatAssistant({
  messages = [],
  userMessage,
  isLoading,
  loadingStatus = '',
  apiKeyValid,
  openaiApiKey,
  contextEnabled,
  recommendations = [],
  currentProject,
  onMessageChange,
  onSendMessage,
  onApiKeyChange,
  onValidateApiKey,
  onContextToggle,
  onClearHistory,
  onDownloadHistory,
  chatEndRef
}) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <Card 
      sx={{ 
        mb: 2,
        border: 2,
        borderColor: 'primary.main',
        borderRadius: 2,
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <Box
        sx={{
          bgcolor: 'primary.main',
          color: 'white',
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SmartToy sx={{ fontSize: 28 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            🤖 AI Assistant
          </Typography>
          {apiKeyValid && (
            <Chip 
              label="Connected" 
              size="small" 
              color="success" 
              icon={<CheckCircle />}
              sx={{ bgcolor: 'success.light', color: 'white' }}
            />
          )}
        </Box>
        
        <Box>
          {messages.length > 0 && (
            <>
              <Tooltip title="Download conversation">
                <IconButton 
                  size="small" 
                  onClick={onDownloadHistory}
                  sx={{ color: 'white', mr: 1 }}
                >
                  <Download />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clear history">
                <IconButton 
                  size="small" 
                  onClick={onClearHistory}
                  sx={{ color: 'white', mr: 1 }}
                >
                  <Clear />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip title="Settings">
            <IconButton 
              size="small" 
              onClick={() => setSettingsOpen(true)}
              sx={{ color: 'white' }}
            >
              <Settings />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <CardContent sx={{ p: 0 }}>
        {/* Recommendations */}
        {contextEnabled && recommendations.length > 0 && (
          <Box sx={{ p: 2, bgcolor: '#e8f5e9', borderBottom: '1px solid #ddd' }}>
            <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <TipsAndUpdates sx={{ color: '#4caf50', fontSize: 20 }} />
              <strong>Smart Recommendations</strong>
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {recommendations.slice(0, 3).map((rec, index) => (
                <Chip
                  key={index}
                  label={rec.message}
                  size="small"
                  color={
                    rec.priority === 'high' ? 'error' :
                    rec.priority === 'medium' ? 'warning' : 'info'
                  }
                  variant="outlined"
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Chat History */}
        <Box 
          sx={{ 
            height: 400, 
            overflowY: 'auto', 
            p: 2,
            bgcolor: '#fafafa'
          }}
        >
          {messages.length === 0 ? (
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              height: '100%',
              color: 'text.secondary'
            }}>
              <SmartToy sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
              <Typography variant="h6" sx={{ mb: 1 }}>
                Welcome to AI Assistant!
              </Typography>
              <Typography variant="body2" textAlign="center" sx={{ maxWidth: 400 }}>
                {apiKeyValid 
                  ? "I can help you create and modify surveys. Just type what you need, and I'll automatically figure out whether to generate a new survey or adjust your existing one!"
                  : "Please configure your OpenAI API key in settings to get started."}
              </Typography>
            </Box>
          ) : (
            <>
              {messages.map((msg) => (
                <Box 
                  key={msg.id}
                  sx={{ 
                    mb: 2,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5
                  }}
                >
                  <Avatar 
                    sx={{ 
                      width: 32, 
                      height: 32,
                      bgcolor: msg.role === 'user' ? '#1976d2' : '#9c27b0'
                    }}
                  >
                    {msg.role === 'user' ? <PersonOutline /> : <SmartToy />}
                  </Avatar>
                  
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="caption" fontWeight="bold">
                        {msg.role === 'user' ? 'You' : 'AI Assistant'}
                      </Typography>
                      {msg.metadata?.actionType && (
                        <Chip 
                          label={msg.metadata.actionType} 
                          size="small"
                          sx={{ height: 18, fontSize: '0.7rem' }}
                        />
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </Typography>
                    </Box>
                    
                    <Paper 
                      sx={{ 
                        p: 1.5,
                        bgcolor: msg.role === 'user' ? '#e3f2fd' : '#f3e5f5',
                        border: msg.metadata?.error ? '1px solid #f44336' : 'none'
                      }}
                    >
                      <Typography 
                        variant="body2" 
                        sx={{ whiteSpace: 'pre-wrap' }}
                      >
                        {msg.content}
                      </Typography>
                    </Paper>
                  </Box>
                </Box>
              ))}
              
              {/* Loading Status (like ChatGPT) */}
              {loadingStatus && (
                <Box 
                  sx={{ 
                    mb: 2,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5
                  }}
                >
                  <Avatar 
                    sx={{ 
                      width: 32, 
                      height: 32,
                      bgcolor: '#9c27b0'
                    }}
                  >
                    <SmartToy />
                  </Avatar>
                  
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="caption" fontWeight="bold">
                        AI Assistant
                      </Typography>
                    </Box>
                    
                    <Paper 
                      sx={{ 
                        p: 1.5,
                        bgcolor: '#f3e5f5',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1
                      }}
                    >
                      <CircularProgress size={16} />
                      <Typography 
                        variant="body2" 
                        color="text.secondary"
                        sx={{ fontStyle: 'italic' }}
                      >
                        {loadingStatus}
                      </Typography>
                    </Paper>
                  </Box>
                </Box>
              )}
              
              <div ref={chatEndRef} />
            </>
          )}
        </Box>

        {/* Input Area */}
        <Box sx={{ p: 2, bgcolor: 'white', borderTop: '1px solid #ddd' }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              multiline
              maxRows={4}
              placeholder={
                apiKeyValid 
                  ? "Type your message... (e.g., 'Create a thermal comfort survey' or 'Add an imagepicker question')"
                  : "Please configure API key in settings first..."
              }
              value={userMessage}
              onChange={(e) => onMessageChange(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={!apiKeyValid || isLoading}
              variant="outlined"
              InputProps={{
                endAdornment: isLoading && (
                  <InputAdornment position="end">
                    <CircularProgress size={20} />
                  </InputAdornment>
                )
              }}
            />
            <IconButton
              color="primary"
              onClick={onSendMessage}
              disabled={!apiKeyValid || !userMessage.trim() || isLoading}
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' },
                '&.Mui-disabled': { bgcolor: 'action.disabledBackground' }
              }}
            >
              <Send />
            </IconButton>
          </Box>
          
          {contextEnabled && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              🧠 Contextual Engineering enabled • Project: <strong>{currentProject?.name || 'Unnamed'}</strong> ({currentProject?.id?.slice(0, 8)}...) • Memory is project-specific
            </Typography>
          )}
        </Box>
      </CardContent>

      {/* Settings Dialog */}
      <Dialog 
        open={settingsOpen} 
        onClose={() => setSettingsOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">AI Assistant Settings</Typography>
            <IconButton size="small" onClick={() => setSettingsOpen(false)}>
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        
        <DialogContent dividers>
          {/* API Key Configuration */}
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            🔑 OpenAI API Key
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a>
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <TextField
              fullWidth
              type="password"
              label="API Key"
              value={openaiApiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="sk-..."
              InputProps={{
                endAdornment: apiKeyValid && (
                  <InputAdornment position="end">
                    <CheckCircle color="success" />
                  </InputAdornment>
                )
              }}
            />
            <Button
              variant="contained"
              onClick={onValidateApiKey}
              disabled={!openaiApiKey}
              sx={{ minWidth: 100 }}
            >
              Validate
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Contextual Engineering */}
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            🧠 Contextual Engineering
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={contextEnabled}
                onChange={(e) => onContextToggle(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="body2">
                  Enable multi-turn conversations and memory
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  AI will remember your preferences and conversation history
                </Typography>
              </Box>
            }
          />

          {contextEnabled && (
            <Box sx={{ mt: 2, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <History fontSize="small" />
                <strong>What's included:</strong>
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemText 
                    primary="Conversation History"
                    secondary="Remembers previous messages in this session"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Working Memory"
                    secondary="Learns your preferences (rating scales, image counts, etc.)"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Session Learning"
                    secondary="Tracks expertise level and provides personalized recommendations"
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              </List>
            </Box>
          )}
        </DialogContent>
        
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

