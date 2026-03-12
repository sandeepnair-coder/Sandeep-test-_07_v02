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

    // Try image-to-image first if product image is provided
    if (image_url) {
      try {
        result = await callFalSync(falKey, 'fal-ai/flux/dev/image-to-image', {
          prompt: prompt,
          image_url: image_url,
          strength: 0.75,
          image_size: image_size || 'landscape_16_9',
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          enable_safety_checker: true
        });
      } catch (imgErr) {
        // Image-to-image failed (likely bad URL), fall back to text-to-image
        console.warn('Image-to-image failed, falling back to text-to-image:', imgErr.message);
        result = null;
      }
    }

    // Text-to-image (primary path or fallback)
    if (!result || !result.images || !result.images.length) {
      result = await callFalSync(falKey, 'fal-ai/flux/dev', {
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

// Synchronous call via fal.run — waits for result directly
async function callFalSync(apiKey, modelId, input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000); // 55s to stay within Vercel 60s limit

  try {
    const response = await fetch(`https://fal.run/${modelId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${apiKey}`
      },
      body: JSON.stringify(input),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`FAL API error ${response.status}: ${errBody}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('FAL generation timed out (55s)');
    }
    throw err;
  }
}
