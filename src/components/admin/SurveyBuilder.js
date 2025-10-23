import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  IconButton,
  Card,
  CardContent,
  CardActions,
  Grid,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  Paper,
  Tooltip,
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar
} from '@mui/material';
import {
  ExpandMore,
  Add,
  Delete,
  Edit,
  DragIndicator,
  ContentCopy,
  AutoAwesome,
  Psychology,
  CheckCircle,
  History,
  TipsAndUpdates,
  Clear,
  Download,
  SmartToy,
  PersonOutline,
  Send,
  Settings,
  Close
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PageEditor from './PageEditor';
import QuestionEditor from './QuestionEditor';
import ChatAssistant from './ChatAssistant';
import { generateSurveyFromDescription, adjustSurvey, validateApiKey } from '../../lib/openai';
import { getConversationHistory } from '../../lib/conversationHistory';
import { getWorkingMemory } from '../../lib/workingMemory';
import { getSessionLearning } from '../../lib/sessionLearning';
import { sendChatMessage, validateApiKey as validateChatApiKey } from '../../lib/chatApi';

// Sortable Page Item Component
function SortablePageItem({ page, pageIndex, onEdit, onDelete, onDuplicate }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `page-${pageIndex}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={{
        mb: 2,
        bgcolor: 'background.paper',
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: 'action.hover',
        },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'grab',
          mr: 2,
          '&:active': {
            cursor: 'grabbing',
          },
        }}
      >
        <DragIndicator color="action" />
      </Box>
      
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="h6">
              {page.title || `Page ${pageIndex + 1}`}
            </Typography>
            <Chip
              label={`${page.elements?.length || 0} questions`}
              size="small"
              color="primary"
              variant="outlined"
            />
          </Box>
        }
        secondary={
          <Typography variant="body2" color="text.secondary">
            {page.description || 'No description provided'}
          </Typography>
        }
      />
      
      <ListItemSecondaryAction>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            color="primary"
            onClick={() => onEdit({ page, index: pageIndex })}
            sx={{ 
              border: 1, 
              borderColor: 'primary.main',
              '&:hover': { bgcolor: 'primary.light', borderColor: 'primary.dark' }
            }}
          >
            <Edit fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="primary"
            onClick={() => onDuplicate(pageIndex)}
            sx={{ 
              border: 1, 
              borderColor: 'primary.main',
              '&:hover': { bgcolor: 'primary.light', borderColor: 'primary.dark' }
            }}
          >
            <ContentCopy fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            onClick={() => onDelete(pageIndex)}
            sx={{ 
              border: 1, 
              borderColor: 'error.main',
              '&:hover': { bgcolor: 'error.light', borderColor: 'error.dark' }
            }}
          >
            <Delete fontSize="small" />
          </IconButton>
        </Box>
      </ListItemSecondaryAction>
    </ListItem>
  );
}

export default function SurveyBuilder({ config, onChange, currentProject, onNextStep }) {
  const [selectedPage, setSelectedPage] = useState(null);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  
  // Chat Assistant states
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [apiKeyValid, setApiKeyValid] = useState(false);
  const [userMessage, setUserMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Contextual Engineering states
  const conversationHistoryRef = useRef(null);
  const workingMemoryRef = useRef(null);
  const sessionLearningRef = useRef(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [contextEnabled, setContextEnabled] = useState(true);
  
  // Chat scroll reference
  const chatEndRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Initialize Contextual Engineering modules
  useEffect(() => {
    if (currentProject?.id && contextEnabled) {
      // Initialize modules
      conversationHistoryRef.current = getConversationHistory(currentProject.id);
      workingMemoryRef.current = getWorkingMemory(currentProject.id);
      sessionLearningRef.current = getSessionLearning();
      
      // Load conversation history
      const history = conversationHistoryRef.current.getAllMessages();
      setConversationMessages(history);
      
      // Get recommendations
      const surveyType = currentProject.category || 'general';
      const recs = sessionLearningRef.current.getRecommendations(surveyType);
      setRecommendations(recs);
      
      console.log('🧠 Contextual Engineering initialized:', {
        projectId: currentProject.id,
        historyMessages: history.length,
        recommendations: recs.length
      });
    }
  }, [currentProject?.id, contextEnabled]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationMessages]);

  const handleBasicInfoChange = (field, value) => {
    onChange({
      ...config,
      [field]: value
    });
  };

  const handleSettingsChange = (field, value) => {
    // Set SurveyJS standard properties directly at root level
    onChange({
      ...config,
      [field]: value
    });
  };

  const handleThemeChange = (field, value) => {
    onChange({
      ...config,
      theme: {
        ...config.theme,
        [field]: value
      }
    });
  };

  const handleThemeReset = () => {
    onChange({
      ...config,
      theme: {
        primaryColor: '#1976d2',
        primaryLight: '#42a5f5',
        primaryDark: '#1565c0',
        secondaryColor: '#dc004e',
        accentColor: '#ff9800',
        successColor: '#4caf50',
        backgroundColor: '#ffffff',
        cardBackground: '#f8f9fa',
        headerBackground: '#ffffff',
        textColor: '#212121',
        secondaryText: '#757575',
        disabledText: '#bdbdbd',
        borderColor: '#e0e0e0',
        focusBorder: '#1976d2'
      }
    });
  };

  const handleThemePreset = (presetName) => {
    const presets = {
      research: {
        // Fully copy theme configuration from original research survey
        primaryColor: '#474747',
        primaryLight: '#6a6a6a',
        primaryDark: '#2e2e2e',
        secondaryColor: '#ff9814', // rgba(255, 152, 20, 1)
        accentColor: '#e50a3e', // rgba(229, 10, 62, 1) - special red
        successColor: '#19b394', // rgba(25, 179, 148, 1) - special green
        backgroundColor: '#ffffff', // rgba(255, 255, 255, 1)
        cardBackground: '#f8f8f8', // rgba(248, 248, 248, 1)
        headerBackground: '#f3f3f3', // rgba(243, 243, 243, 1)
        textColor: '#000000', // rgba(0, 0, 0, 0.91)
        secondaryText: '#737373', // rgba(0, 0, 0, 0.45)
        disabledText: '#737373', // rgba(0, 0, 0, 0.45)
        borderColor: '#292929', // rgba(0, 0, 0, 0.16)
        focusBorder: '#437fd9' // rgba(67, 127, 217, 1) - special blue
      },
      professional: {
        primaryColor: '#1976d2',
        primaryLight: '#42a5f5',
        primaryDark: '#1565c0',
        secondaryColor: '#f57c00',
        accentColor: '#ff9800',
        successColor: '#4caf50',
        backgroundColor: '#ffffff',
        cardBackground: '#f8f9fa',
        headerBackground: '#fafafa',
        textColor: '#212121',
        secondaryText: '#616161',
        disabledText: '#bdbdbd',
        borderColor: '#e0e0e0',
        focusBorder: '#1976d2'
      },
      nature: {
        primaryColor: '#4caf50',
        primaryLight: '#81c784',
        primaryDark: '#388e3c',
        secondaryColor: '#ff9800',
        accentColor: '#ffc107',
        successColor: '#8bc34a',
        backgroundColor: '#f1f8e9',
        cardBackground: '#ffffff',
        headerBackground: '#e8f5e8',
        textColor: '#1b5e20',
        secondaryText: '#4caf50',
        disabledText: '#a5d6a7',
        borderColor: '#c8e6c9',
        focusBorder: '#4caf50'
      },
      warm: {
        primaryColor: '#ff5722',
        primaryLight: '#ff8a65',
        primaryDark: '#d84315',
        secondaryColor: '#ffc107',
        accentColor: '#ff9800',
        successColor: '#4caf50',
        backgroundColor: '#fff8f0',
        cardBackground: '#ffffff',
        headerBackground: '#ffeaa7',
        textColor: '#3e2723',
        secondaryText: '#6d4c41',
        disabledText: '#bcaaa4',
        borderColor: '#d7ccc8',
        focusBorder: '#ff5722'
      }
    };

    if (presets[presetName]) {
      onChange({
        ...config,
        theme: presets[presetName]
      });
    }
  };

  const addNewPage = () => {
    const newPage = {
      name: `page_${Date.now()}`,
      title: "New Page",
      description: "Page description",
      elements: []
    };
    
    onChange({
      ...config,
      pages: [...config.pages, newPage]
    });
  };

  const deletePage = (pageIndex) => {
    const newPages = config.pages.filter((_, index) => index !== pageIndex);
    onChange({
      ...config,
      pages: newPages
    });
    setSelectedPage(null);
  };

  const duplicatePage = (pageIndex) => {
    const pageToDuplicate = config.pages[pageIndex];
    // Deep clone the page
    const duplicatedPage = JSON.parse(JSON.stringify(pageToDuplicate));
    
    const underscoreNumberPattern = /_(\d+)$/;
    
    // Smart name generation for page: check if name ends with _number
    const originalPageName = pageToDuplicate.name;
    const pageNameMatch = originalPageName.match(underscoreNumberPattern);
    
    if (pageNameMatch) {
      // Name ends with _number, increment the number
      const currentNumber = parseInt(pageNameMatch[1], 10);
      const newNumber = currentNumber + 1;
      duplicatedPage.name = originalPageName.replace(underscoreNumberPattern, `_${newNumber}`);
    } else {
      // Name doesn't end with _number, add _1
      duplicatedPage.name = `${originalPageName}_1`;
    }
    
    // Smart title generation for page: check if title ends with _number
    const originalTitle = pageToDuplicate.title || `Page ${pageIndex + 1}`;
    const titleMatch = originalTitle.match(underscoreNumberPattern);
    
    if (titleMatch) {
      // Title ends with _number, increment the number
      const currentNumber = parseInt(titleMatch[1], 10);
      const newNumber = currentNumber + 1;
      duplicatedPage.title = originalTitle.replace(underscoreNumberPattern, `_${newNumber}`);
    } else {
      // Title doesn't end with _number, add _1
      duplicatedPage.title = `${originalTitle}_1`;
    }
    
    // Generate new unique names for all questions in the duplicated page using smart numbering
    if (duplicatedPage.elements) {
      duplicatedPage.elements = duplicatedPage.elements.map(element => {
        const originalElementName = element.name;
        const elementNameMatch = originalElementName.match(underscoreNumberPattern);
        
        let newElementName;
        if (elementNameMatch) {
          // Name ends with _number, increment the number
          const currentNumber = parseInt(elementNameMatch[1], 10);
          const newNumber = currentNumber + 1;
          newElementName = originalElementName.replace(underscoreNumberPattern, `_${newNumber}`);
        } else {
          // Name doesn't end with _number, add _1
          newElementName = `${originalElementName}_1`;
        }
        
        return {
          ...element,
          name: newElementName
        };
      });
    }
    
    // Insert the duplicated page right after the original
    const newPages = [
      ...config.pages.slice(0, pageIndex + 1),
      duplicatedPage,
      ...config.pages.slice(pageIndex + 1)
    ];
    
    onChange({
      ...config,
      pages: newPages
    });
  };

  const updatePage = (pageIndex, updatedPage) => {
    const newPages = [...config.pages];
    newPages[pageIndex] = updatedPage;
    onChange({
      ...config,
      pages: newPages
    });
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = parseInt(active.id.split('-')[1]);
      const newIndex = parseInt(over.id.split('-')[1]);

      const newPages = arrayMove(config.pages, oldIndex, newIndex);
      onChange({
        ...config,
        pages: newPages
      });
    }
  };

  // ✅ Post-process AI-generated config to ensure all image questions have correct settings
  const processAIGeneratedConfig = (surveyConfig) => {
    const imageQuestionTypes = ['imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix'];
    
    const processedConfig = JSON.parse(JSON.stringify(surveyConfig)); // Deep clone
    
    if (processedConfig.pages && Array.isArray(processedConfig.pages)) {
      processedConfig.pages.forEach(page => {
        if (page.elements && Array.isArray(page.elements)) {
          page.elements.forEach(element => {
            if (imageQuestionTypes.includes(element.type)) {
              // Ensure image questions have correct default settings
              if (!element.imageSelectionMode || element.imageSelectionMode === 'random') {
                element.imageSelectionMode = 'huggingface_random';
              }
              element.randomImageSelection = true;
              if (!element.choices) {
                element.choices = [];
              }
              if (element.type === 'imagematrix' && !element.imageLinks) {
                element.imageLinks = [];
              }
              
              // ✅ Remove unnecessary global config fields that should not be saved per question
              delete element.imageSource;
              delete element.huggingFaceConfig;
              
              console.log(`✅ Post-processed ${element.type} question: ${element.name}`);
            }
          });
        }
      });
    }
    
    return processedConfig;
  };

  // AI Assistant handlers
  // Validate API Key
  const handleValidateApiKey = async () => {
    setIsLoading(true);
    
    const result = await validateChatApiKey(openaiApiKey);
    
    setIsLoading(false);
    
    if (result.success) {
      setApiKeyValid(true);
      sessionStorage.setItem('openai_api_key', openaiApiKey);
      
      // Add system message
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          '✅ API key validated! I\'m ready to help you create and modify surveys. Just type what you need!',
          { actionType: 'system' }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
    } else {
      setApiKeyValid(false);
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          '❌ Invalid API key. Please check and try again in settings.',
          { actionType: 'system', error: true }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
    }
  };

  // Send chat message (unified handler for generate/adjust/question)
  const handleSendMessage = async () => {
    if (!userMessage.trim()) return;
    if (!openaiApiKey || !apiKeyValid) {
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          '⚠️ Please configure and validate your OpenAI API key in settings first.',
          { actionType: 'system', error: true }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
      return;
    }

    // Add user message to UI immediately
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.addMessage('user', userMessage, {
        actionType: 'chat',
        timestamp: new Date().toISOString()
      });
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }

    const currentUserMessage = userMessage;
    setUserMessage(''); // Clear input
    setIsLoading(true);

    try {
      // Build conversation history for API (last 10 messages)
      const apiHistory = conversationHistoryRef.current
        ?.getFormattedForOpenAI(10) || [];

      // Enrich with contextual engineering context if enabled
      let enrichedHistory = apiHistory;
      if (contextEnabled && workingMemoryRef.current && sessionLearningRef.current) {
        const workingContext = workingMemoryRef.current.getContextForAI();
        const sessionContext = sessionLearningRef.current.getContextForAI(currentProject?.category);
        
        // Prepend context as system messages
        enrichedHistory = [
          { role: 'system', content: sessionContext },
          { role: 'system', content: workingContext },
          ...apiHistory
        ];
        
        console.log('🧠 Using contextual prompt with memory');
      }

      // Call intelligent chat API
      const result = await sendChatMessage(
        currentUserMessage,
        config,
        enrichedHistory,
        openaiApiKey
      );

      setIsLoading(false);

      if (result.success) {
        // Add AI response to conversation
        if (conversationHistoryRef.current) {
          conversationHistoryRef.current.addMessage('assistant', result.message, {
            actionType: result.intent,
            timestamp: new Date().toISOString()
          });
          setConversationMessages(conversationHistoryRef.current.getAllMessages());
        }

        // If survey config was generated/adjusted, apply it
        if (result.surveyConfig) {
          const processedConfig = processAIGeneratedConfig(result.surveyConfig);
          onChange(processedConfig);

          // Update contextual engineering memories
          if (contextEnabled) {
            if (workingMemoryRef.current) {
              if (result.intent === 'generate') {
                workingMemoryRef.current.setSurveyGoal(currentUserMessage);
              }
              workingMemoryRef.current.addIteration(processedConfig, currentUserMessage);
              if (result.intent === 'adjust') {
                workingMemoryRef.current.addDesignDecision(currentUserMessage, 'User requested adjustment');
              }
            }

            if (sessionLearningRef.current) {
              sessionLearningRef.current.recordProjectInteraction(
                currentProject?.id,
                currentProject?.category || 'general',
                result.intent === 'generate' ? 'generate_survey' : 'adjust_survey'
              );
            }
          }
        }
      } else {
        // Error handling
        if (conversationHistoryRef.current) {
          conversationHistoryRef.current.addMessage('assistant', 
            `❌ Error: ${result.error}`,
            { actionType: 'error', error: true }
          );
          setConversationMessages(conversationHistoryRef.current.getAllMessages());
        }
      }
    } catch (error) {
      setIsLoading(false);
      console.error('Error sending message:', error);
      
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.addMessage('assistant', 
          `❌ Unexpected error: ${error.message}`,
          { actionType: 'error', error: true }
        );
        setConversationMessages(conversationHistoryRef.current.getAllMessages());
      }
    }
  };

  // Old handlers removed - now using unified handleSendMessage

  return (
    <Box>
      {/* AI Chat Assistant */}
      <ChatAssistant
        messages={conversationMessages}
        userMessage={userMessage}
        isLoading={isLoading}
        apiKeyValid={apiKeyValid}
        openaiApiKey={openaiApiKey}
        contextEnabled={contextEnabled}
        recommendations={recommendations}
        onMessageChange={setUserMessage}
        onSendMessage={handleSendMessage}
        onApiKeyChange={setOpenaiApiKey}
        onValidateApiKey={handleValidateApiKey}
        onContextToggle={setContextEnabled}
        onClearHistory={() => {
          if (window.confirm('Clear conversation history?')) {
            conversationHistoryRef.current?.clear();
            setConversationMessages([]);
          }
        }}
        onDownloadHistory={() => {
          const data = conversationHistoryRef.current?.export();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `conversation_${currentProject?.id}_${new Date().toISOString()}.json`;
          a.click();
        }}
        chatEndRef={chatEndRef}
      />

      {/* Basic Survey Information */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Basic Information</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              fullWidth
              variant="outlined"
              label="Survey Title"
              value={config.title || ''}
              onChange={(e) => handleBasicInfoChange('title', e.target.value)}
              helperText="The main title that appears at the top of your survey"
              sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
            />
            
            <TextField
              fullWidth
              variant="outlined"
              multiline
              rows={3}
              label="Survey Description"
              value={config.description || ''}
              onChange={(e) => handleBasicInfoChange('description', e.target.value)}
              helperText="A brief description explaining the purpose of your survey"
              sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
            />
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Pages and Questions */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Pages & Questions</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Organize your survey into pages. Drag pages to reorder them.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={addNewPage}
                size="large"
              >
                Add New Page
              </Button>
            </Box>
          </Box>

          {config.pages && config.pages.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={config.pages.map((_, index) => `page-${index}`)}
                strategy={verticalListSortingStrategy}
              >
                <List sx={{ width: '100%' }}>
                  {config.pages.map((page, pageIndex) => (
                    <SortablePageItem
                      key={`page-${pageIndex}`}
                      page={page}
                      pageIndex={pageIndex}
                      onEdit={setSelectedPage}
                      onDuplicate={duplicatePage}
                      onDelete={deletePage}
                    />
                  ))}
                </List>
              </SortableContext>
            </DndContext>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No pages created yet. Click "Add New Page" to get started.
              </Typography>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Page Editor Dialog */}
      {selectedPage && (
        <PageEditor
          page={selectedPage.page}
          pageIndex={selectedPage.index}
          onSave={(updatedPage) => {
            updatePage(selectedPage.index, updatedPage);
            setSelectedPage(null);
          }}
          onCancel={() => setSelectedPage(null)}
          images={config.images || []}
          currentProject={currentProject}
        />
      )}

      {/* Question Editor Dialog */}
      {selectedQuestion && (
        <QuestionEditor
          question={selectedQuestion.question}
          onSave={(updatedQuestion) => {
            // Handle question update
            setSelectedQuestion(null);
          }}
          onCancel={() => setSelectedQuestion(null)}
          images={config.images || []}
          currentProject={currentProject}
        />
      )}
      
      {/* Next Step Button */}
      {onNextStep && (
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            color="primary"
            size="large"
            onClick={onNextStep}
            sx={{
              px: 4,
              py: 1.5,
              fontWeight: 600
            }}
          >
            Next: Server Setup →
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default SurveyBuilder;
