const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow requests from anywhere (your listing agent HTML file)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check — Render uses this to know your server is alive
app.get('/', (req, res) => {
  res.json({ status: 'Magnific proxy running' });
});

// ─── Generate image via Magnific ─────────────────────────────────────────────
app.post('/generate', async (req, res) => {
  const { prompt, negative_prompt, model, magnific_key } = req.body;

  if (!magnific_key) {
    return res.status(400).json({ error: 'magnific_key is required' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const magnifcModel = model === 'ideogram' ? 'ideogram-v2' : 'flux-pro-1.1';

    const response = await fetch('https://api.magnific.ai/v1/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${magnific_key}`
      },
      body: JSON.stringify({
        prompt,
        negative_prompt: negative_prompt || '',
        model: magnifcModel,
        width: 1024,
        height: 1024,
        num_outputs: 1
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || data.detail || 'Magnific API error' });
    }

    // If async job — poll until done
    if (data.job_id || data.id) {
      const jobId = data.job_id || data.id;
      const imageUrl = await pollJob(jobId, magnific_key);
      return res.json({ image_url: imageUrl });
    }

    // If sync response — return URL directly
    const imageUrl = data.output_url || data.image_url || data.url || data.images?.[0]?.url;
    if (!imageUrl) {
      return res.status(500).json({ error: 'No image URL in response', raw: data });
    }

    res.json({ image_url: imageUrl });

  } catch (err) {
    console.error('Error calling Magnific:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Upscale image via Magnific ───────────────────────────────────────────────
app.post('/upscale', async (req, res) => {
  const { image_url, creativity, scale, magnific_key } = req.body;

  if (!magnific_key || !image_url) {
    return res.status(400).json({ error: 'magnific_key and image_url required' });
  }

  try {
    const response = await fetch('https://api.magnific.ai/v1/upscale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${magnific_key}`
      },
      body: JSON.stringify({
        image_url,
        scale: scale || 2,
        creativity: creativity || 3,
        hdr: 0.3,
        resemblance: 0.85
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Magnific upscale error' });
    }

    if (data.job_id || data.id) {
      const jobId = data.job_id || data.id;
      const imageUrl = await pollJob(jobId, magnific_key);
      return res.json({ image_url: imageUrl });
    }

    const imageUrl = data.output_url || data.image_url || data.url;
    res.json({ image_url: imageUrl });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Test key ─────────────────────────────────────────────────────────────────
app.post('/test', async (req, res) => {
  const { magnific_key } = req.body;
  if (!magnific_key) return res.status(400).json({ error: 'magnific_key required' });

  try {
    const response = await fetch('https://api.magnific.ai/v1/account', {
      headers: { 'Authorization': `Bearer ${magnific_key}` }
    });
    if (response.ok) {
      const data = await response.json();
      res.json({ valid: true, account: data });
    } else {
      res.json({ valid: false, status: response.status });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Poll for async job completion ────────────────────────────────────────────
async function pollJob(jobId, apiKey, attempts = 0) {
  if (attempts > 40) throw new Error('Timeout waiting for Magnific to finish');

  await new Promise(r => setTimeout(r, 3000));

  const res = await fetch(`https://api.magnific.ai/v1/jobs/${jobId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  const data = await res.json();
  console.log(`Job ${jobId} status: ${data.status} (attempt ${attempts + 1})`);

  if (data.status === 'completed' || data.status === 'succeeded') {
    return data.output_url || data.image_url || data.url || data.images?.[0]?.url;
  }
  if (data.status === 'failed' || data.status === 'error') {
    throw new Error(data.error || 'Job failed');
  }

  return pollJob(jobId, apiKey, attempts + 1);
}

app.listen(PORT, () => {
  console.log(`Magnific proxy running on port ${PORT}`);
});
