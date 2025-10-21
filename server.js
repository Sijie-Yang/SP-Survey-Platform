const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS for React app
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

const TEMPLATES_PATH = path.join(__dirname, 'public', 'project_templates');
const PROJECTS_PATH = path.join(__dirname, 'public', 'projects');
const DEPLOYMENTS_PATH = path.join(__dirname, 'deployments');

// Ensure directories exist
fs.ensureDirSync(TEMPLATES_PATH);
fs.ensureDirSync(PROJECTS_PATH);
fs.ensureDirSync(DEPLOYMENTS_PATH);

// Template endpoints
app.post('/api/templates', async (req, res) => {
  try {
    const { template } = req.body;
    const filename = `${template.id}.json`;
    const filePath = path.join(TEMPLATES_PATH, filename);
    
    await fs.writeFile(filePath, JSON.stringify(template, null, 2), 'utf8');
    
    console.log(`✅ Template "${template.name}" saved to ${filePath}`);
    res.json({ success: true, filename, filePath });
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/templates/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const filename = `${templateId}.json`;
    const filePath = path.join(TEMPLATES_PATH, filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.unlink(filePath);
      console.log(`✅ Template file ${filename} deleted from ${filePath}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Project endpoints
app.post('/api/projects', async (req, res) => {
  try {
    const { project, surveyConfig, supabaseConfig } = req.body;
    const filename = `${project.id}.json`;
    const filePath = path.join(PROJECTS_PATH, filename);
    
    const projectData = {
      project,
      surveyConfig,
      supabaseConfig,
      savedAt: new Date().toISOString(),
      version: '2.0'
    };
    
    await fs.writeFile(filePath, JSON.stringify(projectData, null, 2), 'utf8');
    
    console.log(`✅ Project "${project.name}" saved to ${filePath}`);
    res.json({ success: true, filename, filePath });
  } catch (error) {
    console.error('Error saving project:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET single project data
app.get('/api/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const filename = `${projectId}.json`;
    const filePath = path.join(PROJECTS_PATH, filename);
    
    if (await fs.pathExists(filePath)) {
      const data = await fs.readFile(filePath, 'utf8');
      const projectData = JSON.parse(data);
      console.log(`✅ Loaded project data for ${projectId}`);
      res.json({ success: true, project: projectData.project, surveyConfig: projectData.surveyConfig });
    } else {
      res.status(404).json({ success: false, error: 'Project not found' });
    }
  } catch (error) {
    console.error('Error loading project:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const filename = `${projectId}.json`;
    const filePath = path.join(PROJECTS_PATH, filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.unlink(filePath);
      console.log(`✅ Project file ${filename} deleted from ${filePath}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List files endpoints
app.get('/api/templates', async (req, res) => {
  try {
    const files = await fs.readdir(TEMPLATES_PATH);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    res.json({ files: jsonFiles });
  } catch (error) {
    console.error('Error listing templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const files = await fs.readdir(PROJECTS_PATH);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    res.json({ files: jsonFiles });
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Deployment endpoints
app.post('/api/create-deployment', async (req, res) => {
  try {
    const { projectName, files } = req.body;
    
    if (!projectName || !files) {
      return res.status(400).json({ success: false, error: 'Project name and files are required' });
    }
    
    // Create deployment folder with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deploymentFolderName = `${projectName}-${timestamp}`;
    const deploymentPath = path.join(DEPLOYMENTS_PATH, deploymentFolderName);
    
    // Ensure deployment folder exists
    await fs.ensureDir(deploymentPath);
    
    // Copy source files (excluding admin components and original SurveyApp)
    const srcPath = path.join(__dirname, 'src');
    const publicPath = path.join(__dirname, 'public');
    
    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, path.join(deploymentPath, 'src'), {
        filter: (src) => {
          // Exclude admin-related files and original SurveyApp (using SurveyAppClean instead)
          const relativePath = path.relative(srcPath, src);
          const excludePaths = [
            'AdminApp.js',
            'SurveyApp.js',
            'components/admin'
          ];
          return !excludePaths.some(excludePath => relativePath.includes(excludePath));
        }
      });
    }
    
    if (await fs.pathExists(publicPath)) {
      await fs.copy(publicPath, path.join(deploymentPath, 'public'));
    }
    
    // Write deployment-specific files (this will overwrite src/App.js with survey-only version)
    for (const [fileName, content] of Object.entries(files)) {
      const filePath = path.join(deploymentPath, fileName);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, 'utf8');
    }
    
    console.log(`✅ Deployment folder created: ${deploymentPath}`);
    
    res.json({ 
      success: true, 
      deploymentPath: deploymentPath,
      deploymentName: deploymentFolderName
    });
  } catch (error) {
    console.error('Error creating deployment folder:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/deployment-status', async (req, res) => {
  try {
    const deployments = [];
    
    if (await fs.pathExists(DEPLOYMENTS_PATH)) {
      const items = await fs.readdir(DEPLOYMENTS_PATH);
      
      for (const item of items) {
        const itemPath = path.join(DEPLOYMENTS_PATH, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          deployments.push({
            name: item,
            path: itemPath,
            created: stats.birthtime,
            size: await getFolderSize(itemPath)
          });
        }
      }
    }
    
    // Sort by creation date (newest first)
    deployments.sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json({ deployments });
  } catch (error) {
    console.error('Error getting deployment status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test deployment build
app.post('/api/test-deployment', async (req, res) => {
  try {
    const { deploymentPath } = req.body;
    
    if (!deploymentPath) {
      return res.status(400).json({ success: false, error: 'Deployment path is required' });
    }
    
    if (!await fs.pathExists(deploymentPath)) {
      return res.status(404).json({ success: false, error: 'Deployment folder not found' });
    }
    
    console.log(`🧪 Testing deployment at: ${deploymentPath}`);
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    let fullOutput = '';
    
    // Run npm install
    fullOutput += '📦 Running npm install...\n';
    fullOutput += '─'.repeat(80) + '\n';
    console.log('📦 Running npm install...');
    try {
      const { stdout: installStdout, stderr: installStderr } = await execPromise('npm install', { 
        cwd: deploymentPath, 
        maxBuffer: 10 * 1024 * 1024 
      });
      fullOutput += installStdout || '';
      if (installStderr) fullOutput += installStderr;
      fullOutput += '\n✅ npm install completed\n\n';
      console.log('✅ npm install completed');
    } catch (error) {
      console.error('❌ npm install failed:', error.message);
      fullOutput += `\n❌ npm install failed:\n${error.message}\n`;
      return res.json({ 
        success: false, 
        error: 'npm install failed: ' + error.message,
        step: 'install',
        output: fullOutput
      });
    }
    
    // Run npm run build
    fullOutput += '🏗️  Running npm run build...\n';
    fullOutput += '─'.repeat(80) + '\n';
    console.log('🏗️  Running npm run build...');
    try {
      const { stdout: buildStdout, stderr: buildStderr } = await execPromise('npm run build', { 
        cwd: deploymentPath,
        maxBuffer: 10 * 1024 * 1024
      });
      fullOutput += buildStdout || '';
      if (buildStderr) fullOutput += buildStderr;
      fullOutput += '\n✅ npm run build completed\n\n';
      console.log('✅ npm run build completed');
      
      // Find an available port for preview server
      const findAvailablePort = async (startPort) => {
        const net = require('net');
        return new Promise((resolve) => {
          const server = net.createServer();
          server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
          });
          server.on('error', () => {
            resolve(findAvailablePort(startPort + 1));
          });
        });
      };
      
      const previewPort = await findAvailablePort(3100);
      
      // Start preview server in background
      const buildPath = path.join(deploymentPath, 'build');
      if (await fs.pathExists(buildPath)) {
        // Use serve to start preview server
        const serveProcess = exec(`npx serve -s build -l ${previewPort} --no-clipboard`, { 
          cwd: deploymentPath 
        });
        
        fullOutput += `\n🌐 Preview server started at: http://localhost:${previewPort}\n`;
        fullOutput += '─'.repeat(80) + '\n';
        fullOutput += '\n✅ Build test completed successfully!\n';
        
        res.json({ 
          success: true, 
          message: 'Deployment test completed successfully!',
          output: fullOutput,
          previewUrl: `http://localhost:${previewPort}`,
          previewPort: previewPort
        });
      } else {
        res.json({ 
          success: true, 
          message: 'Build completed but no build folder found',
          output: fullOutput
        });
      }
    } catch (error) {
      console.error('❌ npm run build failed:', error.message);
      fullOutput += `\n❌ npm run build failed:\n${error.message}\n`;
      return res.json({ 
        success: false, 
        error: 'npm run build failed: ' + error.message,
        step: 'build',
        output: fullOutput
      });
    }
  } catch (error) {
    console.error('Error testing deployment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload to GitHub
app.post('/api/upload-to-github', async (req, res) => {
  try {
    const { deploymentPath, githubRepoUrl, commitMessage } = req.body;
    
    if (!deploymentPath || !githubRepoUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'Deployment path and GitHub repo URL are required' 
      });
    }
    
    if (!await fs.pathExists(deploymentPath)) {
      return res.status(404).json({ success: false, error: 'Deployment folder not found' });
    }
    
    console.log(`📤 Uploading to GitHub: ${githubRepoUrl}`);
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    try {
      // Check if .git already exists
      const gitPath = path.join(deploymentPath, '.git');
      const gitExists = await fs.pathExists(gitPath);
      
      const execOptions = { 
        cwd: deploymentPath,
        maxBuffer: 50 * 1024 * 1024 // Increase buffer to 50MB for large repos
      };
      
      if (!gitExists) {
        // Initialize git repository
        console.log('🔧 Initializing git repository...');
        await execPromise('git init', execOptions);
        await execPromise('git branch -M main', execOptions);
      }
      
      // Add all files
      console.log('📝 Adding files to git...');
      await execPromise('git add .', execOptions);
      
      // Commit with --quiet flag to reduce output
      console.log('💾 Committing changes...');
      const message = commitMessage || 'Initial deployment setup';
      await execPromise(`git commit --quiet -m "${message}"`, execOptions);
      
      // Add remote if not exists
      if (!gitExists) {
        console.log('🔗 Adding remote origin...');
        await execPromise(`git remote add origin ${githubRepoUrl}`, execOptions);
      } else {
        // Try to set the remote URL
        try {
          await execPromise(`git remote set-url origin ${githubRepoUrl}`, execOptions);
        } catch (e) {
          console.log('Remote already set correctly');
        }
      }
      
      // Push to GitHub with --quiet flag
      console.log('🚀 Pushing to GitHub...');
      try {
        await execPromise('git push --quiet -u origin main', execOptions);
        console.log('✅ Successfully uploaded to GitHub!');
      } catch (pushError) {
        // If push fails due to remote having changes, force push
        if (pushError.message.includes('rejected') || pushError.message.includes('fetch first')) {
          console.log('⚠️  Remote has changes, force pushing...');
          await execPromise('git push --quiet --force -u origin main', execOptions);
          console.log('✅ Force push successful!');
        } else {
          throw pushError;
        }
      }
      
      res.json({ 
        success: true, 
        message: 'Successfully uploaded to GitHub!',
        repoUrl: githubRepoUrl
      });
    } catch (error) {
      console.error('❌ Git operation failed:', error.message);
      
      // Provide helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('Permission denied')) {
        errorMessage = 'Git push failed: Permission denied. Please make sure you have set up SSH keys or use a personal access token.';
      } else if (error.message.includes('remote: Repository not found')) {
        errorMessage = 'GitHub repository not found. Please create the repository first on GitHub.';
      }
      
      return res.json({ 
        success: false, 
        error: errorMessage
      });
    }
  } catch (error) {
    console.error('Error uploading to GitHub:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to get folder size
async function getFolderSize(folderPath) {
  let totalSize = 0;
  
  try {
    const items = await fs.readdir(folderPath);
    
    for (const item of items) {
      const itemPath = path.join(folderPath, item);
      const stats = await fs.stat(itemPath);
      
      if (stats.isDirectory()) {
        totalSize += await getFolderSize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.warn(`Could not calculate size for ${folderPath}:`, error.message);
  }
  
  return totalSize;
}

// ✅ Survey response endpoint (saves to file instead of localStorage!)
app.post('/api/responses', async (req, res) => {
  try {
    const responseData = req.body;
    const RESPONSES_PATH = path.join(__dirname, 'public', 'responses');
    
    // Ensure responses directory exists
    await fs.ensureDir(RESPONSES_PATH);
    
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `response_${responseData.participant_id}_${timestamp}.json`;
    const filePath = path.join(RESPONSES_PATH, filename);
    
    await fs.writeFile(filePath, JSON.stringify(responseData, null, 2), 'utf8');
    
    console.log(`✅ Survey response saved to ${filePath}`);
    res.json({ success: true, filename, filePath });
  } catch (error) {
    console.error('Error saving survey response:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Backend restart endpoint
app.post('/api/restart', async (req, res) => {
  try {
    console.log('🔄 Backend restart requested...');
    
    // Send response first
    res.json({ 
      success: true, 
      message: 'Server restart initiated. Please wait 5-10 seconds for the server to restart.' 
    });
    
    // Gracefully restart after sending response
    setTimeout(() => {
      console.log('🔄 Restarting server...');
      process.exit(0); // Exit with success code, process manager should restart
    }, 1000);
  } catch (error) {
    console.error('Error restarting server:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ OpenAI API endpoints for AI-powered survey generation
const OpenAI = require('openai');

// Validate OpenAI API key
app.post('/api/openai/validate-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }
    
    const openai = new OpenAI({ apiKey });
    
    // Try a simple API call to validate the key
    await openai.models.list();
    
    console.log('✅ OpenAI API key validated successfully');
    res.json({ success: true, valid: true });
  } catch (error) {
    console.error('❌ OpenAI API key validation failed:', error.message);
    res.status(400).json({ success: false, valid: false, error: 'Invalid API key' });
  }
});

// Generate survey from natural language description
app.post('/api/openai/generate-survey', async (req, res) => {
  try {
    const { description, apiKey } = req.body;
    
    if (!apiKey || !description) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key and description are required' 
      });
    }
    
    const openai = new OpenAI({ apiKey });
    
    const systemPrompt = `You are an expert survey designer specializing in visual perception and streetscape surveys. Generate a complete survey configuration in JSON format based on the user's description.

The survey must follow this structure:
{
  "title": "Survey Title",
  "description": "Survey description",
  "logo": "",
  "logoPosition": "right",
  "showQuestionNumbers": "off",
  "showProgressBar": "aboveheader",
  "progressBarType": "questions",
  "autoGrowComment": true,
  "theme": {
    "primaryColor": "#474747",
    "primaryLight": "#6a6a6a",
    "primaryDark": "#2e2e2e",
    "secondaryColor": "#ff9814",
    "accentColor": "#e50a3e",
    "successColor": "#19b394",
    "backgroundColor": "#ffffff",
    "cardBackground": "#f8f8f8",
    "headerBackground": "#f3f3f3",
    "textColor": "#000000",
    "secondaryText": "#737373",
    "disabledText": "#737373",
    "borderColor": "#292929",
    "focusBorder": "#437fd9"
  },
  "pages": [...]
}

Available question types:

TEXT-BASED QUESTIONS:
- text: Single-line text input
- comment: Multi-line text area
- radiogroup: Single choice (radio buttons) - needs "choices" array
- checkbox: Multiple choice (checkboxes) - needs "choices" array
- dropdown: Dropdown selection - needs "choices" array
- boolean: Yes/No question
- rating: Rating scale - needs "rateMin" (default 1) and "rateMax" (default 5)
- ranking: Rank items in order - needs "choices" array
- matrix: Matrix/grid question - needs "rows" and "columns" arrays

IMAGE-BASED QUESTIONS (for visual perception surveys):
- imageranking: Rank multiple images in order of preference
  Example:
  {
    "type": "imageranking",
    "name": "street_preference_ranking",
    "title": "Rank these street scenes from most to least appealing",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset

- imagerating: Rate a single or multiple images on a scale
  Example:
  {
    "type": "imagerating",
    "name": "thermal_comfort_rating",
    "title": "How thermally comfortable does this street look?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "rateMin": 1,
    "rateMax": 5,
    "minRateDescription": "Very uncomfortable",
    "maxRateDescription": "Very comfortable",
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset

- imageboolean: Yes/No question about an image
  Example:
  {
    "type": "imageboolean",
    "name": "walkability_assessment",
    "title": "Would you feel safe walking here at night?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset

- imagepicker: Choose one or multiple images from a set
  Example:
  {
    "type": "imagepicker",
    "name": "preferred_street_type",
    "title": "Which street scene do you prefer?",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  }
  IMPORTANT: choices array can be empty [], images will be randomly selected from Hugging Face dataset
  NOTE: For multiple selection, add "multiSelect": true

- imagematrix: Matrix/grid with images displayed above
  Example:
  {
    "type": "imagematrix",
    "name": "multi_attribute_rating",
    "title": "Rate the following aspects of these street scenes",
    "isRequired": true,
    "imageCount": 3,
    "imageSelectionMode": "huggingface_random",
    "imageLinks": [],
    "rows": [
      {"value": "safety", "text": "Safety"},
      {"value": "aesthetics", "text": "Aesthetics"},
      {"value": "walkability", "text": "Walkability"}
    ],
    "columns": [
      {"value": "1", "text": "Poor"},
      {"value": "2", "text": "Fair"},
      {"value": "3", "text": "Good"},
      {"value": "4", "text": "Excellent"}
    ]
  }
  IMPORTANT: imageLinks array is empty [], images will be randomly selected from Hugging Face dataset

IMPORTANT GUIDELINES:
1. **For demographic/socioeconomic questions**: Use text-based questions (text, comment, radiogroup, dropdown, rating, etc.) WITHOUT images
   Example: age, gender, income, education, occupation

2. **For visual perception/assessment questions**: PREFER image-based questions (imagepicker, imageranking, imagerating, imageboolean, imagematrix)
   Example: "Pick your preferred street", "Rate the thermal comfort of this street", "Rank these streets by safety"

3. **For text-based streetscape questions**: If you must use text questions to ask about street/visual aspects, 
   you MUST add an "image" type question BEFORE it to display the image:
   Example sequence:
   [
     {
       "type": "image",
       "name": "street_display_1",
       "imageLink": "https://example.com/street.jpg"
     },
     {
       "type": "text",
       "name": "street_description",
       "title": "Describe what you see in this street scene",
       "isRequired": true
     }
   ]

4. All image-based questions MUST include:
   - imageCount property (number of images to show)
   - imageSelectionMode: "huggingface_random" (ALWAYS use huggingface_random)
   - randomImageSelection: true (ALWAYS true)
   - choices: [] (empty array, images automatically loaded from dataset)
   - For imagematrix: use imageLinks: [] instead of choices

5. For imagerating, include minRateDescription and maxRateDescription

6. NEVER use "manual" mode or provide imageLink URLs - all images are randomly selected from the Hugging Face dataset

**DECISION TREE:**
- Demographic/background question? → text-based, NO image
- Visual assessment question? → image-based question type (imagepicker, imagerating, imageranking, etc.)
- Text question about streetscape? → "image" type display FIRST, then text question

Generate a professional, well-structured survey with appropriate question types. Return ONLY valid JSON, no markdown or explanations.`;

    console.log('🤖 Generating survey with OpenAI...');
    
    // Try up to 2 times if JSON parsing fails
    let surveyConfig = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: description }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: 4000
        });
        
        const responseText = completion.choices[0].message.content.trim();
        
        // Remove markdown code blocks if present
        let jsonText = responseText;
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```json?\n/, '').replace(/\n```$/, '');
        }
        
        // Try to parse JSON
        surveyConfig = JSON.parse(jsonText);
        
        // Validate that it has the expected structure
        if (!surveyConfig.pages || !Array.isArray(surveyConfig.pages)) {
          throw new Error('Invalid survey structure: missing pages array');
        }
        
        console.log('✅ Survey generated successfully');
        break; // Success, exit retry loop
        
      } catch (parseError) {
        lastError = parseError;
        console.warn(`⚠️ Attempt ${attempt} failed:`, parseError.message);
        
        if (attempt < 2) {
          console.log('🔄 Retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    if (!surveyConfig) {
      throw new Error(`Failed to generate valid JSON after 2 attempts. Last error: ${lastError.message}`);
    }
    
    res.json({ success: true, surveyConfig });
  } catch (error) {
    console.error('❌ Error generating survey:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to generate survey' 
    });
  }
});

// Adjust existing survey based on instructions
app.post('/api/openai/adjust-survey', async (req, res) => {
  try {
    const { currentConfig, instruction, apiKey } = req.body;
    
    if (!apiKey || !currentConfig || !instruction) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key, current config, and instruction are required' 
      });
    }
    
    const openai = new OpenAI({ apiKey });
    
    const systemPrompt = `You are an expert survey designer specializing in visual perception and streetscape surveys. Modify the provided survey configuration according to the user's instructions.

AVAILABLE QUESTION TYPES:
Text-based: text, comment, radiogroup, checkbox, dropdown, boolean, rating, ranking, matrix
Image-based: imagepicker, imageranking, imagerating, imageboolean, imagematrix

IMAGE-BASED QUESTION STRUCTURE:
- imagepicker: Requires imageCount, imageSelectionMode: "huggingface_random", randomImageSelection: true, choices: []
- imageranking: Requires imageCount, imageSelectionMode: "huggingface_random", randomImageSelection: true, choices: []
- imagerating: Requires imageCount, imageSelectionMode: "huggingface_random", randomImageSelection: true, choices: [], rateMin, rateMax, minRateDescription, maxRateDescription
- imageboolean: Requires imageCount, imageSelectionMode: "huggingface_random", randomImageSelection: true, choices: []
- imagematrix: Requires imageCount, imageSelectionMode: "huggingface_random", imageLinks: [], rows, columns arrays

IMPORTANT RULES:
1. **Demographic questions**: Use text-based questions WITHOUT images (age, gender, education, etc.)

2. **Visual perception questions**: Use image-based question types (imagepicker, imagerating, imageranking, imageboolean, imagematrix)

3. **Text questions about streetscape**: Must have an "image" type display question BEFORE the text question
   Example:
   {
     "type": "image",
     "name": "display_street",
     "imageLink": "https://example.com/street.jpg"
   }
   followed by:
   {
     "type": "comment",
     "name": "describe_street",
     "title": "Describe this street"
   }

4. When adding image questions, ALWAYS include:
   - imageCount: (number of images)
   - imageSelectionMode: "huggingface_random" (ALWAYS huggingface_random, never manual)
   - randomImageSelection: true (ALWAYS true)
   - choices: [] (empty array, images auto-loaded from Hugging Face dataset)

5. NEVER provide imageLink URLs or use manual mode

6. Maintain all existing properties unless specifically asked to change them

**DECISION TREE:**
- Adding demographic question? → text-based, NO image
- Adding visual assessment? → image-based question type
- Adding text question about street? → "image" display FIRST, then text question

Return the COMPLETE modified survey configuration in JSON format. Return ONLY valid JSON, no markdown or explanations.`;

    const userPrompt = `Current survey configuration:
${JSON.stringify(currentConfig, null, 2)}

User instruction: ${instruction}

Please return the complete modified survey configuration.`;

    console.log('🤖 Adjusting survey with OpenAI...');
    
    // Try up to 2 times if JSON parsing fails
    let surveyConfig = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.5,
          max_tokens: 4000
        });
        
        const responseText = completion.choices[0].message.content.trim();
        
        // Remove markdown code blocks if present
        let jsonText = responseText;
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```json?\n/, '').replace(/\n```$/, '');
        }
        
        // Try to parse JSON
        surveyConfig = JSON.parse(jsonText);
        
        // Validate that it has the expected structure
        if (!surveyConfig.pages || !Array.isArray(surveyConfig.pages)) {
          throw new Error('Invalid survey structure: missing pages array');
        }
        
        console.log('✅ Survey adjusted successfully');
        break; // Success, exit retry loop
        
      } catch (parseError) {
        lastError = parseError;
        console.warn(`⚠️ Attempt ${attempt} failed:`, parseError.message);
        
        if (attempt < 2) {
          console.log('🔄 Retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    if (!surveyConfig) {
      throw new Error(`Failed to generate valid JSON after 2 attempts. Last error: ${lastError.message}`);
    }
    
    res.json({ success: true, surveyConfig });
  } catch (error) {
    console.error('❌ Error adjusting survey:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to adjust survey' 
    });
  }
});

// Generate questions for a page
app.post('/api/openai/generate-questions', async (req, res) => {
  try {
    const { pageDescription, apiKey } = req.body;
    
    if (!apiKey || !pageDescription) {
      return res.status(400).json({ 
        success: false, 
        error: 'API key and page description are required' 
      });
    }
    
    const openai = new OpenAI({ apiKey });
    
    const systemPrompt = `You are an expert survey designer specializing in visual perception and streetscape surveys. Generate survey questions in JSON array format based on the description.

AVAILABLE QUESTION TYPES:
Text-based: text, comment, radiogroup, checkbox, dropdown, boolean, rating, ranking, matrix
Image-based: imagepicker, imageranking, imagerating, imageboolean, imagematrix

Each question must have:
- type: Question type from above
- name: Unique identifier (lowercase, underscores, no spaces)
- title: Question text
- isRequired: true/false

IMAGE-BASED QUESTION EXAMPLES:
[
  {
    "type": "imagepicker",
    "name": "street_preference",
    "title": "Which street scene do you prefer?",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  },
  {
    "type": "imagerating",
    "name": "street_comfort",
    "title": "How comfortable does this street look?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "rateMin": 1,
    "rateMax": 5,
    "minRateDescription": "Not comfortable",
    "maxRateDescription": "Very comfortable",
    "choices": []
  },
  {
    "type": "imageranking",
    "name": "preference_rank",
    "title": "Rank these streets by preference",
    "isRequired": true,
    "imageCount": 4,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  },
  {
    "type": "imageboolean",
    "name": "safe_to_walk",
    "title": "Would you feel safe walking here?",
    "isRequired": true,
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": true,
    "choices": []
  },
  {
    "type": "imagematrix",
    "name": "multi_assessment",
    "title": "Rate these aspects",
    "isRequired": true,
    "imageCount": 2,
    "imageSelectionMode": "huggingface_random",
    "imageLinks": [],
    "rows": [
      {"value": "safety", "text": "Safety"},
      {"value": "comfort", "text": "Comfort"}
    ],
    "columns": [
      {"value": "1", "text": "Low"},
      {"value": "2", "text": "Medium"},
      {"value": "3", "text": "High"}
    ]
  }
]

IMPORTANT: choices and imageLinks are ALWAYS empty arrays [], images are randomly loaded from Hugging Face dataset

IMPORTANT RULES:
1. **Demographic/background questions**: Use text-based questions WITHOUT images
   Examples: age, gender, education level, occupation

2. **Visual perception/assessment**: Use image-based question types
   Examples: imagepicker for choosing preferences, imagerating for comfort ratings, imageranking for preference ordering

3. **Text questions about streetscape/visual content**: Must include "image" display type BEFORE the text question
   Example:
   [
     {"type": "image", "name": "show_street", "imageLink": "https://example.com/street.jpg"},
     {"type": "comment", "name": "describe", "title": "Describe what you see", "isRequired": true}
   ]

4. Image-based questions MUST include:
   - imageCount: (number of images to show)
   - imageSelectionMode: "huggingface_random" (ALWAYS huggingface_random, never manual)
   - randomImageSelection: true (ALWAYS true)
   - choices: [] (ALWAYS empty array)
   - For imagematrix: imageLinks: [] (ALWAYS empty array)

5. NEVER provide imageLink URLs - images are automatically loaded from the Hugging Face dataset

**DECISION TREE:**
- Demographic question? → text-based, NO image
- Visual assessment? → image-based question type (imagepicker, imagerating, imageranking, etc.)
- Text question about street scene? → "image" display + text question

Return ONLY a JSON array of questions, no markdown or explanations.`;

    console.log('🤖 Generating questions with OpenAI...');
    
    // Try up to 2 times if JSON parsing fails
    let questions = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Generate questions for: ${pageDescription}. Return a JSON object with a "questions" array.` }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: 2000
        });
        
        const responseText = completion.choices[0].message.content.trim();
        
        // Remove markdown code blocks if present
        let jsonText = responseText;
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```json?\n/, '').replace(/\n```$/, '');
        }
        
        // Try to parse JSON
        const parsed = JSON.parse(jsonText);
        
        // Handle both array and object with questions array
        if (Array.isArray(parsed)) {
          questions = parsed;
        } else if (parsed.questions && Array.isArray(parsed.questions)) {
          questions = parsed.questions;
        } else {
          throw new Error('Invalid questions structure: expected array or object with questions array');
        }
        
        console.log('✅ Questions generated successfully');
        break; // Success, exit retry loop
        
      } catch (parseError) {
        lastError = parseError;
        console.warn(`⚠️ Attempt ${attempt} failed:`, parseError.message);
        
        if (attempt < 2) {
          console.log('🔄 Retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    if (!questions) {
      throw new Error(`Failed to generate valid JSON after 2 attempts. Last error: ${lastError.message}`);
    }
    
    res.json({ success: true, questions });
  } catch (error) {
    console.error('❌ Error generating questions:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to generate questions' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 File management server running on http://localhost:${PORT}`);
  console.log(`📁 Templates directory: ${TEMPLATES_PATH}`);
  console.log(`📁 Projects directory: ${PROJECTS_PATH}`);
  console.log(`📁 Deployments directory: ${DEPLOYMENTS_PATH}`);
  console.log(`🤖 OpenAI integration enabled`);
});
