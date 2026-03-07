# Fynd Studio — Deployment Guide

## Project Structure

```
fynd-studio/
├── public/
│   └── index.html          ← Main website (rename design-studio-3-2.html)
├── api/
│   ├── brand-audit.js      ← Serverless function for brand analysis
│   └── claude.js           ← Generic Claude API proxy
├── vercel.json             ← Vercel routing & build config
├── package.json            ← Project metadata
└── README.md               ← This file
```

## Setup Instructions

### 1. Prepare the Repository

```bash
# Create project folder
mkdir fynd-studio && cd fynd-studio

# Copy files into structure
mkdir -p public api
cp design-studio-3-2.html public/index.html

# Initialize git
git init
git add .
git commit -m "Initial commit — Fynd Studio"
```

### 2. Push to GitHub

```bash
# Create a new repo on GitHub (e.g., fynd-studio)
git remote add origin https://github.com/YOUR_USERNAME/fynd-studio.git
git branch -M main
git push -u origin main
```

### 3. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account
2. Click **"Add New Project"**
3. Import your `fynd-studio` repository
4. Vercel will auto-detect the config from `vercel.json`
5. Click **"Deploy"**

### 4. Configure Environment Variables (Critical)

This is the most important step. Without it, the AI features won't work.

1. In your Vercel dashboard, go to your project → **Settings** → **Environment Variables**
2. Add the following variable:

   | Name | Value |
   |------|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-api03-your-key-here` |

3. Select all environments: **Production**, **Preview**, **Development**
4. Click **Save**
5. **Redeploy** the project (Settings → Deployments → click "..." on latest → Redeploy)

### 5. Test the Deployment

1. Visit your Vercel URL (e.g., `https://fynd-studio.vercel.app`)
2. Navigate to **Creative Intel**
3. Enter a brand name (e.g., "boAt") and click **"Analyse My Brand"**
4. The system will:
   - Call `/api/brand-audit` which securely proxies to Anthropic
   - Return AI-generated brand analysis data
   - Populate all scores, insights, and recommendations

### How It Works

```
User enters brand → Frontend calls /api/brand-audit (POST)
                            ↓
                  Vercel Serverless Function
                  (reads ANTHROPIC_API_KEY from env)
                            ↓
                  Calls Anthropic Claude API
                            ↓
                  Returns structured JSON
                            ↓
                  Frontend renders results
```

**Key security feature:** The API key never leaves the server. The frontend only communicates with your own `/api/brand-audit` endpoint — it never touches Anthropic directly.

### Fallback Behavior

If the API call fails (no key configured, network error, rate limit), the system automatically falls back to `generateRealisticData()` which produces deterministic, category-appropriate demo data based on the brand name hash. Users see a toast notification explaining the fallback.

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/brand-audit` | POST | Primary brand analysis (structured JSON response) |
| `/api/claude` | POST | Generic Claude proxy (for Strategy tab, future features) |

### Local Development

```bash
# Install Vercel CLI
npm i -g vercel

# Link to your Vercel project
vercel link

# Pull environment variables
vercel env pull .env.local

# Run locally
vercel dev
```

The site will be available at `http://localhost:3000`.

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "API key not configured" toast | Add `ANTHROPIC_API_KEY` in Vercel env vars and redeploy |
| "Offline mode" toast | Check network; `/api/brand-audit` endpoint may not be deployed |
| Results show but seem generic | Fallback data is being used; check Vercel function logs |
| 500 errors in console | Check Vercel dashboard → Functions → Logs for details |
| Strategy tab doesn't generate | Ensure `/api/claude` endpoint is also deployed |
