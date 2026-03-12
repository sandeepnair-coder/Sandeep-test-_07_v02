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

    console.log('PixelBin create response:', JSON.stringify(taskData));

    const taskId = taskData._id || taskData.id;
    if (!taskData || !taskId) {
      return res.status(500).json({ error: 'PixelBin did not return a task ID', response: taskData });
    }

    // If already completed (synchronous response)
    const imageUrl = extractImageUrl(taskData);
    if (taskData.status === 'completed' && imageUrl) {
      return res.status(200).json({
        image_url: imageUrl,
        width: parseInt(resolution.split('x')[0], 10),
        height: parseInt(resolution.split('x')[1], 10)
      });
    }

    // Poll for completion
    const result = await pollPrediction(pixelbinToken, taskId);

    const resultImageUrl = extractImageUrl(result);
    if (resultImageUrl) {
      return res.status(200).json({
        image_url: resultImageUrl,
        width: parseInt(resolution.split('x')[0], 10),
        height: parseInt(resolution.split('x')[1], 10)
      });
    }

    return res.status(500).json({ error: 'No image returned from PixelBin', response: result });

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

  const encodedToken = Buffer.from(apiToken).toString('base64');

  try {
    const response = await fetch('https://api.pixelbin.io/service/platform/transformation/v1.0/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${encodedToken}`
      },
      body: JSON.stringify({
        name: 'nanoBanana2_generate',
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
      const encodedToken = Buffer.from(apiToken).toString('base64');
      const response = await fetch(`https://api.pixelbin.io/service/platform/transformation/v1.0/predictions/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${encodedToken}`
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`PixelBin poll error ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      console.log(`PixelBin poll attempt ${attempt + 1}, status: ${data.status}`);

      if (data.status === 'completed') {
        console.log('PixelBin completed response:', JSON.stringify(data));
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

// Extract image URL from PixelBin response (handles various response formats)
function extractImageUrl(data) {
  if (!data) return null;
  // Check output array
  if (data.output && Array.isArray(data.output) && data.output.length > 0) {
    const first = data.output[0];
    return first.image_url || first.url || first.image || (typeof first === 'string' ? first : null);
  }
  // Check direct output object
  if (data.output && typeof data.output === 'object' && !Array.isArray(data.output)) {
    return data.output.image_url || data.output.url || data.output.image;
  }
  // Check direct URL fields
  return data.image_url || data.url || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
