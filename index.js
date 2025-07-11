// Full code for index.js with upgraded strategy support
// Includes bullish/bearish, strict + relaxed, 1h/30m/15m, CHOCH, OB+FVG logic

const express = require('express');
const axios = require('axios');
const app = express();

const SYMBOLS = [
  '1000BONKUSDT', 'HBARUSDT', 'BTCUSDT',
  'OPUSDT', 'SOLUSDT', 'SEIUSDT',
  'RNDRUSDT', '1000PEPEUSDT'
];

const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const TELEGRAM_CHAT_ID = 'YOUR_CHAT_ID';
const TIMEFRAMES = ['15m', '30m', '1h'];

// === /signals-relaxed.json (multi-timeframe relaxed) ===
app.get('/signals-relaxed.json', async (req, res) => {
  const results = {};

  for (const symbol of SYMBOLS) {
    const clean = symbol.replace(/^1000/, '');
    const signalGroup = {};

    for (const tf of TIMEFRAMES) {
      for (const dir of ['bullish', 'bearish']) {
        try {
          const candles = await getCandles(symbol, tf);
          const choch = detectCHOCH(candles, dir, 24);
          const bos = detectBOS(candles, dir, 30);
          const fvgs = detectFVG(candles, 50);
          const ob = detectOrderBlock(candles, dir, 50);
          const confluence = detectOBFVGOverlap(ob, fvgs);
          const unmitigatedFVG = fvgs.find(fvg => !isMitigated(fvg, candles));
          const unmitigatedOB = ob && !isMitigated(ob, candles) ? ob : null;
          const isKillzone = checkKillzone(new Date());
          const price = candles.at(-1).close;

          const grade = scoreRelaxedSignal({
            bos, fvg: !!unmitigatedFVG, ob: !!unmitigatedOB,
            killzone: isKillzone, choch, confluence
          });

          if (grade) {
            signalGroup[`${tf}_${dir}`] = {
              grade,
              price,
              direction: dir === 'bullish' ? 'Long' : 'Short',
              reason: [
                bos ? 'BOS' : null,
                choch ? 'CHOCH' : null,
                unmitigatedFVG ? 'FVG' : null,
                unmitigatedOB ? 'OB' : null,
                confluence ? 'OB+FVG' : null,
                isKillzone ? 'Killzone' : null
              ].filter(Boolean).join(' + '),
              session: getSessionName(new Date())
            };
          }
        } catch (e) {
          console.error(`❌ Error for ${symbol} ${tf} ${dir}:`, e.message);
        }
      }
    }
    if (Object.keys(signalGroup).length > 0) results[clean] = signalGroup;
  }
  res.json(results);
});

// === /signals.json (strict mode A+/A only, uses 15m timeframe) ===
app.get('/signals.json', async (req, res) => {
  const signals = {};
  const now = new Date();

  for (const symbol of SYMBOLS) {
    for (const direction of ['bullish', 'bearish']) {
      try {
        const candles = await getCandles(symbol, '15m');
        const bos = detectBOS(candles, direction, 30);
        const fvgs = detectFVG(candles, 50);
        const ob = detectOrderBlock(candles, direction, 50);
        const unmitigatedFVG = fvgs.find(fvg => !isMitigated(fvg, candles));
        const unmitigatedOB = ob && !isMitigated(ob, candles) ? ob : null;
        const isKillzone = checkKillzone(now);
        const grade = scoreSignal({ bos, fvg: !!unmitigatedFVG, ob: !!unmitigatedOB, killzone: isKillzone });

        if (grade === 'A+' || grade === 'A') {
          const price = candles.at(-1).close;
          const atr = price * 0.008;
          const cleanSymbol = symbol.replace(/^1000/, '');

          signals[`${cleanSymbol}_${direction === 'bullish' ? 'Long' : 'Short'}`] = {
            price,
            grade,
            direction: direction === 'bullish' ? 'Long' : 'Short',
            reason: [bos ? 'BOS' : null, unmitigatedFVG ? 'FVG' : null, unmitigatedOB ? 'OB' : null, isKillzone ? 'Killzone' : null].filter(Boolean).join(' + '),
            entry: unmitigatedOB ? [unmitigatedOB.bottom, unmitigatedOB.top] : [price * 0.996, price],
            sl: price - atr,
            tp1: price + atr * 1.5,
            tp2: price + atr * 3.0,
            session: getSessionName(now)
          };
        }
      } catch (e) {
        console.error(`❌ Error for ${symbol} ${direction}:`, e.message);
      }
    }
  }

  res.json(signals);
});

// === HELPERS ===
async function sendTelegramAlert(symbol, signal) {
  const message =
    `📈 *${symbol}* | ${signal.grade} | ${signal.reason}\n` +
    `Price: ${signal.price}\n` +
    `Entry: ${signal.entry[0].toFixed(6)} – ${signal.entry[1].toFixed(6)}\n` +
    `SL: ${signal.sl.toFixed(6)} | TP1: ${signal.tp1.toFixed(6)} | TP2: ${signal.tp2.toFixed(6)}\n` +
    `Session: ${signal.session}`;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
    console.log(`✅ Telegram alert sent for ${symbol}`);
  } catch (e) {
    console.error('Telegram send error:', e.message);
  }
}

async function getCandles(symbol, tf = '15m') {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=100`;
  const response = await axios.get(url);
  return response.data.map(c => ({
    openTime: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]),
    low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]), closeTime: c[6]
  }));
}

function detectCHOCH(candles, direction, window = 24) {
  const subset = candles.slice(-window);
  if (subset.length < window) return false;
  const highs = subset.map(c => c.high);
  const lows = subset.map(c => c.low);
  const last = subset.at(-1);
  if (direction === 'bullish') {
    return last.close > Math.max(...highs.slice(0, -1)) && lows.some((l, i) => i > 0 && l < lows[i - 1]);
  }
  if (direction === 'bearish') {
    return last.close < Math.min(...lows.slice(0, -1)) && highs.some((h, i) => i > 0 && h > highs[i - 1]);
  }
  return false;
}

function detectBOS(candles, direction = 'bullish', lookback = 30) {
  const current = candles.at(-1);
  const highs = candles.slice(-lookback - 1, -1).map(c => c.high);
  const lows = candles.slice(-lookback - 1, -1).map(c => c.low);
  if (direction === 'bullish') return current.close > Math.max(...highs);
  if (direction === 'bearish') return current.close < Math.min(...lows);
  return false;
}

function detectFVG(candles, lookback = 50) {
  const fvgs = [];
  for (let i = 2; i < Math.min(lookback, candles.length); i++) {
    const a = candles[i - 2], b = candles[i - 1], c = candles[i];
    const isImpulse = b.close > b.open && (b.close - b.open) > (b.high - b.low) * 0.5;
    if (a.high < c.low && isImpulse) {
      fvgs.push({ top: c.low, bottom: a.high, midpoint: (c.low + a.high) / 2 });
    }
  }
  return fvgs;
}

function detectOrderBlock(candles, direction = 'bullish', lookback = 50) {
  for (let i = lookback - 3; i >= 0; i--) {
    const c = candles[i], n1 = candles[i + 1], n2 = candles[i + 2];
    const valid = direction === 'bullish'
      ? c.close < c.open && n1.close > n1.open && n2.close > n2.open
      : c.close > c.open && n1.close < n1.open && n2.close < n2.open;
    if (valid) {
      return {
        open: c.open, close: c.close,
        high: c.high, low: c.low,
        top: Math.max(c.open, c.close),
        bottom: Math.min(c.open, c.close)
      };
    }
  }
  return null;
}

function detectOBFVGOverlap(ob, fvgs) {
  if (!ob || !fvgs.length) return false;
  return fvgs.some(fvg => {
    const overlap = fvg.bottom < ob.top && fvg.top > ob.bottom;
    const closeEnough = Math.abs(fvg.midpoint - ob.top) / ob.top < 0.015;
    return overlap || closeEnough;
  });
}

function isMitigated(zone, candles) {
  return candles.some(c => c.low <= zone.top && c.high >= zone.bottom);
}

function scoreSignal({ bos, fvg, ob, killzone }) {
  if (bos && fvg && ob && killzone) return 'A+';
  if (bos && fvg && ob) return 'A';
  if (fvg && ob) return 'B+';
  return null;
}

function scoreRelaxedSignal({ bos, fvg, ob, killzone, choch, confluence }) {
  if (choch && confluence && killzone) return 'A+';
  if (bos && fvg && ob && killzone) return 'A';
  if (bos && fvg && ob) return 'B+';
  if (fvg && ob) return 'B';
  return null;
}

function checkKillzone(date) {
  const utc = date.getUTCHours();
  return (utc >= 7 && utc <= 10) || (utc >= 12 && utc <= 16);
}

function getSessionName(date) {
  const utc = date.getUTCHours();
  if (utc >= 7 && utc < 10) return 'London';
  if (utc >= 12 && utc < 16) return 'NY Killzone';
  return 'Outside session';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
