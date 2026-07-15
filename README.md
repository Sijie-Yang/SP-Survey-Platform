<div align="center">

# SP-Survey Platform

[![Website](https://img.shields.io/badge/🌐-sp--survey.org-blue)](https://sp-survey.org)
[![GitHub](https://img.shields.io/badge/⭐-SP--Survey-black?logo=github)](https://github.com/Sijie-Yang/SP-Survey)
[![Paper](https://img.shields.io/badge/📄-Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![License](https://img.shields.io/badge/License-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)

<img src="./public/fig_introduction.png" alt="SP-Survey" width="100%">

**A research-grade platform for visual perception surveys.**  
Design image-based questionnaires in a drag-and-drop admin panel, share a link with participants, and analyze responses with media–answer pairing — no coding required.

🌐 **[sp-survey.org](https://sp-survey.org)** ·
⭐ **[Open source (self-host)](https://github.com/Sijie-Yang/SP-Survey)** ·
📄 **[Paper](https://www.sciencedirect.com/science/article/pii/S0360132325000514)**

<img src="./public/UAL%20Logo.jpg" alt="UAL" height="40">
&nbsp;&nbsp;
<img src="./public/DoA%20Logo.jpg" alt="DoA NUS" height="40">

</div>

---

## Highlights

- **No-code survey builder** — image choice, rating, ranking, matrix, annotation, media panels, and custom skill iframes
- **AI-assisted design** — generate and refine surveys from natural language (optional OpenAI key)
- **Research templates** — start from peer-reviewed designs (Place Pulse, SPECS, thermal affordance, and more)
- **Cloud media** — upload images (browser-side compression) or import Hugging Face datasets
- **Share & analyze** — live survey links, TrueSkill / reliability metrics, CSV export with `__shown_images`
- **Paper library** — browse urban-perception literature and match published methods to templates

---

## Use

### Hosted (recommended)

Go to **[sp-survey.org](https://sp-survey.org)**, create an account, and start building. No server or deployment setup.

### Self-host

Open-source code and setup live in **[Sijie-Yang/SP-Survey](https://github.com/Sijie-Yang/SP-Survey)**:

```bash
git clone https://github.com/Sijie-Yang/SP-Survey.git
cd SP-Survey
npm install
cp .env.example .env   # add Supabase URL + anon key
npm run dev
```

Full self-host docs, issues, and releases: **https://github.com/Sijie-Yang/SP-Survey**

---

## Cite

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

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — Urban Analytics Lab, NUS
