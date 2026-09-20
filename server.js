// Tiny relay server for the EMA/RSI Gold/Silver EA.
//
// What it does, on purpose, and no more:
//   - Accepts a BUY/SELL signal POSTed from the MT5 EA (via WebRequest)
//   - Keeps the most recent signals in memory (and a JSON file as a light backup)
//   - Serves a small mobile-friendly page (the PWA) that polls for and shows them
//
// It does NOT touch your broker account, place trades, or read your positions/equity.
// It's a one-way notice board: EA -> here -> your phone.

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const DATA_FILE = path.join(__dirname, 'signals.json');
const MAX_SIGNALS = 300;

if (!API_KEY) {
  console.error('ERROR: API_KEY environment variable is not set. Refusing to start with no auth.');
  console.error('Set it on your hosting platform (see the setup guide) before deploying.');
  process.exit(1);
}

// --- Load any signals persisted from a previous run (best-effort; not guaranteed durable storage) ---
let signals = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    signals = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(signals)) signals = [];
  }
} catch (err) {
  console.warn('Could not load existing signals.json, starting fresh:', err.message);
  signals = [];
}

function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(signals));
  } catch (err) {
    // Non-fatal: some hosts have read-only or ephemeral filesystems. In-memory copy still works
    // for as long as the process stays up.
    console.warn('Could not persist signals.json:', err.message);
  }
}

function requireApiKey(req, res, next) {
  const key = req.get('x-api-key');
  if (key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'invalid or missing X-API-Key header' });
  }
  next();
}

const app = express();
app.use(express.json({ limit: '10kb' }));

// Health check - useful if you wire up an external uptime pinger to reduce cold starts.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// EA posts here whenever it generates a BUY/SELL signal.
app.post('/api/signal', requireApiKey, (req, res) => {
  const { symbol, direction, time, entry, sl, tp, rsi, reason } = req.body || {};

  if (!symbol || !direction || !['BUY', 'SELL'].includes(String(direction).toUpperCase())) {
    return res.status(400).json({ ok: false, error: 'symbol and direction (BUY/SELL) are required' });
  }

  const signal = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    receivedAt: new Date().toISOString(),
    symbol: String(symbol).slice(0, 20),
    direction: String(direction).toUpperCase(),
    time: time ? String(time).slice(0, 40) : null,
    entry: typeof entry === 'number' ? entry : null,
    sl: typeof sl === 'number' ? sl : null,
    tp: typeof tp === 'number' ? tp : null,
    rsi: typeof rsi === 'number' ? rsi : null,
    reason: reason ? String(reason).slice(0, 300) : null,
  };

  signals.unshift(signal);
  if (signals.length > MAX_SIGNALS) signals.length = MAX_SIGNALS;
  persist();

  console.log(`[signal] ${signal.direction} ${signal.symbol} @ ${signal.entry ?? '?'}`);
  res.json({ ok: true });
});

// The PWA polls this to display the feed.
app.get('/api/signals', requireApiKey, (req, res) => {
  res.json({ ok: true, signals });
});

// Serve the PWA (index.html, manifest.json, sw.js, icons, app.js)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Signal dashboard listening on port ${PORT}`);
});
