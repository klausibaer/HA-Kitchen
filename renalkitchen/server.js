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

// Use /rk/ prefix — HA Ingress intercepts /api/* before it reaches the addon
app.get('/rk/data/:key', (req, res) => {
  const value = readData(req.params.key);
  res.json({ value });
});

app.post('/rk/data/:key', (req, res) => {
  try {
    writeData(req.params.key, req.body.value);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Claude proxy ──────────────────────────────────────────────────────────────

app.post('/rk/claude', async (req, res) => {
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

app.get('/rk/status', (req, res) => {
  const opts = readOptions();
  res.json({
    configured: !!opts.anthropic_api_key,
    haToken: !!process.env.SUPERVISOR_TOKEN,
  });
});

// ── API: HA Sensor push ───────────────────────────────────────────────────────
// Writes entity states to HA via the Supervisor REST API.
// Body: { sensors: [{ entity_id, state, attributes, unit, icon }] }

app.post('/rk/sensor', async (req, res) => {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    return res.status(503).json({ error: 'SUPERVISOR_TOKEN not available — addon not running inside HA?' });
  }

  const { sensors } = req.body;
  if (!Array.isArray(sensors) || !sensors.length) {
    return res.status(400).json({ error: 'No sensors provided' });
  }

  const results = [];
  for (const s of sensors) {
    const entityId = s.entity_id.startsWith('sensor.') ? s.entity_id : `sensor.${s.entity_id}`;
    try {
      const r = await fetch(`http://supervisor/core/api/states/${entityId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          state: String(s.state ?? ''),
          attributes: {
            friendly_name: s.friendly_name || entityId,
            unit_of_measurement: s.unit || '',
            icon: s.icon || 'mdi:food',
            ...( s.attributes || {} ),
          },
        }),
      });
      const data = await r.json();
      results.push({ entity_id: entityId, ok: r.ok, data });
    } catch (e) {
      results.push({ entity_id: entityId, ok: false, error: e.message });
    }
  }

  const allOk = results.every(r => r.ok);
  res.status(allOk ? 200 : 207).json({ results });
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
