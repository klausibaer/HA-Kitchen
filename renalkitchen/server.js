const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = '/data';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readOptions() {
  try {
    const raw = fs.readFileSync('/data/options.json', 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function dataFile(key) {
  return path.join(DATA_DIR, `rk_${key}.json`);
}

function readData(key) {
  try {
    const raw = fs.readFileSync(dataFile(key), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeData(key, value) {
  fs.writeFileSync(dataFile(key), JSON.stringify(value), 'utf8');
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));

// Serve the frontend
app.use(express.static(path.join(__dirname, 'www')));

// ── API: Storage ──────────────────────────────────────────────────────────────

app.get('/api/data/:key', (req, res) => {
  const value = readData(req.params.key);
  res.json({ value });
});

app.post('/api/data/:key', (req, res) => {
  try {
    writeData(req.params.key, req.body.value);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Claude proxy ─────────────────────────────────────────────────────────
// Anthropic API key lives server-side in addon options — never sent to browser.

app.post('/api/claude', async (req, res) => {
  const opts = readOptions();
  const apiKey = opts.anthropic_api_key || '';

  if (!apiKey) {
    return res.status(400).json({ error: 'Anthropic API key not configured. Go to the addon Configuration tab in Home Assistant and add your key.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.body.model || 'claude-sonnet-4-20250514',
        max_tokens: req.body.max_tokens || 1200,
        messages: req.body.messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Claude API error' });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Status ───────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const opts = readOptions();
  res.json({
    configured: !!opts.anthropic_api_key,
  });
});

// ── Fallback ──────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`RenalKitchen addon running on port ${PORT}`);
  const opts = readOptions();
  if (!opts.anthropic_api_key) {
    console.warn('WARNING: No Anthropic API key configured. Set it in the addon Configuration tab.');
  } else {
    console.log('Anthropic API key configured OK.');
  }
});
