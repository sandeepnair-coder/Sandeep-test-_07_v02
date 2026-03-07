// api/brand-audit.js
// Vercel Serverless Function — proxies requests to Anthropic Claude API
// API key is stored as ANTHROPIC_API_KEY in Vercel environment variables

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY to Vercel environment variables.' });
  }

  try {
    const { brandName, category, segment, urls, systemPrompt, userPrompt } = req.body;

    if (!brandName && !userPrompt) {
      return res.status(400).json({ error: 'Missing required fields: brandName or userPrompt' });
    }

    // Build the prompt if not provided directly
    const system = systemPrompt || buildSystemPrompt();
    const user = userPrompt || buildUserPrompt(brandName, category, segment, urls);

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

Respond ONLY with valid JSON, no markdown, no backticks, no explanation outside the JSON. Use this exact structure:
{
  "scores": {
    "velocity": <0-100>,
    "stagnation": <"LOW"|"MEDIUM"|"HIGH">,
    "regional": <0-100>,
    "ai": <0-100>,
    "platform": <0-100>
  },
  "savings": "<string like '₹45–72 Lakhs'>",
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
  }
}`;
}

function buildUserPrompt(brandName, category, segment, urls) {
  return `Brand: ${brandName || 'Unknown'}
Category: ${category || 'D2C / E-Commerce'}
Market Segment: ${segment || 'Premium Mid-Market'}
Website/Social URLs: ${urls && urls.length ? urls.join(', ') : 'not provided'}

Produce a realistic, specific creative health check for this Indian D2C brand. Use your knowledge of this brand (if known) or infer from the category and segment. All scores, savings, and findings must be realistic for an Indian D2C brand at this stage. Reference specific Indian platforms, festivals, and content formats. Be critical where appropriate — don't inflate scores.`;
}
