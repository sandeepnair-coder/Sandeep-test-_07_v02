// api/claude.js
// Vercel Serverless Function — generic Claude API proxy
// Forwards requests to Anthropic with server-side API key

module.exports = async function handler(req, res) {
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
    const { model, max_tokens, system, messages } = req.body;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 58000); // 58s (within 60s Vercel limit)

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 2000,
        system: system || '',
        messages: messages || []
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}));
      console.error('Claude proxy error:', anthropicRes.status, JSON.stringify(errBody));
      return res.status(anthropicRes.status).json(errBody);
    }

    const data = await anthropicRes.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Claude proxy error:', err.name, err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request to Anthropic API timed out. Please try again.' });
    }
    return res.status(500).json({ error: err.message });
  }
}
