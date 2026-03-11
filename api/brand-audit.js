// api/brand-audit.js
// Vercel Serverless Function — proxies requests to Anthropic Claude API
// API key is stored as ANTHROPIC_API_KEY in Vercel environment variables

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Use server env key first, fall back to user-provided key from header
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-user-api-key'];
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Click the gear icon in the nav bar to add your Anthropic API key.' });
  }

  try {
    const { brandName, category, segment, urls, systemPrompt, userPrompt } = req.body;

    if (!brandName && !userPrompt) {
      return res.status(400).json({ error: 'Missing required fields: brandName or userPrompt' });
    }

    // Fetch website content if URLs provided
    let siteContent = '';
    if (urls && urls.length) {
      try {
        const siteData = await fetchBrandSite(urls.slice(0, 2));
        if (siteData) siteContent = siteData;
      } catch(e) {
        console.warn('Website fetch failed:', e.message);
      }
    }

    // Build the prompt if not provided directly
    const system = systemPrompt || buildSystemPrompt();
    const user = userPrompt || buildUserPrompt(brandName, category, segment, urls, siteContent);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000); // 55s safety margin

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: system,
        messages: [{ role: 'user', content: user }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}));
      console.error('Anthropic API error:', anthropicRes.status, JSON.stringify(errBody));
      return res.status(anthropicRes.status).json({
        error: errBody.error?.message || `Anthropic API error: ${anthropicRes.status}`
      });
    }

    const data = await anthropicRes.json();
    const rawText = data.content.map(c => c.text || '').join('');

    // Try to parse as JSON (strip markdown fences if present)
    let parsed;
    try {
      const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Return raw text if not valid JSON
      parsed = { raw: rawText };
    }

    return res.status(200).json({
      success: true,
      data: parsed,
      model: data.model,
      usage: data.usage
    });

  } catch (err) {
    console.error('Serverless function error:', err.name, err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request to Anthropic API timed out. Please try again.' });
    }
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

function buildSystemPrompt() {
  return `You are an expert Indian D2C brand creative strategist and media analyst. You analyse brands and produce a structured creative health check report. You have deep knowledge of India's D2C ecosystem, ad market benchmarks, platform dynamics (Instagram, YouTube, CTV, Q-Commerce), and the competitive landscape across fashion, beauty, FMCG, and consumer electronics.

When given a brand name, category, market segment, and website URLs, you produce a realistic, data-grounded audit. Use your knowledge of the Indian D2C market to generate realistic scores, gaps, and opportunities. Be specific — name real platforms, real festivals, real content formats. Avoid generic advice.

IMPORTANT — For every score and finding, you MUST provide:
1. A confidence level ("high" if you have direct knowledge of this brand, "medium" if inferring from category/segment, "low" if based on general assumptions)
2. A methodology note explaining HOW you arrived at that specific number/finding
3. Source references — cite the specific benchmarks, reports, or data points you used (e.g. "RedSeer D2C Report 2024", "Meta Business Suite benchmarks", "Bain & Company India D2C Report")

This is critical for user trust — every data point must be traceable to a reasoning chain.

Respond ONLY with valid JSON, no markdown, no backticks, no explanation outside the JSON. Use this exact structure:
{
  "scores": {
    "velocity": <0-100>,
    "stagnation": <"LOW"|"MEDIUM"|"HIGH">,
    "regional": <0-100>,
    "ai": <0-100>,
    "platform": <0-100>
  },
  "scoreMethodology": {
    "velocity": {"confidence": "<high|medium|low>", "method": "<1-2 sentences: how you calculated this score>", "benchmark": "<what you compared against>"},
    "stagnation": {"confidence": "<high|medium|low>", "method": "<1-2 sentences>", "benchmark": "<comparison>"},
    "regional": {"confidence": "<high|medium|low>", "method": "<1-2 sentences>", "benchmark": "<comparison>"},
    "ai": {"confidence": "<high|medium|low>", "method": "<1-2 sentences>", "benchmark": "<comparison>"},
    "platform": {"confidence": "<high|medium|low>", "method": "<1-2 sentences>", "benchmark": "<comparison>"}
  },
  "savings": "<string like '₹45–72 Lakhs'>",
  "savingsMethodology": "<2-3 sentences explaining assumptions: team size, content volume, cost per asset, AI tool pricing used>",
  "overallGrade": "<A+|A|B+|B|C+|C|D>",
  "topInsight": "<one powerful sentence>",
  "breakdown": [
    {"item": "<string>", "trad": "<string>", "ai": "<string>"}
  ],
  "alerts": [
    {"type": "<red|yellow|green>", "icon": "<html>", "text": "<html string>"}
  ],
  "regions": [
    {"name": "<string>", "score": <0-100>}
  ],
  "priorities": [
    {"rank": <1-3>, "action": "<string>", "impact": "<string>", "timeline": "<string>"}
  ],
  "competitorBenchmark": {
    "summary": "<string>",
    "postsPerMonth": <integer>,
    "categoryLeaderPosts": <integer>,
    "aiAdoptionPct": <integer>,
    "categoryAvgAiPct": <integer>
  },
  "dataSources": [
    "<string — each source/report/benchmark cited, e.g. 'RedSeer India D2C Report 2024', 'Meta Business Suite category benchmarks', 'Bain India D2C Landscape 2024'>",
    "<string>",
    "<string>",
    "<string>"
  ],
  "analysisDisclaimer": "<1-2 sentences: honest statement about data limitations — e.g. 'Scores are estimated from public signals and category benchmarks. For verified metrics, connect your analytics accounts.'>"
}`;
}

function buildUserPrompt(brandName, category, segment, urls, siteContent) {
  let prompt = `Brand: ${brandName || 'Unknown'}
Category: ${category || 'D2C / E-Commerce'}
Market Segment: ${segment || 'Premium Mid-Market'}
Website/Social URLs: ${urls && urls.length ? urls.join(', ') : 'not provided'}`;

  if (siteContent) {
    prompt += `\n\n--- BRAND WEBSITE DATA (scraped from actual site) ---\n${siteContent}\n--- END WEBSITE DATA ---\n`;
    prompt += `\nUse the website data above to understand what this brand actually sells, their positioning, categories, and pricing. Ground your analysis in this real data.`;
  } else {
    prompt += `\n\nNote: Website could not be fetched. For brand-specific metrics you cannot verify, mark confidence as "low" and note the limitation.`;
  }

  prompt += `\n\nProduce a realistic, specific creative health check for this Indian D2C brand. Use your knowledge of this brand (if known) or infer from the category and segment. All scores, savings, and findings must be realistic for an Indian D2C brand at this stage. Reference specific Indian platforms, festivals, and content formats. Be critical where appropriate — don't inflate scores. NEVER fabricate specific numbers — if you don't know, say so in your methodology notes.`;

  return prompt;
}

async function fetchBrandSite(urls) {
  const results = [];
  for (const url of urls) {
    try {
      let targetUrl = url.trim();
      if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FyndStudio/1.0; Brand Analyzer)',
          'Accept': 'text/html'
        },
        signal: controller.signal,
        redirect: 'follow'
      });

      clearTimeout(timeout);
      if (!response.ok) continue;

      const html = await response.text();

      // Extract key content
      const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const desc = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) || [])[1] || '';
      const keywords = (html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([\s\S]*?)["']/i) || [])[1] || '';

      // Get clean text
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 2000);

      // Get prices
      const prices = (html.match(/₹[\s]*[\d,]+/g) || []).slice(0, 10);

      results.push(`URL: ${targetUrl}\nTitle: ${title.trim()}\nDescription: ${desc.trim()}\nKeywords: ${keywords.trim()}\nPrices found: ${prices.join(', ') || 'none'}\nPage content: ${stripped}`);
    } catch(e) {
      // Skip failed URLs
    }
  }
  return results.length ? results.join('\n\n') : null;
}
}
