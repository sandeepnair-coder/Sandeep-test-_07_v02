// api/fetch-site.js
// Vercel Serverless Function — fetches a brand's website and extracts key content
// Used to give Claude real data about the brand before generating analysis

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { urls } = req.body;
  if (!urls || !urls.length) {
    return res.status(400).json({ error: 'No URLs provided' });
  }

  const results = [];

  for (const url of urls.slice(0, 3)) { // Max 3 URLs
    try {
      let targetUrl = url.trim();
      if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FyndStudio/1.0; Brand Analyzer)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        signal: controller.signal,
        redirect: 'follow'
      });

      clearTimeout(timeout);

      if (!response.ok) {
        results.push({ url: targetUrl, status: 'error', error: 'HTTP ' + response.status });
        continue;
      }

      const html = await response.text();

      // Extract meaningful content from HTML
      const extracted = extractContent(html, targetUrl);
      results.push({ url: targetUrl, status: 'ok', content: extracted });

    } catch (err) {
      results.push({
        url: url,
        status: 'error',
        error: err.name === 'AbortError' ? 'Timeout (10s)' : err.message
      });
    }
  }

  return res.status(200).json({ results });
};

function extractContent(html, url) {
  const content = {
    title: '',
    description: '',
    products: [],
    categories: [],
    features: [],
    socialLinks: [],
    pricing: [],
    productImages: [],
    rawText: ''
  };

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) content.title = titleMatch[1].replace(/\s+/g, ' ').trim();

  // Extract meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
  if (descMatch) content.description = descMatch[1].trim();

  // Extract OG description as fallback
  if (!content.description) {
    const ogMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i);
    if (ogMatch) content.description = ogMatch[1].trim();
  }

  // Extract keywords
  const kwMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([\s\S]*?)["']/i);
  if (kwMatch) content.features = kwMatch[1].split(',').map(k => k.trim()).filter(Boolean).slice(0, 20);

  // Extract social media links
  const socialPatterns = [
    /href=["'](https?:\/\/(www\.)?instagram\.com\/[^"'\s]+)["']/gi,
    /href=["'](https?:\/\/(www\.)?facebook\.com\/[^"'\s]+)["']/gi,
    /href=["'](https?:\/\/(www\.)?twitter\.com\/[^"'\s]+)["']/gi,
    /href=["'](https?:\/\/(www\.)?youtube\.com\/[^"'\s]+)["']/gi,
    /href=["'](https?:\/\/(www\.)?linkedin\.com\/[^"'\s]+)["']/gi
  ];
  socialPatterns.forEach(pattern => {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      if (!content.socialLinks.includes(m[1])) content.socialLinks.push(m[1]);
    }
  });

  // Extract pricing signals (₹ amounts)
  const priceMatches = html.match(/₹[\s]*[\d,]+/g);
  if (priceMatches) {
    content.pricing = [...new Set(priceMatches)].slice(0, 10);
  }

  // Extract navigation/category items
  const navMatches = html.match(/<nav[\s\S]*?<\/nav>/gi);
  if (navMatches) {
    navMatches.forEach(nav => {
      const links = nav.match(/<a[^>]*>([^<]+)<\/a>/gi);
      if (links) {
        links.forEach(l => {
          const text = l.replace(/<[^>]+>/g, '').trim();
          if (text.length > 2 && text.length < 50 && !content.categories.includes(text)) {
            content.categories.push(text);
          }
        });
      }
    });
    content.categories = content.categories.slice(0, 30);
  }

  // Extract product/hero images (OG image, product images, hero images)
  const baseUrl = url.replace(/\/$/, '');
  const resolveUrl = (src) => {
    if (!src) return null;
    if (src.startsWith('http')) return src;
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('/')) return baseUrl + src;
    return baseUrl + '/' + src;
  };

  // OG image (usually the best brand/product image)
  const ogImgMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogImgMatch) content.productImages.push(resolveUrl(ogImgMatch[1]));

  // Product images (common patterns in e-commerce sites)
  const imgPatterns = [
    /<img[^>]*class=["'][^"']*(?:product|hero|banner|featured|main)[^"']*["'][^>]*src=["']([^"']+)["']/gi,
    /<img[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*(?:product|hero|banner|featured|main)[^"']*["']/gi,
    /<img[^>]*data-src=["']([^"']+)["'][^>]*class=["'][^"']*(?:product|hero|banner|featured)[^"']*["']/gi
  ];
  imgPatterns.forEach(pattern => {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const resolved = resolveUrl(m[1]);
      if (resolved && !content.productImages.includes(resolved) && !resolved.includes('svg') && !resolved.includes('icon')) {
        content.productImages.push(resolved);
      }
    }
  });

  // Fallback: large images that are likely product shots (srcset or large dimensions)
  if (content.productImages.length < 2) {
    const largImgs = html.match(/<img[^>]*src=["']([^"']+(?:\.jpg|\.jpeg|\.png|\.webp)[^"']*)["'][^>]*/gi);
    if (largImgs) {
      largImgs.slice(0, 10).forEach(tag => {
        const srcMatch = tag.match(/src=["']([^"']+)["']/i);
        if (srcMatch) {
          const resolved = resolveUrl(srcMatch[1]);
          if (resolved && !content.productImages.includes(resolved) && !resolved.includes('icon') && !resolved.includes('logo') && !resolved.includes('svg') && !resolved.includes('pixel') && !resolved.includes('tracking')) {
            content.productImages.push(resolved);
          }
        }
      });
    }
  }
  content.productImages = content.productImages.slice(0, 5);

  // Strip HTML tags and get clean text (first 3000 chars)
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  content.rawText = stripped.substring(0, 3000);

  return content;
}
