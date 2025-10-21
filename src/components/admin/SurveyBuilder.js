import React, { useState } from 'react';
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
  InputAdornment
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
  CheckCircle
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
import { generateSurveyFromDescription, adjustSurvey, validateApiKey } from '../../lib/openai';

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
  
  // AI Assistant states
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [apiKeyValid, setApiKeyValid] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuccess, setAiSuccess] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
  const handleValidateApiKey = async () => {
    setAiLoading(true);
    setAiError('');
    setAiSuccess('');
    
    const result = await validateApiKey(openaiApiKey);
    
    setAiLoading(false);
    
    if (result.success) {
      setApiKeyValid(true);
      setAiSuccess('✅ API key validated successfully!');
      // Store API key in sessionStorage
      sessionStorage.setItem('openai_api_key', openaiApiKey);
    } else {
      setApiKeyValid(false);
      setAiError('❌ Invalid API key. Please check and try again.');
    }
  };

  const handleGenerateSurvey = async () => {
    if (!aiDescription.trim()) {
      setAiError('Please enter a survey description');
      return;
    }
    
    if (!openaiApiKey || !apiKeyValid) {
      setAiError('Please validate your OpenAI API key first');
      return;
    }
    
    setAiLoading(true);
    setAiError('');
    setAiSuccess('');
    
    const result = await generateSurveyFromDescription(aiDescription, openaiApiKey);
    
    setAiLoading(false);
    
    if (result.success) {
      // ✅ Post-process the AI-generated config to ensure correct image settings
      const processedConfig = processAIGeneratedConfig(result.surveyConfig);
      onChange(processedConfig);
      setAiSuccess('✅ Survey generated successfully!');
      setAiDescription('');
    } else {
      setAiError(`❌ Failed to generate survey: ${result.error}`);
    }
  };

  const handleAdjustSurvey = async () => {
    if (!aiInstruction.trim()) {
      setAiError('Please enter modification instructions');
      return;
    }
    
    if (!openaiApiKey || !apiKeyValid) {
      setAiError('Please validate your OpenAI API key first');
      return;
    }
    
    setAiLoading(true);
    setAiError('');
    setAiSuccess('');
    
    const result = await adjustSurvey(config, aiInstruction, openaiApiKey);
    
    setAiLoading(false);
    
    if (result.success) {
      // ✅ Post-process the AI-adjusted config to ensure correct image settings
      const processedConfig = processAIGeneratedConfig(result.surveyConfig);
      onChange(processedConfig);
      setAiSuccess('✅ Survey adjusted successfully!');
      setAiInstruction('');
    } else {
      setAiError(`❌ Failed to adjust survey: ${result.error}`);
    }
  };

  return (
    <Box>
      {/* AI Assistant */}
      <Accordion 
        defaultExpanded={false}
        sx={{ 
          mb: 2,
          border: 2,
          borderColor: 'primary.main',
          borderRadius: 2,
          '&:before': { display: 'none' },
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
        }}
      >
        <AccordionSummary 
          expandIcon={<ExpandMore />}
          sx={{ 
            bgcolor: 'primary.main', 
            color: 'white',
            '&:hover': { bgcolor: 'primary.dark' },
            borderRadius: '8px 8px 0 0'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Psychology sx={{ fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              🤖 AI Assistant (OpenAI)
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            
            {/* API Key Section */}
            <Card variant="outlined" sx={{ bgcolor: '#f8f9fa', border: '2px solid #e0e0e0' }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  🔑 OpenAI API Key Configuration
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2' }}>OpenAI Platform</a>
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="OpenAI API Key"
                    type="password"
                    value={openaiApiKey}
                    onChange={(e) => {
                      setOpenaiApiKey(e.target.value);
                      setApiKeyValid(false);
                      setAiError('');
                      setAiSuccess('');
                    }}
                    placeholder="sk-..."
                    InputProps={{
                      endAdornment: apiKeyValid && (
                        <InputAdornment position="end">
                          <CheckCircle color="success" />
                        </InputAdornment>
                      )
                    }}
                    sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                  />
                  <Button
                    variant="contained"
                    onClick={handleValidateApiKey}
                    disabled={!openaiApiKey || aiLoading}
                    sx={{ minWidth: 120, height: 56 }}
                  >
                    {aiLoading ? <CircularProgress size={24} color="inherit" /> : 'Validate'}
                  </Button>
                </Box>
              </CardContent>
            </Card>

            {/* Error/Success Messages */}
            {aiError && (
              <Alert severity="error" onClose={() => setAiError('')}>
                {aiError}
              </Alert>
            )}
            {aiSuccess && (
              <Alert severity="success" onClose={() => setAiSuccess('')}>
                {aiSuccess}
              </Alert>
            )}

            <Divider />

            {/* Generate Survey Section */}
            <Card variant="outlined" sx={{ border: '2px solid #e3f2fd' }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AutoAwesome sx={{ color: 'primary.main' }} />
                  Generate Complete Survey
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Describe your survey in natural language, and AI will generate the complete structure with pages and questions.
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  variant="outlined"
                  label="Survey Description"
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder="Example: Create a streetscape perception survey with 3 pages: 1) Demographics (age, gender, city), 2) Visual Assessment (4 imagerating questions about thermal comfort, safety, aesthetics, walkability - each showing 1 random street scene), 3) Preference (1 imagepicker question to choose preferred street from 4 options, then 1 imageranking question to rank 4 street scenes by overall preference)."
                  disabled={!apiKeyValid}
                  sx={{ mb: 2, '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                />
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={aiLoading ? <CircularProgress size={20} color="inherit" /> : <AutoAwesome />}
                  onClick={handleGenerateSurvey}
                  disabled={!apiKeyValid || !aiDescription.trim() || aiLoading}
                  fullWidth
                  size="large"
                  sx={{ fontWeight: 600 }}
                >
                  {aiLoading ? 'Generating Survey...' : 'Generate Survey'}
                </Button>
              </CardContent>
            </Card>

            <Divider />

            {/* Adjust Survey Section */}
            <Card variant="outlined" sx={{ border: '2px solid #fff3e0' }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Edit sx={{ color: 'secondary.main' }} />
                  Adjust Current Survey
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Tell AI how to modify your existing survey (add questions, change wording, reorder pages, etc.)
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  variant="outlined"
                  label="Modification Instructions"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  placeholder="Example: Add an imagepicker question to choose favorite street type. Add an imageboolean question asking 'Would you bike here?' after the safety rating. Change all imagerating scales to 1-7. Add an imagematrix question comparing 3 streets on cleanliness, greenery, and accessibility."
                  disabled={!apiKeyValid}
                  sx={{ mb: 2, '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
                />
                <Button
                  variant="contained"
                  color="secondary"
                  startIcon={aiLoading ? <CircularProgress size={20} color="inherit" /> : <Edit />}
                  onClick={handleAdjustSurvey}
                  disabled={!apiKeyValid || !aiInstruction.trim() || aiLoading}
                  fullWidth
                  size="large"
                  sx={{ fontWeight: 600 }}
                >
                  {aiLoading ? 'Adjusting Survey...' : 'Adjust Survey'}
                </Button>
              </CardContent>
            </Card>

            {/* Tips */}
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                💡 Pro Tips:
              </Typography>
              <Typography variant="body2" component="div">
                • <strong>For streetscape/visual perception surveys:</strong> AI will automatically use image-based questions (imagepicker, imagerating, imageranking, imageboolean, imagematrix)<br/>
                • <strong>Available question types:</strong><br/>
                &nbsp;&nbsp;- Text-based: rating, multiple choice, text input, Yes/No, ranking, matrix<br/>
                &nbsp;&nbsp;- Image-based: image rating (1-5 scale), image ranking (order by preference), image Yes/No, image matrix<br/>
                • Be specific about the number of pages and questions you want<br/>
                • For adjustments, be clear about what should change and what should stay<br/>
                • The AI uses GPT-4o model for best results<br/>
                • You can always preview and manually edit the generated survey
              </Typography>
            </Alert>
            
            <Alert severity="success" sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                🖼️ Image-Based Questions:
              </Typography>
              <Typography variant="body2" component="div">
                • <strong>imagepicker:</strong> "Which street scene do you prefer?" (choose from multiple options)<br/>
                • <strong>imagerating:</strong> "Rate the thermal comfort of this street (1-5 scale)"<br/>
                • <strong>imageranking:</strong> "Rank 4 street scenes from most to least appealing"<br/>
                • <strong>imageboolean:</strong> "Would you feel safe walking here at night? (Yes/No)"<br/>
                • <strong>imagematrix:</strong> "Rate 3 streets on safety, aesthetics, and walkability"<br/>
                <br/>
                Images will be automatically loaded from your project's dataset!
              </Typography>
            </Alert>
            
            <Alert severity="warning" sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                ⚠️ Important Logic:
              </Typography>
              <Typography variant="body2" component="div">
                • <strong>Demographic questions</strong> (age, gender, education): Use text questions, NO images needed<br/>
                • <strong>Visual perception assessments</strong>: Use image-based question types (imagepicker, imagerating, imageranking, etc.)<br/>
                • <strong>Text questions about streetscape</strong>: Must add an "image" display question BEFORE the text question<br/>
                &nbsp;&nbsp;Example: Show street image → then ask "Describe what you see"<br/>
                <br/>
                ✅ The AI will automatically follow these rules!
              </Typography>
            </Alert>
          </Box>
        </AccordionDetails>
      </Accordion>

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
            
            <TextField
              fullWidth
              variant="outlined"
              label="Logo URL"
              value={config.logo || ''}
              onChange={(e) => handleBasicInfoChange('logo', e.target.value)}
              helperText="Optional: URL to your organization's logo image"
              sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
            />
            
            <FormControl fullWidth variant="outlined">
              <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Logo Position</InputLabel>
              <Select
                value={config.logoPosition || 'right'}
                onChange={(e) => handleBasicInfoChange('logoPosition', e.target.value)}
                label="Logo Position"
              >
                <MenuItem value="left">Left</MenuItem>
                <MenuItem value="right">Right</MenuItem>
                <MenuItem value="top">Top</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Survey Settings */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Display Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Question Numbers
              </Typography>
              <FormControl fullWidth variant="outlined">
                <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Show Question Numbers</InputLabel>
                <Select
                  value={config.showQuestionNumbers || 'off'}
                  onChange={(e) => handleSettingsChange('showQuestionNumbers', e.target.value)}
                  label="Show Question Numbers"
                >
                  <MenuItem value="off">Don't show question numbers</MenuItem>
                  <MenuItem value="on">Show question numbers throughout survey</MenuItem>
                  <MenuItem value="onPage">Show question numbers on each page only</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Progress Bar Settings
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <FormControl fullWidth variant="outlined">
                  <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Progress Bar Position</InputLabel>
                  <Select
                    value={config.showProgressBar || 'aboveheader'}
                    onChange={(e) => handleSettingsChange('showProgressBar', e.target.value)}
                    label="Progress Bar Position"
                  >
                    <MenuItem value="off">Hide progress bar</MenuItem>
                    <MenuItem value="top">Top of page</MenuItem>
                    <MenuItem value="bottom">Bottom of page</MenuItem>
                    <MenuItem value="aboveheader">Above survey header</MenuItem>
                    <MenuItem value="belowheader">Below survey header</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth variant="outlined">
                  <InputLabel sx={{ backgroundColor: 'white', px: 1 }}>Progress Calculation</InputLabel>
                  <Select
                    value={config.progressBarType || 'questions'}
                    onChange={(e) => handleSettingsChange('progressBarType', e.target.value)}
                    label="Progress Calculation"
                  >
                    <MenuItem value="questions">Based on questions answered</MenuItem>
                    <MenuItem value="pages">Based on pages completed</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Text Input Settings
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.autoGrowComment || false}
                    onChange={(e) => handleSettingsChange('autoGrowComment', e.target.checked)}
                  />
                }
                label="Auto-expand text areas as users type"
              />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Color Theme Settings
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Primary Colors */}
                <Typography variant="body2" sx={{ fontWeight: 500, color: 'primary.main' }}>
                  🎨 Primary Colors
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Primary Color:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.primaryColor || '#1976d2'}
                    onChange={(e) => handleThemeChange('primaryColor', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Main buttons, progress bar, active elements
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Primary Light:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.primaryLight || '#42a5f5'}
                    onChange={(e) => handleThemeChange('primaryLight', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Hover states, light accents
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Primary Dark:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.primaryDark || '#1565c0'}
                    onChange={(e) => handleThemeChange('primaryDark', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Active states, pressed buttons
                  </Typography>
                </Box>

                {/* Secondary Colors */}
                <Typography variant="body2" sx={{ fontWeight: 500, color: 'secondary.main', mt: 1 }}>
                  🌈 Secondary Colors
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Secondary Color:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.secondaryColor || '#dc004e'}
                    onChange={(e) => handleThemeChange('secondaryColor', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Secondary buttons, highlights
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Accent Color:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.accentColor || '#ff9800'}
                    onChange={(e) => handleThemeChange('accentColor', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Warning messages, special highlights
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Success Color:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.successColor || '#4caf50'}
                    onChange={(e) => handleThemeChange('successColor', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Success messages, completion indicators
                  </Typography>
                </Box>

                {/* Background Colors */}
                <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', mt: 1 }}>
                  🏠 Background Colors
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Background:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.backgroundColor || '#ffffff'}
                    onChange={(e) => handleThemeChange('backgroundColor', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Main survey background
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Card Background:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.cardBackground || '#f8f9fa'}
                    onChange={(e) => handleThemeChange('cardBackground', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Question cards, panels
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Header Background:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.headerBackground || '#ffffff'}
                    onChange={(e) => handleThemeChange('headerBackground', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Survey header area
                  </Typography>
                </Box>

                {/* Text Colors */}
                <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', mt: 1 }}>
                  📝 Text Colors
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Primary Text:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.textColor || '#212121'}
                    onChange={(e) => handleThemeChange('textColor', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Main text, question titles
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Secondary Text:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.secondaryText || '#757575'}
                    onChange={(e) => handleThemeChange('secondaryText', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Descriptions, help text
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Disabled Text:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.disabledText || '#bdbdbd'}
                    onChange={(e) => handleThemeChange('disabledText', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Disabled elements, placeholders
                  </Typography>
                </Box>

                {/* Border Colors */}
                <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', mt: 1 }}>
                  🔲 Border & Divider Colors
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Border Color:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.borderColor || '#e0e0e0'}
                    onChange={(e) => handleThemeChange('borderColor', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Input borders, dividers
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    Focus Border:
                  </Typography>
                  <input
                    type="color"
                    value={config.theme?.focusBorder || '#1976d2'}
                    onChange={(e) => handleThemeChange('focusBorder', e.target.value)}
                    style={{ 
                      width: 50, 
                      height: 35, 
                      border: 'none', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Focused input borders
                  </Typography>
                </Box>

                {/* Action Buttons */}
                <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap' }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => handleThemeReset()}
                    sx={{ 
                      borderColor: '#666',
                      color: '#666',
                      '&:hover': { 
                        borderColor: '#333',
                        color: '#333',
                        bgcolor: '#f5f5f5'
                      }
                    }}
                  >
                    🔄 Reset to Default
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleThemePreset('research')}
                    sx={{ 
                      bgcolor: '#474747', 
                      color: '#ffffff',
                      '&:hover': { bgcolor: '#363636' }
                    }}
                  >
                    🔬 Yang et al., 2025
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleThemePreset('professional')}
                    sx={{ 
                      bgcolor: '#1976d2',
                      color: '#ffffff',
                      '&:hover': { bgcolor: '#1565c0' }
                    }}
                  >
                    💼 Professional Blue
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleThemePreset('nature')}
                    sx={{ 
                      bgcolor: '#4caf50',
                      color: '#ffffff',
                      '&:hover': { bgcolor: '#388e3c' }
                    }}
                  >
                    🌿 Nature Green
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleThemePreset('warm')}
                    sx={{ 
                      bgcolor: '#ff5722',
                      color: '#ffffff',
                      '&:hover': { bgcolor: '#d84315' }
                    }}
                  >
                    🔥 Warm Orange
                  </Button>
                </Box>
              </Box>
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Pages Management */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Survey Pages</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Organize your survey into pages. Drag and drop to reorder pages.
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
