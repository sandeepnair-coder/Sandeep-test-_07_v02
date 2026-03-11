// api/health.js
// Health check endpoint — visit /api/health to verify deployment and API key config
// GET /api/health — basic check
// POST /api/health — full diagnostic: tests Anthropic API connection

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-api-key');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.ANTHROPIC_API_KEY || (req.headers && req.headers['x-user-api-key']);
  const hasApiKey = !!apiKey;

  // Basic GET check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      hasApiKey,
      timestamp: new Date().toISOString(),
      runtime: process.version
    });
  }

  // POST = full diagnostic — actually test the Anthropic API
  if (req.method === 'POST') {
    const diagnostics = {
      status: 'running',
      hasApiKey,
      keyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : null,
      timestamp: new Date().toISOString(),
      runtime: process.version,
      tests: {}
    };

    if (!apiKey) {
      diagnostics.status = 'fail';
      diagnostics.tests.apiKey = { pass: false, error: 'No API key found in environment or request header' };
      return res.status(200).json(diagnostics);
    }

    diagnostics.tests.apiKey = { pass: true, detail: 'Key present (' + apiKey.substring(0, 10) + '...)' };

    // Test actual Anthropic API connection with minimal request
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 20,
          messages: [{ role: 'user', content: 'Reply with just the word "ok"' }]
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (anthropicRes.ok) {
        const data = await anthropicRes.json();
        diagnostics.tests.anthropicApi = {
          pass: true,
          detail: 'Connected successfully',
          model: data.model,
          usage: data.usage
        };
        diagnostics.status = 'pass';
      } else {
        const errBody = await anthropicRes.json().catch(() => ({}));
        diagnostics.tests.anthropicApi = {
          pass: false,
          httpStatus: anthropicRes.status,
          error: errBody.error?.message || 'HTTP ' + anthropicRes.status,
          errorType: errBody.error?.type || 'unknown',
          detail: anthropicRes.status === 401 ? 'Invalid API key — check your key at console.anthropic.com'
                : anthropicRes.status === 403 ? 'API key lacks permission — check your Anthropic account permissions'
                : anthropicRes.status === 429 ? 'Rate limited or insufficient credits — check your Anthropic billing at console.anthropic.com/settings/billing'
                : anthropicRes.status === 529 ? 'Anthropic API is overloaded — try again in a few minutes'
                : 'Unexpected error from Anthropic API'
        };
        diagnostics.status = 'fail';
      }
    } catch (err) {
      diagnostics.tests.anthropicApi = {
        pass: false,
        error: err.name === 'AbortError' ? 'Connection timed out (15s)' : err.message,
        detail: err.name === 'AbortError'
          ? 'Could not reach api.anthropic.com — possible network issue'
          : 'Network error connecting to Anthropic'
      };
      diagnostics.status = 'fail';
    }

    return res.status(200).json(diagnostics);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
