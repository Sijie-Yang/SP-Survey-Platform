# SP-Survey Templates Gallery

This directory contains the GitHub Pages site for displaying available survey templates.

## Setup GitHub Pages

1. Go to your repository settings
2. Navigate to **Pages** section
3. Under **Source**, select **GitHub Actions**
4. The workflow will automatically deploy when you push to `main` branch

## Manual Deployment

If you need to test locally:

```bash
# Serve the docs directory
cd docs
python -m http.server 8000

# Or use any static file server
npx serve docs
```

## Files

- `index.html` - Main template gallery page
- `public/project_templates/` - Template JSON files (copied during build)

## Automatic Updates

The GitHub Actions workflow automatically:
- Copies template files from `public/project_templates/` to `docs/public/project_templates/`
- Deploys to GitHub Pages when templates are updated

