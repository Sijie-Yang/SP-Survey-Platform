<div align="center">

# 🏙️ SP-Survey (Streetscape Perception Survey)

[![Stars](https://img.shields.io/github/stars/Sijie-Yang/Streetscape-Perception-Survey?style=social)](https://github.com/Sijie-Yang/Streetscape-Perception-Survey)
[![Paper](https://img.shields.io/badge/📄-Published_Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![Website](https://img.shields.io/badge/🌐-Live_Demo-blue)](https://streetscape-perception-survey.vercel.app/)
[![License](https://img.shields.io/badge/📄-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?logo=node.js)](https://nodejs.org/)

<img src="./public/logo-long.png" alt="SP-Survey Interface" width="50%">
<img src="./public/logo-poster.png" alt="SP-Survey Interface" width="80%">

<strong>A professional, research-grade platform for conducting visual perception surveys.</strong>
<br>
No coding required – build surveys through an intuitive admin panel with drag-and-drop, real-time preview, AI-powered generation with ChatGPT-style interface (NEW 🤖💬), and cloud integration.

🌐 <a href="https://streetscape-perception-survey.vercel.app/"><strong>Live Demo</strong></a> •
📄 <a href="https://www.sciencedirect.com/science/article/pii/S0360132325000514"><strong>Research Paper</strong></a> •
🔗 <a href="https://thermal-affordance.ual.sg"><strong>Project Website</strong></a> •
📊 <a href="https://github.com/Sijie-Yang/Thermal-Affordance"><strong>Dataset</strong></a>

<img src="./public/UAL Logo.jpg" alt="Urban Analytics Lab" height="50">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./public/DoA Logo.jpg" alt="Department of Architecture NUS" height="50">

</div>

---

## 📑 Table of Contents

- [📸 Platform Overview](#-platform-overview)
- [🚀 Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Access the Application](#access-the-application)
  - [Backend Status Monitoring](#backend-status-monitoring)
  - [Create Your First Survey (3 minutes)](#create-your-first-survey-3-minutes)
  - [🤖 Create Survey with AI (Alternative Method)](#-create-survey-with-ai-alternative-method)
- [✨ Key Features](#-key-features)
  - [⚡ Latest AI-Powered Features (NEW)](#-latest-ai-powered-features-new)
  - [🔧 Survey Capabilities](#-survey-capabilities)
    - [Visual Perception Question Types](#visual-perception-question-types)
    - [Research-Grade Features](#research-grade-features)
  - [🤖 AI-Powered Survey Generation (NEW)](#-ai-powered-survey-generation-new)
    - [💬 ChatGPT-Style Interface](#-chatgpt-style-interface-new)
    - [🧠 Contextual Engineering](#-contextual-engineering-new)
    - [🧠 Chain of Thoughts Generation](#-chain-of-thoughts-generation-new)
    - [🤖 Multi-Agent Expert Review](#-multi-agent-expert-review-new)
    - [📝 Customizable Prompts](#-customizable-prompts-new)
  - [📋 Template System](#-template-system---build-upon-published-research)
  - [💾 Data & Deployment](#-data--deployment)
- [💡 Use Cases](#-use-cases)
- [📊 Survey Data Collection](#-survey-data-collection)
- [🎓 Academic Citation](#-academic-citation)
- [🆘 Troubleshooting](#-troubleshooting)
  - [🔴 Backend Server Offline](#-backend-server-offline)
  - [🖼️ Images Not Loading](#️-images-not-loading)
  - [💾 Cannot Save Projects](#-cannot-save-projects)
  - [🎨 Theme Not Applying](#-theme-not-applying)
  - [☁️ Supabase Connection Failed](#️-supabase-connection-failed)
  - [🔄 Project Not Found in Survey View](#-project-not-found-in-survey-view)
  - [🚀 Deployment Build Fails](#-deployment-build-fails)
  - [📱 Survey Not Mobile Responsive](#-survey-not-mobile-responsive)
  - [Getting Help](#getting-help)
- [🤝 Contributing](#-contributing)
  - [How to Contribute](#how-to-contribute)
  - [Development Tips](#development-tips)
- [📄 License](#-license)
- [🌟 Acknowledgments](#-acknowledgments)

---

## 📸 Platform Overview

<p align="center">
  <img src="./public/overview.png" alt="SP-Survey Platform Overview" width="90%">
</p>

<p align="center">
  <em>Complete workflow: From image dataset management to survey deployment</em>
</p>

---

## 🚀 Quick Start

### Prerequisites

**Required:**

- **Hugging Face Account** (https://huggingface.co) for your image dataset
- **Supabase Account** (https://supabase.com) for cloud storage of survey images and survey responses
- **Vercel Account** (https://vercel.com) for deploying your survey website

**Optional (for AI features):**

- **OpenAI API Key** (https://platform.openai.com/api-keys) for AI-powered survey generation
  - Uses GPT-4o model
  - Pay-as-you-go pricing (~$0.01-0.05 per survey generation)
  - Stored in browser session only (never saved to disk)

### Installation

```bash
# Clone the repository
git clone https://github.com/Sijie-Yang/Streetscape-Perception-Survey.git
cd Streetscape-Perception-Survey

# Install dependencies
npm install

# Start both frontend and backend simultaneously
npm run dev

# Or use safe mode with auto-restart (highly recommended for development)
npm run dev:safe
```

**💡 Tip**: Use `npm run dev:safe` for development - it automatically restarts the backend server if it crashes, ensuring uninterrupted workflow.

### Access the Application

Once started, open your browser:

- **🎨 Admin Panel**: http://localhost:3000/admin

  - Create and manage surveys
  - Configure image datasets (Hugging Face) and survey backends (Supabase)
  - Preview surveys in real-time
  - **🟢 Real-time Backend Status Monitor** - displays server status in header with auto-restart capability
- **📋 Live Survey View**: http://localhost:3000/survey

### Backend Status Monitoring

The admin panel includes a **real-time backend status monitor** in the header:

- **🟢 Backend Online** - Server is running normally
- **🔴 Backend Offline** - Server is down (with pulsing animation and restart button)
- Auto-checks server health every 5 seconds
- One-click restart with automatic status recovery
- Detailed status information available by clicking the status chip

### Create Your First Survey (3 minutes)

1. **Load a Template** or **Create New Project**

   - Click "Load Template" → Select "Thermal Comfort in Sight" (Yang et al. 2025)
   - Or click "New Project" for a blank survey
2. **Step 1 - Image Dataset**

   - Upload your images to Hugging Face as a Dataset, then fill in the dataset name in Admin Panel (e.g., `sijiey/Thermal-Affordance-Dataset`)
   - Configure your Supabase account credentials in the connection settings
   - After both steps are confirmed successful, click "Preload Images" to automatically transfer images from Hugging Face to Supabase storage and save stable URLs for your survey project
   - Click "Next: Survey Builder →"
3. **Step 2 - Survey Builder**

   - Fill in survey basic information
   - Set up survey display settings
   - Add pages and questions with drag-and-drop
   - Configure question types (image choice, image rating, text, etc.)
   - Click "Next: Server Setup →"
4. **Step 3 - Server Setup**

   - Test Supabase database connection
   - Create response table in supabase
   - Click "Complete Setup" → auto-navigates to Step 4
5. **Step 4 - Website Setup**

   - Generate deployment files and automatically test locally
   - Auto-upload to GitHub repository
   - Manually deploy to Vercel (requires manual action)
6. **Save & Preview**

   - Click 💾 "Save" in the top bar (turns yellow when unsaved)
   - Click 👁️ "Preview" to test your survey

### 🤖 Create Survey with AI (Alternative Method)

**Skip manual setup - let AI build your survey in seconds:**

1. **Setup Your Project**

   - Create new project and complete Step 1 (Image Dataset configuration)
   - Navigate to Step 2 (Survey Builder)
2. **Open AI Chat Assistant**

   - Click the AI chat icon at the top of Survey Builder
   - Enter your OpenAI API key in Settings → Click "Validate"
   - Enable "Contextual Engineering" for smarter interactions (recommended)
3. **Chat with AI (Natural Conversation)**

   - Just type what you want - AI automatically understands:
     ```
     Example: "Create a thermal comfort survey with demographics, 
     visual ratings, and preference ranking"

     AI: [Thinking...] → [Generating survey...] → "Generated 3-page survey"

     You: "Add more variety - include imagepicker and imageboolean"

     AI: [Adjusting survey...] → "Added diverse question types"
     ```
   - Watch the status change in real-time: "Thinking..." → "Generating..." → "Adjusting..."
   - AI remembers your conversation context (per-project memory)
4. **Smart Features**

   - ✅ **Intent Detection**: No need to say "Generate" or "Adjust" - AI figures it out
   - ✅ **Conversation History**: Full context from previous messages
   - ✅ **Question Type Diversity**: AI automatically mixes different types
   - ✅ **Project-Specific Memory**: Each project has independent conversation history
   - ✅ **Image Dataset Integration**: Automatically uses your configured dataset

**💡 When to Use AI vs Manual:**

- **AI**: Quick prototyping, exploring designs, getting started, iterative refinement
- **Manual**: Precise control, complex logic, specific customizations
- **Hybrid**: Generate with AI, then fine-tune manually (recommended)

---

## ✨ Key Features

### **⚡ Latest AI-Powered Features (NEW)**

- 🧠 **Chain of Thoughts Generation**: 3-step transparent AI reasoning (analyze → plan → execute)
- 🤖 **Multi-Agent Expert Review**: 5 specialized AI agents collaborate to review surveys
- 🎨 **Customizable Agents**: Add, edit, or remove review agents to fit your research domain
- 💬 **ChatGPT-Style Interface**: Natural conversation with intelligent intent detection
- 📝 **Contextual Engineering**: 3-layer memory system that learns your preferences
- ⚙️ **Customizable Prompts**: Full control over AI behavior (2000+ lines editable)
- 🔄 **Configurable Review Rounds**: Set 1-10 review iterations based on your needs

### 🔧 **Survey Capabilities**

#### **Visual Perception Question Types**

The platform offers 16 specialized question types designed specifically for streetscape perception research:

**🖼️ Image-Based Questions** (Critical for Visual Assessment):

- **Image Choice** (imagepicker) - Essential for comparing different streetscape designs or features
- **Image Ranking** (imageranking) - Crucial for understanding preference hierarchies in urban environments
- **Image Rating** (imagerating) - Quantifies perceived comfort, safety, or aesthetic appeal (1-5 scale)
- **Image Yes/No** (imageboolean) - Quick binary assessments for specific streetscape elements
- **Image Matrix** (imagematrix) - Comprehensive evaluation across multiple criteria simultaneously
- **Image Display** (image) - Present reference images or context for streetscape scenarios

**📝 Contextual Data Collection**:

- **Text Input** (text) - Capture demographic data, location familiarity, or specific observations
- **Text Multi-line** (comment) - Detailed qualitative feedback about streetscape experiences
- **Text Single Choice** (radiogroup) - Standardized responses for background variables
- **Text Multiple Choice** (checkbox) - Multiple factor selection (e.g., preferred amenities)
- **Text Ranking** (ranking) - Prioritize streetscape improvement factors
- **Text Rating** (rating) - Quantify non-visual aspects (noise levels, perceived temperature)
- **Text Yes/No** (boolean) - Quick confirmations or screening questions
- **Dropdown** (dropdown) - Efficient selection for categorical data
- **Matrix** (matrix) - Systematic evaluation across multiple streetscape dimensions
- **Text Instruction** (expression) - Provide context, definitions, or survey guidance

#### **Research-Grade Features**

- **📄 Multi-Page Surveys**: Structure complex perception studies with logical flow and progress tracking
- **📱 Fully Responsive**: Ensure consistent data quality across devices - critical for field studies and diverse participant access
- **🔄 Drag & Drop**: Rapidly prototype and iterate survey designs based on pilot testing feedback
- **🟢 Real-time Backend Monitoring**: Live server status display with auto-restart capability - ensures uninterrupted survey development and data collection

*These capabilities enable comprehensive streetscape perception research, from visual comfort assessments to walkability studies, supporting both quantitative analysis and qualitative insights essential for evidence-based urban design.*

### 🤖 **AI-Powered Survey Generation (NEW)**

**Leverage GPT-4o to create and refine surveys in natural language:**

#### **✨ Intelligent Survey Design**

- **Natural Language Input**: Describe your survey goals in plain English or Chinese
- **Context-Aware Generation**: AI understands the difference between demographic questions, visual perception assessments, and open-ended feedback
- **Professional Structure**: Automatically organizes questions into logical pages with appropriate types

#### **🎯 Smart Question Type Selection**

The AI follows research best practices:

| Survey Purpose                 | AI Chooses            | Example                                                                               |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------- |
| **Demographic Data**     | Text-based questions  | Age, gender, education - NO images needed                                             |
| **Visual Assessment**    | Image-based questions | `imagepicker`, `imagerating`, `imageranking`, `imageboolean`, `imagematrix` |
| **Streetscape Feedback** | Image display + text  | Shows street image → then asks open-ended question                                   |

#### **🔄 Iterative Refinement**

- **Generate**: "Create a 3-page thermal comfort survey with demographics, visual ratings, and preference ranking"
- **Adjust**: "Add an imagepicker question for street type preference. Change all rating scales to 1-7."
- **Preview**: Real-time preview with actual images from your dataset
- **Iterate**: Keep refining until perfect

#### **⚙️ Automatic Configuration**

- **Image Questions**: Automatically configured with:
  - `imageSelectionMode: "huggingface_random"` - Random selection from your Hugging Face dataset
  - `randomImageSelection: true` - Fresh images for each participant
  - `choices: []` - Empty array (images loaded dynamically at runtime)
- **No Manual Setup**: Images automatically pulled from your global project dataset
- **Consistent Format**: AI-generated surveys follow the same structure as manually created ones

#### **💡 Example Prompts**

```
Generate: "Create a streetscape perception survey with 3 pages: 
1) Demographics (age, gender, city), 
2) Visual Assessment (4 imagerating questions about thermal comfort, 
   safety, aesthetics, walkability - each showing 1 random street scene), 
3) Preference (1 imagepicker to choose favorite street from 4 options, 
   then 1 imageranking to rank 4 street scenes by overall preference)."

Adjust: "Add an imagepicker question to choose favorite street type. 
Add an imageboolean question asking 'Would you bike here?' after the 
safety rating. Change all imagerating scales to 1-7."
```

#### **💬 ChatGPT-Style Interface (NEW)**

**Natural conversation with AI Assistant:**

- **Single Chat Input**: No need to choose "Generate" or "Adjust" - AI automatically understands your intent
- **Conversation History**: Full context awareness across multiple interactions
- **Smart Status Display**: See exactly what AI is doing - "Thinking...", "Generating survey...", "Adjusting survey..."
- **Integrated Settings**: All configuration in one convenient dialog
- **Project-Specific Memory**: Each project maintains its own conversation history

**Example Interaction:**

```
You: "Create a thermal comfort survey"
AI: [Thinking...] → [Generating survey...] → "Generated 3-page survey"

You: "Add more visual assessment questions"
AI: [Adjusting survey...] → "Added imagepicker and imageboolean questions"

You: "Make all rating scales 1-7"
AI: [Adjusting survey...] → "Updated all rating scales to 1-7"
```

#### **🧠 Contextual Engineering (NEW)**

**AI that remembers and learns from your workflow:**

The platform implements a three-layer memory system for smarter AI interactions:

1. **Conversation History** (Per-Project)

   - Maintains full context of your survey design conversation
   - Each project has independent memory
   - Enables natural multi-turn refinement
2. **Working Memory** (Per-Project)

   - Tracks survey goals and design decisions
   - Records iteration history
   - Helps AI maintain consistency across changes
3. **Session Learning** (Cross-Project)

   - Learns your preferences over time
   - Tracks expertise level
   - Provides personalized recommendations
   - Adapts to your survey design patterns

**Benefits:**

- More accurate AI responses based on previous interactions
- No need to repeat context in every message
- Intelligent suggestions based on your project history
- Seamless workflow continuity

#### **🧠 Chain of Thoughts Generation (NEW)**

**Transparent AI thinking process:**

Every Generate, Adjust, and Revise operation follows a three-step thinking process:

```
🧠 Step 1: Research Analysis
   AI analyzes: What is the research topic? What are the questions? Who is the audience?

📐 Step 2: Structure Planning
   AI plans: How many pages? What questions on each page? How many questions?

🔨 Step 3: Generation/Execution
   AI generates: Complete survey configuration based on analysis and planning
```

**Benefits:**

- See exactly how AI thinks and plans
- Better quality through structured thinking
- Learn survey design best practices
- Easy to debug if something goes wrong

#### **🤖 Multi-Agent Expert Review (NEW)**

**5 AI experts collaborate to review your survey:**

After generating or adjusting a survey, 5 specialized AI agents automatically review it:

- **🔬 Urban Scientist**: Research methodology and scientific rigor
- **🏙️ Urban Designer**: Streetscape design coverage
- **🧠 Perception Psychologist**: Question wording and cognitive load
- **👤 Test Participant**: User experience and survey usability
- **📊 Data Analyst**: Data quality and analysis readiness

**Customizable Agents (NEW 🎨)**: Fully customize review agents in AI Assistant Settings → Agents tab. Add domain-specific experts, edit agent expertise and focus areas, or remove agents you don't need. All changes auto-save and apply to future reviews.

**Review Process:**

1. Each agent reviews independently and provides ratings (1-10)
2. Agents identify strengths, concerns, and suggestions
3. If not approved (≥70%), survey-designer revises based on feedback
4. Process repeats until approved or max rounds reached (configurable 1-10)

**Configuration:**

- Enable/disable in AI Assistant Settings
- Choose mode: "1v1 Reviews" or "Group Discussion"
- Set maximum review rounds (1-10, default: 3)
- Customize agents with Add/Edit/Delete/Reset options
- All agent feedback appears in conversation history

**Benefits:**

- Automatic quality assurance from multiple expert perspectives
- Iterative improvement without manual intervention
- Transparent feedback visible in conversation
- Smart termination when approved or no improvement

#### **📝 Customizable Prompts (NEW)**

**Full control over AI behavior:**

All system prompts (2000+ lines of instructions) are now viewable and editable:

- **Access**: AI Assistant Settings → Prompts tab
- **Edit**: Modify prompts directly in the UI
- **Save**: Persists to browser localStorage
- **Reset**: Restore defaults anytime
- **Export/Import**: Share prompt configurations

**Available Prompts:**

- Intent Detection (classify user requests)
- Generate (create new surveys)
- Adjust (modify existing surveys)
- Question (answer user queries)
- Revision (multi-agent feedback)

**Use Cases:**

- Researchers can customize AI for specific domains
- Test different prompt strategies
- Add domain-specific knowledge
- Experiment with AI behavior

#### **🎨 Intelligent Question Type Diversity (NEW)**

**AI automatically creates varied, engaging surveys:**

Instead of repetitive question types, the AI now:

- **Mixes image-based questions**: `imagepicker`, `imageranking`, `imagerating`, `imageboolean`, `imagematrix`
- **Varies text questions**: `radiogroup`, `dropdown`, `text`, `comment`, `checkbox`, `ranking`, `rating`
- **Creates balanced surveys**: Avoids overusing any single question type
- **Follows research best practices**: Appropriate type for each research goal

**Example Variety:**

**Before (repetitive):**
- imagerating: comfort
- imagerating: safety  
- imagerating: aesthetics
- imagerating: walkability

**After (diverse):**
- imagerating: comfort (1-5 scale)
- imagepicker: preferred street type (choice)
- imageranking: rank by preference (ordering)
- imageboolean: would you walk here? (yes/no)

#### **🔒 Data Privacy**

- Your OpenAI API key is stored in browser session only (never saved to disk)
- Survey configurations are processed locally - no data sent to external servers
- Full control over your research data

*Perfect for rapid prototyping, exploring different survey designs, or getting started when you're new to survey design.*

### 📋 **Template System - Build Upon Published Research**

**Accelerate your research by directly reusing validated survey designs:**

#### **🏛️ Available Academic Templates**

Start with peer-reviewed survey designs from published research:

<small>

| Template                                                  | Description                                                                                               | Authors                | Publication                                                                                      | Dataset                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **Thermal Comfort in Sight** `2025-thermal`       | Thermal comfort assessment using SVI. 50+ validated questions.                                            | Yang et al. (2025)     | [Building and Environment](https://www.sciencedirect.com/science/article/abs/pii/S0360132325000514) | ✅`sijiey/Thermal-Affordance-Dataset`    |
| **SPECS** `2025-specs`                            | Street perception evaluation considering demographics and personality (1,000+ participants, 5 countries). | Quintana et al. (2025) | [Nature Cities]([https://arxiv.org/abs/2505.12758](https://www.nature.com/articles/s44284-025-00330-x))                                                           | 📖[HuggingFace]([https://github.com/matqr/specs/wiki](https://huggingface.co/datasets/matiasqr/specs)) |
| **Building Exterior Perception** `2024-building`  | Evaluate human perception of building exteriors using ML techniques (250,000+ building images).           | Liang et al. (2024)    | [Building and Environment](https://doi.org/10.1016/j.buildenv.2024.111875)                          | 📖 -                                       |
| **Street Multi-Activity Potential** `2025-street` | Graph-based community detection to evaluate street multi-activity potential (SMAP).                       | Li et al. (2025)       | [CEUS](https://www.sciencedirect.com/science/article/pii/S0198971525001036)                         | 📖 -                                       |
| **Effective Perception Survey** `2025-effective`  | Comprehensive framework for image-based survey design in outdoor urban environments.                      | Gu et al. (2025)       | [Landscape and Urban Planning](https://doi.org/10.1016/j.landurbplan.2025.105368)                   | 📖 -                                       |

**How to Use Templates:**

1. Open Admin Panel → Project Sidebar
2. Click **"Load Template"** button
3. Select a template from the list
4. Customize for your research needs
5. Deploy to your survey platform

#### **💾 Create Your Own Templates**

Transform any project into a reusable template:

- **Preserves survey structure**: Question types, validation rules, logic flows
- **Metadata support**: Author, Year, Category, Tags, Website, Dataset references
- **Clean exports**: Automatically removes sensitive credentials (API keys, tokens)
- **Version control**: Track template revisions and updates

#### **🔄 Import & Share**

Collaborate across research teams:

- **Export projects** as JSON templates
- **Import templates** from colleagues or publications
- **Rapid deployment** of standardized protocols across multiple studies
- **Cross-cultural replication**: Adapt validated instruments to new contexts

#### **🚀 Rapid Prototyping**

Build new studies 10x faster:

- Clone existing templates and customize for new contexts
- Maintain methodological consistency across longitudinal studies
- Iterate on proven designs without starting from scratch

*Perfect for replication studies, cross-cultural comparisons, or adapting validated instruments to new research questions.*

### 💾 **Data & Deployment**

- **🤗 Hugging Face**: Host your image datasets
- **☁️ Supabase**: Store images and survey responses
- **🚀 Vercel**: Deploy your survey website with one click

---

## 💡 Use Cases

- **Urban Planning**: Streetscape perception surveys
- **Market Research**: Product preference studies
- **Psychology**: Visual perception experiments
- **Education**: Student assessment with images
- **Healthcare**: Patient feedback with visual aids
- **Architecture**: Design preference surveys

---

## 📊 Survey Data Collection

### **View Responses:**

1. Supabase Dashboard → Table Editor
2. Export as CSV or JSON
3. Real-time monitoring

---

## 🎓 Academic Citation

This platform was developed for the Thermal Affordance research:

```bibtex
@article{yang2025thermal,
  title={Thermal comfort in sight: Thermal affordance and its visual assessment for sustainable streetscape design},
  author={Yang, Sijie and Chong, Adrian and Liu, Pengyuan and Biljecki, Filip},
  journal={Building and Environment},
  pages={112569},
  year={2025},
  publisher={Elsevier}
}
```

**📄 [Read the Paper](https://www.sciencedirect.com/science/article/pii/S0360132325000514)** | **🔗 [Project Website](https://thermal-affordance.ual.sg)** | **📊 [Dataset](https://github.com/Sijie-Yang/Thermal-Affordance)**

---

## 🆘 Troubleshooting

### Common Issues & Solutions

#### 🔴 **Backend Server Offline**

**Problem**: Red "Backend Offline" status in admin panel header

**Solutions**:

```bash
# Method 1: Use safe mode with auto-restart (recommended)
npm run dev:safe
# Backend will automatically restart if it crashes (2-3 seconds recovery)

# Method 2: Manual restart
npm run dev

# Method 3: Backend only
node server.js

# Or use the auto-restart script directly
./server-auto-restart.sh
```

**Features**:

- ✅ Real-time status monitoring (checks every 5 seconds)
- ✅ Visual alerts with pulsing animation when offline
- ✅ One-click restart button in admin panel
- ✅ Automatic clipboard copy of startup command
- ✅ `npm run dev:safe` provides automatic crash recovery

**Tip**: The admin panel header displays live backend status. Click the status chip for detailed information.

#### 🖼️ **Images Not Loading**

**Problem**: Images don't display in survey or preview

**Solutions**:

```javascript
1. Check Supabase bucket is public
   - Go to Supabase Storage → street-images → Settings
   - Enable "Public bucket"

2. Verify image URLs
   - Open URL in browser: https://xxx.supabase.co/storage/v1/object/public/street-images/image.jpg
   - Should show image, not 404/403 error

3. Check Hugging Face URLs expiration
   - HF URLs expire after ~1 hour
   - Solution: Preload to Supabase for stable URLs

4. Browser console errors
   - Press F12 → Console tab
   - Look for CORS or network errors
```

#### 💾 **Cannot Save Projects**

**Problem**: "Save" button doesn't work, or projects disappear after refresh

**Solutions**:

```bash
1. Ensure backend server is running
   ✅ Should see: "🚀 File management server running on http://localhost:3001"
   ❌ If not: Run `node server.js` in terminal

2. Check server connection
   - Open http://localhost:3001/api/projects in browser
   - Should return JSON list of files

3. Verify folder permissions
   ls -la public/projects/
   # Should be writable by current user

4. Check browser console
   - Look for "Failed to fetch" or 404 errors
   - May indicate port conflict (change 3001 to another port)
```

#### 🎨 **Theme Not Applying**

**Problem**: Theme selection doesn't change colors

**Solutions**:

```javascript
1. Hard refresh browser
   - Windows/Linux: Ctrl + Shift + R
   - Mac: Cmd + Shift + R

2. Clear localStorage
   - Console: localStorage.removeItem('sp-survey-theme')
   - Or use "Clean Cache" button in admin panel

3. Check browser console for theme errors
```

#### ☁️ **Supabase Connection Failed**

**Problem**: "Connection failed" when testing Supabase

**Solutions**:

```javascript
1. Verify credentials
   - URL format: https://xxxxx.supabase.co (not ...supabase.com)
   - Key: Should be "anon/public" key, not "service_role" key

2. Check Supabase project status
   - Go to https://supabase.com/dashboard
   - Ensure project is "Active" (not paused)

3. Verify Row Level Security (RLS)
   - Tables need proper policies for public access
   - Storage buckets must be public

4. Test with cURL
   curl -H "apikey: YOUR_ANON_KEY" \
        https://xxxxx.supabase.co/rest/v1/
```

#### 🔄 **Project Not Found in Survey View**

**Problem**: `/survey?project=xxx` shows "Project not found"

**Solutions**:

```javascript
1. Check project ID is correct
   - Admin panel → Project list → Copy exact ID
   - Format: proj_1234567890_abcdef

2. Ensure project file exists
   - Check public/projects/proj_xxx.json exists
   - File should contain valid JSON

3. Backend server must be running
   - Survey loads config via API endpoint
```

#### 🚀 **Deployment Build Fails**

**Problem**: `npm run build` fails with errors

**Solutions**:

```bash
1. Clear npm cache and node_modules
   rm -rf node_modules package-lock.json
   npm install

2. Check Node.js version
   node -v  # Should be 16+
   nvm use 18  # Switch if needed

3. Fix linter errors first
   npm run build 2>&1 | grep "Error"
   # Fix any ESLint or compilation errors

4. Increase memory limit (if out of memory)
   NODE_OPTIONS=--max_old_space_size=4096 npm run build
```

#### 📱 **Survey Not Mobile Responsive**

**Problem**: Survey looks broken on mobile devices

**Solutions**:

```javascript
1. Check viewport meta tag (should be in public/index.html)
   <meta name="viewport" content="width=device-width, initial-scale=1" />

2. Test in browser dev tools
   - F12 → Toggle device toolbar (Ctrl+Shift+M)
   - Test on various screen sizes

3. Adjust SurveyJS theme
   - Check theme.js for responsive settings
```

### Getting Help

- **GitHub Issues**: [Report a bug](https://github.com/Sijie-Yang/Streetscape-Perception-Survey/issues)
- **Discussions**: [Ask questions](https://github.com/Sijie-Yang/Streetscape-Perception-Survey/discussions)
- **Documentation**: Check inline code comments
- **Logs**: Always check browser console (F12) and terminal output

---

## 🤝 Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, documentation improvements, or translations, your help is appreciated.

### How to Contribute

#### 1. **Report Bugs**

- Check [existing issues](https://github.com/Sijie-Yang/Streetscape-Perception-Survey/issues) first
- Create a new issue with:
  - Clear title and description
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots if applicable
  - Browser/OS version

#### 2. **Suggest Features**

- Open a [discussion](https://github.com/Sijie-Yang/Streetscape-Perception-Survey/discussions) or issue
- Explain the use case and benefits
- Provide examples or mockups if possible

#### 3. **Submit Code**

```bash
# Fork the repository on GitHub
git clone https://github.com/YOUR_USERNAME/Streetscape-Perception-Survey.git
cd Streetscape-Perception-Survey

# Create a feature branch
git checkout -b feature/amazing-feature

# Make your changes and test
npm install
npm run dev

# Commit with clear messages
git add .
git commit -m "Add: Amazing new feature

- Detailed description of what changed
- Why this change was needed
- Any breaking changes"

# Push to your fork
git push origin feature/amazing-feature

# Open a Pull Request on GitHub
```

#### 4. **Code Style Guidelines**

- **JavaScript**: Follow existing code style (ESLint configuration)
- **Components**: Use functional components with hooks
- **Comments**: Add comments for complex logic
- **Naming**: Use descriptive variable/function names
- **Files**: One component per file, named after the component

#### 5. **Pull Request Checklist**

- [ ] Code follows existing style
- [ ] Comments added for complex logic
- [ ] No console.log() or debugger statements
- [ ] Tested in Chrome, Firefox, and Safari
- [ ] Tested on mobile viewport
- [ ] No breaking changes (or clearly documented)
- [ ] Updated README if needed

### Development Tips

```bash
# Run linter
npm run lint

# Format code (if you have Prettier)
npm run format

# Check for unused dependencies
npx depcheck

# Analyze bundle size
npm run build
npx source-map-explorer 'build/static/js/*.js'
```

### Areas We'd Love Help With

- 🌐 **Internationalization**: Add translations for multiple languages
- 📱 **Mobile UX**: Improve mobile survey experience
- 🎨 **Themes**: Design new color themes
- 📊 **Question Types**: Create new custom question widgets
- 📚 **Documentation**: Tutorial videos, blog posts
- 🧪 **Testing**: Unit tests, integration tests
- ♿ **Accessibility**: WCAG compliance improvements
- 🚀 **Performance**: Loading speed optimizations

---

## 📄 License

**CC BY 4.0 (Creative Commons Attribution 4.0 International)**

This work is licensed under a [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

**You are free to:**

- ✅ Share — copy and redistribute the material
- ✅ Adapt — remix, transform, and build upon the material
- ✅ Commercial use allowed

**Under the following terms:**

- 📝 **Attribution** — You must give appropriate credit and cite the original paper

**How to cite:**

```bibtex
@article{yang2025thermal,
  title={Thermal comfort in sight: Thermal affordance and its visual assessment for sustainable streetscape design},
  author={Yang, Sijie and Chong, Adrian and Liu, Pengyuan and Biljecki, Filip},
  journal={Building and Environment},
  pages={112569},
  year={2025},
  publisher={Elsevier}
}
```

---

## 🌟 Acknowledgments

**Developed by Urban Analytics Lab, Department of Architecture, National University of Singapore**

### Technology Stack

- **SurveyJS**: Survey rendering engine
- **Material-UI (MUI)**: UI components with custom theming
- **React 18.2**: Frontend framework with hooks
- **Node.js/Express**: Backend server with REST APIs
- **OpenAI GPT-4o**: AI-powered survey generation with:
  - Chain of Thoughts reasoning
  - Multi-Agent Review System (5 specialized experts)
  - Contextual Engineering (3-layer memory)
  - Customizable prompt management
- **Supabase**: Cloud database & storage (PostgreSQL + S3-compatible)
- **Hugging Face**: Dataset hosting and CDN
- **Vercel**: Serverless deployment platform
- **localStorage/sessionStorage**: Client-side persistence
