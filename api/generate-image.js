// api/generate-image.js
// Vercel Serverless Function — generates campaign images via FAL AI
// Uses FLUX model for high-quality text-to-image generation
// Optionally takes a product image URL for image-to-image reference

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return res.status(500).json({ error: 'FAL_KEY not configured. Add it in Vercel environment variables.' });
  }

  const { prompt, image_url, image_size } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }

  try {
    let result;

    if (image_url) {
      // Image-to-image: use product image as reference
      result = await callFal(falKey, 'fal-ai/flux/dev/image-to-image', {
        prompt: prompt,
        image_url: image_url,
        strength: 0.75,
        image_size: image_size || 'landscape_16_9',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        enable_safety_checker: true
      });
    } else {
      // Text-to-image: generate from prompt only
      result = await callFal(falKey, 'fal-ai/flux/dev', {
        prompt: prompt,
        image_size: image_size || 'landscape_16_9',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        enable_safety_checker: true
      });
    }

    if (result && result.images && result.images.length > 0) {
      return res.status(200).json({
        image_url: result.images[0].url,
        width: result.images[0].width,
        height: result.images[0].height
      });
    }

    return res.status(500).json({ error: 'No image returned from FAL' });

  } catch (err) {
    console.error('FAL image generation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function callFal(apiKey, modelId, input) {
  // Submit the request
  const submitRes = await fetch(`https://queue.fal.run/${modelId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${apiKey}`
    },
    body: JSON.stringify(input)
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text().catch(() => '');
    throw new Error(`FAL API error ${submitRes.status}: ${errBody}`);
  }

  const submitData = await submitRes.json();

  // If we get images directly (synchronous response), return immediately
  if (submitData.images) {
    return submitData;
  }

  // Otherwise poll the queue
  const requestId = submitData.request_id;
  if (!requestId) {
    throw new Error('No request_id returned from FAL queue');
  }

  const statusUrl = `https://queue.fal.run/${modelId}/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/${modelId}/requests/${requestId}`;

  // Poll for completion (max ~55s to stay within Vercel timeout)
  const startTime = Date.now();
  const maxWait = 55000;

  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 1500));

    const statusRes = await fetch(statusUrl, {
      headers: { 'Authorization': `Key ${apiKey}` }
    });

    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();

    if (statusData.status === 'COMPLETED') {
      // Fetch the result
      const resultRes = await fetch(resultUrl, {
        headers: { 'Authorization': `Key ${apiKey}` }
      });
      if (resultRes.ok) {
        return await resultRes.json();
      }
      throw new Error('Failed to fetch completed result');
    }

    if (statusData.status === 'FAILED') {
      throw new Error('FAL generation failed: ' + (statusData.error || 'unknown'));
    }
  }

  throw new Error('FAL generation timed out');
}
