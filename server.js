const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
// On Railway, mount a volume at /data. Locally this falls back to ./data
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LOGO_FILE = path.join(DATA_DIR, 'logo.bin');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

function freshState() {
  return {
    title: 'Premier Controls Scramble',
    teams: [
      { name: 'Team 1', players: ['', '', '', ''] },
      { name: 'Team 2', players: ['', '', '', ''] }
    ],
    pars: DEFAULT_PARS.slice(),
    scores: [Array(18).fill(null), Array(18).fill(null)],
    cart: [],
    logoType: null,
    rev: 0,
    updatedAt: Date.now()
  };
}

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const base = freshState();
    return { ...base, ...s };
  } catch (e) {
    return freshState();
  }
}

let state = load();

function save() {
  state.rev += 1;
  state.updatedAt = Date.now();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

if (!fs.existsSync(STATE_FILE)) save();

const isHole = (n) => Number.isInteger(n) && n >= 0 && n < 18;
const clean = (v, max = 60) => String(v == null ? '' : v).slice(0, max);

app.use(express.json({ limit: '100kb' }));

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(state);
});

// Set one score. strokes = null clears it.
app.put('/api/score', (req, res) => {
  const { team, hole, strokes } = req.body || {};
  if (![0, 1].includes(team) || !isHole(hole)) return res.status(400).json({ error: 'bad team or hole' });
  if (strokes !== null && !(Number.isInteger(strokes) && strokes >= 1 && strokes <= 20)) {
    return res.status(400).json({ error: 'strokes must be 1-20 or null' });
  }
  state.scores[team][hole] = strokes;
  save();
  res.json(state);
});

// Setup: title, team names/players, pars
app.put('/api/setup', (req, res) => {
  const b = req.body || {};
  if (b.title !== undefined) state.title = clean(b.title, 80) || state.title;
  if (Array.isArray(b.teams) && b.teams.length === 2) {
    state.teams = b.teams.map((t, i) => ({
      name: clean(t && t.name, 40) || `Team ${i + 1}`,
      players: [0, 1, 2, 3].map((k) => clean(t && t.players && t.players[k], 30))
    }));
  }
  if (Array.isArray(b.pars) && b.pars.length === 18) {
    const pars = b.pars.map(Number);
    if (!pars.every((p) => Number.isInteger(p) && p >= 3 && p <= 6)) {
      return res.status(400).json({ error: 'pars must be integers 3-6' });
    }
    state.pars = pars;
  }
  save();
  res.json(state);
});

// Beverage cart requests (Andrew)
app.post('/api/cart', (req, res) => {
  const b = req.body || {};
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    who: clean(b.who, 30),
    hole: Number.isInteger(b.hole) && b.hole >= 1 && b.hole <= 18 ? b.hole : null,
    note: clean(b.note, 120),
    done: false,
    at: Date.now()
  };
  state.cart.unshift(item);
  state.cart = state.cart.slice(0, 50);
  save();
  res.json(state);
});

app.put('/api/cart/:id', (req, res) => {
  const item = state.cart.find((c) => c.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.done = !!(req.body && req.body.done);
  save();
  res.json(state);
});

app.delete('/api/cart/:id', (req, res) => {
  state.cart = state.cart.filter((c) => c.id !== req.params.id);
  save();
  res.json(state);
});

// Wipe scores only (keeps pars, names, logo)
app.post('/api/reset-scores', (req, res) => {
  state.scores = [Array(18).fill(null), Array(18).fill(null)];
  save();
  res.json(state);
});

// Logo upload: raw image body
app.post('/api/logo', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '6mb' }), (req, res) => {
  const type = req.headers['content-type'] || '';
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'no image' });
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)/.test(type)) return res.status(400).json({ error: 'unsupported type' });
  fs.writeFileSync(LOGO_FILE, req.body);
  state.logoType = type.split(';')[0];
  save();
  res.json({ ok: true });
});

app.get('/logo', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  if (state.logoType && fs.existsSync(LOGO_FILE)) {
    res.type(state.logoType);
    return res.send(fs.readFileSync(LOGO_FILE));
  }
  const bundled = path.join(__dirname, 'public', 'logo.png');
  if (fs.existsSync(bundled)) return res.sendFile(bundled);
  res.status(404).end();
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Scramble scoreboard on :${PORT}, data in ${DATA_DIR}`);
});
