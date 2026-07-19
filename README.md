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

- **ChatGPT (Codex) via MCP** — design surveys, upload media, share links, and analyze results from ChatGPT using the remote `sp_survey` MCP (OAuth; no API key on this site)
- **No-code survey builder** — image choice, rating, ranking, matrix, annotation, media panels, and custom skill iframes
- **In-browser AI assistant** — optional OpenAI / OpenRouter key for the builder chat panel
- **Research templates** — start from peer-reviewed designs (Place Pulse, SPECS, thermal affordance, and more)
- **Cloud media** — upload images (browser-side compression) or import Hugging Face datasets
- **Share & analyze** — live survey links, TrueSkill / reliability metrics, CSV export with `__shown_images`
- **Paper library** — browse urban-perception literature and match published methods to templates

---

## ChatGPT (Codex) + MCP

Design and run a study almost entirely from **ChatGPT (Codex)** through the platform’s remote MCP:

1. Sign in at **[sp-survey.org/admin](https://sp-survey.org/admin)**
2. Open toolbar **AI** → **AI & Integrations**
3. Set ChatGPT (Codex) permission to **Approve for me**, paste the setup message, and approve OAuth in your browser
4. Start a **new** Codex chat and ask it to use `sp_survey` (topic, question types, media now or later)
5. Share the live survey link with participants — **saves update the link immediately**
6. Ask Codex to summarize / export results for a project when data comes in

Example prompt:

```text
Using sp_survey MCP, create a survey about <your topic description>.
Add question types <question type description>.
I have media datasets <description> at <folder location>. (can be done later)
```

Local Codex config (`~/.codex/config.toml`):

```toml
mcp_oauth_credentials_store = "keyring"

[mcp_servers.sp_survey]
url = "https://sp-survey.org/mcp"
auth = "oauth"
scopes = ["surveys:read", "surveys:write", "surveys:publish", "media:write", "results:read"]
```

```bash
codex mcp login sp_survey
```

MCP covers project lifecycle, draft editing (`survey_apply_operations`), media upload / set–category tags, and results list/export/summary. Full tool catalog and deploy notes: [`docs/agent-mcp.md`](./docs/agent-mcp.md) · agent workflow: [`AGENTS.md`](./AGENTS.md).

---

## Use

### Hosted (recommended)

Go to **[sp-survey.org](https://sp-survey.org)**, create an account, and start building. Cloud storage, auth, and live links are handled for you. Connect ChatGPT (Codex) under **Admin → AI** as above.

### Self-host (open source)

Need a **login-free** admin panel and your own infrastructure? Use **[Sijie-Yang/SP-Survey](https://github.com/Sijie-Yang/SP-Survey)**:

| | Hosted ([sp-survey.org](https://sp-survey.org)) | Self-host ([SP-Survey](https://github.com/Sijie-Yang/SP-Survey)) |
|---|---|---|
| Login | Account required | **None** — open `/admin` directly |
| Media & responses | Managed for you | Your **Supabase** project |
| Participant survey | Share platform link | Deploy yourself (**Vercel** / static host) |

```bash
git clone https://github.com/Sijie-Yang/SP-Survey.git
cd SP-Survey
npm install && npm run dev
# Admin: http://localhost:3000/admin  (no login)
```

Setup overview: configure Supabase Storage → build survey → create `survey_responses` → deploy survey site to Vercel with the **anon** key. Full steps: **https://github.com/Sijie-Yang/SP-Survey**

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
