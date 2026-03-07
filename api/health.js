// api/health.js
// Health check endpoint — visit /api/health to verify deployment and API key config

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  return res.status(200).json({
    status: 'ok',
    hasApiKey,
    timestamp: new Date().toISOString(),
    runtime: process.version
  });
};
