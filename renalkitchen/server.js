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

app.use(express.json({ limit: '25mb' }));

// ── Serve the frontend (inject ingress path for HA Ingress BASE detection) ────
// HA Ingress sends X-Ingress-Path header. We inject it as a <meta> tag so
// app.js can compute BASE correctly regardless of proxy depth.
app.get('/', (req, res) => {
  const ingressPath = req.headers['x-ingress-path'] || '';
  // Derive API base: ingressPath is e.g. /api/hassio_ingress/TOKEN (no trailing slash)
  // We expose it directly so the client never has to guess from window.location.
  const apiBase = ingressPath ? (ingressPath.endsWith('/') ? ingressPath : ingressPath + '/') : '/';
  console.log(`[RK] GET / — ingress-path: "${ingressPath}" → apiBase: "${apiBase}" — ua: ${(req.headers['user-agent']||'').slice(0,80)}`);
  try {
    let html = fs.readFileSync(path.join(__dirname, 'www', 'index.html'), 'utf8');
    const metas = `<meta name="ingress-path" content="${ingressPath}"/>\n` +
                  `<meta name="rk-api-base" content="${apiBase}"/>\n`;
    html = html.replace('<link rel="stylesheet"', metas + '<link rel="stylesheet"');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (e) {
    res.status(500).send('Failed to load index.html: ' + e.message);
  }
});
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

// ── API: Pantry (fridge/storage inventory) ────────────────────────────────────
const PANTRY_FILE = path.join(DATA_DIR, 'rk_pantry.json');

function readPantry() {
  try { return JSON.parse(fs.readFileSync(PANTRY_FILE, 'utf8')); }
  catch { return []; }
}
function writePantry(items) {
  fs.writeFileSync(PANTRY_FILE, JSON.stringify(items), 'utf8');
}

app.get('/rk/pantry', (req, res) => {
  res.json({ items: readPantry() });
});

app.post('/rk/pantry', (req, res) => {
  try {
    const items = readPantry();
    const item = { ...req.body, id: Date.now().toString(), addedAt: new Date().toISOString() };
    items.push(item);
    writePantry(items);
    res.json({ item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/rk/pantry/:id', (req, res) => {
  try {
    const items = readPantry();
    const idx = items.findIndex(i => i.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    items[idx] = { ...items[idx], ...req.body, id: req.params.id };
    writePantry(items);
    res.json({ item: items[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/rk/pantry/:id', (req, res) => {
  try {
    const items = readPantry().filter(i => i.id !== req.params.id);
    writePantry(items);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk replace (for receipt-scan batch import)
app.post('/rk/pantry/bulk', (req, res) => {
  try {
    const existing = readPantry();
    const newItems = (req.body.items || []).map(item => ({
      ...item, id: Date.now().toString() + Math.random(), addedAt: new Date().toISOString()
    }));
    writePantry([...existing, ...newItems]);
    res.json({ added: newItems.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: HA Users (person entities) ──────────────────────────────────────────
// Returns person.* entities from HA so profiles can be linked to real HA users.
app.get('/rk/ha-users', async (req, res) => {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    return res.json({ users: [] }); // graceful fallback when not in HA
  }
  try {
    const r = await fetch('http://supervisor/core/api/states', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) return res.json({ users: [] });
    const states = await r.json();
    const persons = states
      .filter(s => s.entity_id.startsWith('person.'))
      .map(s => ({
        id: s.entity_id,
        name: s.attributes.friendly_name || s.entity_id.replace('person.', ''),
        entityId: s.entity_id,
        picture: s.attributes.entity_picture || null,
      }));
    res.json({ users: persons });
  } catch (e) {
    res.json({ users: [], error: e.message });
  }
});


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
