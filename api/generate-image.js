// api/generate-image.js
// Vercel Serverless Function — generates campaign images via PixelBin AI
// Uses nanoBanana2_generate model for high-quality text-to-image generation

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pixelbinToken = process.env.PIXELBIN_API_TOKEN;
  if (!pixelbinToken) {
    return res.status(500).json({ error: 'PIXELBIN_API_TOKEN not configured. Add it in Vercel environment variables.' });
  }

  const { prompt, image_size } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }

  // Map image_size to resolution (default landscape 16:9)
  const resolution = mapResolution(image_size);

  try {
    // Create a prediction job via PixelBin
    const taskData = await createPrediction(pixelbinToken, {
      prompt: prompt,
      style: 'photorealistic',
      num_images: 1,
      quality: 'high',
      resolution: resolution
    });

    if (!taskData || !taskData.id) {
      return res.status(500).json({ error: 'PixelBin did not return a task ID' });
    }

    // If already completed (synchronous response)
    if (taskData.status === 'completed' && taskData.output && taskData.output.length > 0) {
      return res.status(200).json({
        image_url: taskData.output[0].image_url,
        width: parseInt(resolution.split('x')[0], 10),
        height: parseInt(resolution.split('x')[1], 10)
      });
    }

    // Poll for completion
    const result = await pollPrediction(pixelbinToken, taskData.id);

    if (result && result.output && result.output.length > 0) {
      return res.status(200).json({
        image_url: result.output[0].image_url,
        width: parseInt(resolution.split('x')[0], 10),
        height: parseInt(resolution.split('x')[1], 10)
      });
    }

    return res.status(500).json({ error: 'No image returned from PixelBin' });

  } catch (err) {
    console.error('PixelBin image generation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// Map FAL-style image_size strings to pixel resolutions
function mapResolution(imageSize) {
  const resolutionMap = {
    'landscape_16_9': '1024x576',
    'landscape_4_3': '1024x768',
    'square': '1024x1024',
    'square_hd': '1024x1024',
    'portrait_4_3': '768x1024',
    'portrait_16_9': '576x1024'
  };
  return resolutionMap[imageSize] || '1024x576';
}

// Create a prediction job on PixelBin
async function createPrediction(apiToken, input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s for initial request

  try {
    const response = await fetch('https://api.pixelbin.io/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify({
        model: 'nanoBanana2_generate',
        input: input
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`PixelBin API error ${response.status}: ${errBody}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('PixelBin prediction request timed out (15s)');
    }
    throw err;
  }
}

// Poll PixelBin for task completion
async function pollPrediction(apiToken, taskId) {
  const maxAttempts = 20;
  const pollInterval = 2000; // 2 seconds between polls
  const maxTime = 50000; // 50s total to stay within Vercel 60s limit
  const startTime = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() - startTime > maxTime) {
      throw new Error('PixelBin generation timed out (50s)');
    }

    await sleep(pollInterval);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`https://api.pixelbin.io/v1/predictions/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`PixelBin poll error ${response.status}: ${errBody}`);
      }

      const data = await response.json();

      if (data.status === 'completed') {
        return data;
      }

      if (data.status === 'failed') {
        throw new Error('PixelBin image generation failed');
      }

      // Still processing — continue polling
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        // Timeout on single poll — retry
        continue;
      }
      throw err;
    }
  }

  throw new Error('PixelBin generation did not complete in time');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
