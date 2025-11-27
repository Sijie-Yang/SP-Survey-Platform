<div align="center">

# 🏙️ SP-Survey (Streetscape Perception Survey)

[![Stars](https://img.shields.io/github/stars/Sijie-Yang/Streetscape-Perception-Survey?style=social)](https://github.com/Sijie-Yang/Streetscape-Perception-Survey)
[![Paper](https://img.shields.io/badge/📄-Published_Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![Website](https://img.shields.io/badge/🌐-Live_Demo-blue)](https://streetscape-perception-survey.vercel.app/)
[![License](https://img.shields.io/badge/📄-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?logo=node.js)](https://nodejs.org/)


<img src="./public/fig_introduction.png" alt="SP-Survey Interface" width="100%">

<strong>A professional, research-grade platform for conducting visual perception surveys.</strong>
<br>
No coding required – build surveys through an intuitive admin panel with drag-and-drop, real-time preview, AI-powered generation, and cloud integration.

🌐 <a href="https://streetscape-perception-survey.vercel.app/"><strong>Live Demo</strong></a> •
📄 <a href="https://www.sciencedirect.com/science/article/pii/S0360132325000514"><strong>Research Paper</strong></a> •
🔗 <a href="https://thermal-affordance.ual.sg"><strong>Project Website</strong></a> •
📊 <a href="https://github.com/Sijie-Yang/Thermal-Affordance"><strong>Dataset</strong></a>

<img src="./public/UAL Logo.jpg" alt="Urban Analytics Lab" height="50">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./public/DoA Logo.jpg" alt="Department of Architecture NUS" height="50">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./public/logo-long.png" alt="SP-Survey Interface" width="25%">

</div>

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
- **Supabase Account** (https://supabase.com) for cloud storage
- **Vercel Account** (https://vercel.com) for deployment

**Optional:**
- **OpenAI API Key** (https://platform.openai.com/api-keys) for AI-powered survey generation

### Installation

```bash
# Clone the repository
git clone https://github.com/Sijie-Yang/Streetscape-Perception-Survey.git
cd Streetscape-Perception-Survey

# Install dependencies
npm install

# Start both frontend and backend
npm run dev
```

### Access the Application

- **🎨 Admin Panel**: http://localhost:3000/admin
- **📋 Live Survey**: http://localhost:3000/survey

### Create Your First Survey

1. **Load Template** or **Create New Project**
   - Click "Load Template" → Select a template
   - Or click "New Project" for a blank survey

2. **Configure Image Dataset**
   - Upload images to Hugging Face Dataset
   - Configure Supabase credentials
   - Click "Preload Images" to transfer images

3. **Build Survey**
   - Add pages and questions with drag-and-drop
   - Configure question types (image rating, choice, ranking, etc.)
   - Use **AI Assistant** (🤖) for automatic generation

4. **Deploy**
   - Test Supabase connection
   - Generate deployment files
   - Deploy to Vercel

---

## ✨ Key Features

### 🤖 AI-Powered Survey Generation

- **ChatGPT-Style Interface**: Natural conversation to create and refine surveys
- **Chain of Thoughts**: Transparent 3-step AI reasoning process
- **Multi-Agent Review**: 5 specialized AI experts review your survey
- **Contextual Memory**: AI remembers your preferences and project history

### 🔧 Survey Capabilities

**Image-Based Questions:**
- Image Choice (imagepicker) - Compare streetscape designs
- Image Ranking (imageranking) - Preference hierarchies
- Image Rating (imagerating) - Quantify comfort, safety, aesthetics (1-5 scale)
- Image Yes/No (imageboolean) - Binary assessments
- Image Matrix (imagematrix) - Multi-criteria evaluation
- Image Display (image) - Reference images

**Text Questions:**
- Text input, multi-line comments, single/multiple choice
- Rating scales, ranking, dropdowns, matrices

**Research Features:**
- Multi-page surveys with progress tracking
- Fully responsive design
- Drag-and-drop builder
- Real-time preview

### 📋 Template System

Start with peer-reviewed survey designs from published research:

| Template | Description | Authors | Publication | Dataset |
|----------|-------------|---------|-------------|---------|
| **Thermal Comfort in Sight** `2025-thermal` | Thermal comfort assessment using SVI. 50+ validated questions. | Yang et al. (2025) | [Building and Environment](https://www.sciencedirect.com/science/article/abs/pii/S0360132325000514) | ✅`sijiey/Thermal-Affordance-Dataset` |
| **SPECS** `2025-specs` | Street perception evaluation considering demographics and personality (1,000+ participants, 5 countries). | Quintana et al. (2025) | [Nature Cities](https://www.nature.com/articles/s44284-025-00330-x) | ✅`matiasqr/specs` |
| **Building Exterior Perception** `2024-building` | Evaluate human perception of building exteriors using ML techniques (250,000+ building images). | Liang et al. (2024) | [Building and Environment](https://doi.org/10.1016/j.buildenv.2024.111875) | 📖 - |
| **Street Multi-Activity Potential** `2025-street` | Graph-based community detection to evaluate street multi-activity potential (SMAP). | Li et al. (2025) | [CEUS](https://www.sciencedirect.com/science/article/pii/S0198971525001036) | ✅`lajitong424/SMAP_svi` |
| **Effective Perception Survey** `2025-effective` | Comprehensive framework for image-based survey design in outdoor urban environments. | Gu et al. (2025) | [Landscape and Urban Planning](https://doi.org/10.1016/j.landurbplan.2025.105368) | ✅`Reubengyl/EffectivePerceptionSurvey` |
| **City Landmark** `2025-city` | Perception of urban landmarks through street view images, focusing on visibility, accessibility, and recognition. | AI Generated | AI Template | ✅`Zicheng00/Landmark_visibility` |
| **Street Bikeability** `2025-street-1` | Urban streetscape bikeability survey examining design interventions and socio-economic impacts on cycling environments. | AI Generated | AI Template | ✅`koito19960406/sp_survey_bikeability` |
| **Urban Greenery** `2025-urban` | Psychological, aesthetic, and functional impacts of urban greenery in streetscapes. | AI Generated | AI Template | 📖 - |

**How to Use:**
1. Open Admin Panel → Project Sidebar
2. Click **"Load Template"** button
3. Select a template and customize

### 💾 Data & Deployment

- **🤗 Hugging Face**: Host your image datasets
- **☁️ Supabase**: Store images and survey responses
- **🚀 Vercel**: Deploy your survey website with one click

---

## 📊 Survey Data Collection

**View Responses:**
1. Supabase Dashboard → Table Editor
2. Export as CSV or JSON
3. Real-time monitoring

---

## 🎓 Academic Citation

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

### Backend Server Offline
```bash
# Use safe mode with auto-restart (recommended)
npm run dev:safe

# Or manual restart
npm run dev
```

### Images Not Loading
1. Check Supabase bucket is public (Storage → Settings → Public bucket)
2. Verify image URLs are accessible
3. Preload images from Hugging Face to Supabase for stable URLs

### Cannot Save Projects
1. Ensure backend server is running (`node server.js`)
2. Check http://localhost:3001/api/projects returns JSON
3. Verify folder permissions

### Supabase Connection Failed
1. Verify credentials (URL format: `https://xxxxx.supabase.co`)
2. Use "anon/public" key, not "service_role" key
3. Ensure project is active in Supabase dashboard

**Getting Help:**
- **GitHub Issues**: [Report a bug](https://github.com/Sijie-Yang/SP-Survey/issues)
- **Discussions**: [Ask questions](https://github.com/Sijie-Yang/SP-Survey/discussions)

---

## 🤝 Contributing

We welcome contributions! Please open an issue or pull request to discuss your ideas.

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



---

## 🌟 Acknowledgments

**Developed by Urban Analytics Lab, Department of Architecture, National University of Singapore**

**Technology Stack:**
- SurveyJS, Material-UI, React 18.2, Node.js/Express
- OpenAI GPT-4o (AI features)
- Supabase (Database & Storage)
- Hugging Face (Dataset hosting)
- Vercel (Deployment)
