const express = require('express');
const axios = require('axios');
const app = express();

const SYMBOLS = [
  '1000BONKUSDT', 'HBARUSDT', 'BTCUSDT',
  'OPUSDT', 'SOLUSDT', 'SEIUSDT',
  'RNDRUSDT', '1000PEPEUSDT'
];

const TELEGRAM_TOKEN = '7627714754:AAGfIzQ8ujOqvB1Iai8Erf8NkP3FGY_mPIM';
const TELEGRAM_CHAT_ID = '5683374691';

// === /signals.json (Strict Sniper with Telegram A+/A only) ===
app.get('/signals.json', async (req, res) => {
  const signals = {};
  const now = new Date();

  for (const symbol of SYMBOLS) {
    try {
      const candles = await getCandles(symbol);
      const bos = detectBOS(candles, 'bullish', 30);
      const fvgs = detectFVG(candles, 50);
      const ob = detectOrderBlock(candles, 50);
      const unmitigatedFVG = fvgs.find(fvg => !isMitigated(fvg, candles));
      const unmitigatedOB = ob && !isMitigated(ob, candles) ? ob : null;
      const isKillzone = checkKillzone(now);
      const grade = scoreSignal({ bos, fvg: !!unmitigatedFVG, ob: !!unmitigatedOB, killzone: isKillzone });

      if (grade) {
        const price = candles.at(-1).close;
        const atr = price * 0.008;
        const cleanSymbol = symbol.replace(/^1000/, '');

        const signal = {
          price,
          grade,
          reason: [bos ? 'BOS' : null, unmitigatedFVG ? 'FVG' : null, unmitigatedOB ? 'OB' : null, isKillzone ? 'Killzone' : null].filter(Boolean).join(' + '),
          entry: unmitigatedOB ? [unmitigatedOB.bottom, unmitigatedOB.top] : [price * 0.996, price],
          sl: price - atr,
          tp1: price + atr * 1.5,
          tp2: price + atr * 3.0,
          session: getSessionName(now)
        };

        signals[cleanSymbol] = signal;

        if (grade === 'A+' || grade === 'A') {
          await sendTelegramAlert(cleanSymbol, signal);
        }
      }
    } catch (e) {
      console.error(`❌ Error for ${symbol}:`, e.message);
    }
  }

  console.log("📊 RELAXED SIGNALS DETECTED:", JSON.stringify(results, null, 2));
  res.json(signals);
});

// === /signals-relaxed.json (Relaxed: B, B+, A, A+ — 5m + 15m) ===
app.get('/signals-relaxed.json', async (req, res) => {
  const timeframes = ['15m', '5m'];
  const results = {};

  for (const symbol of SYMBOLS) {
    const resultPerSymbol = {};
    for (const tf of timeframes) {
      try {
        const candles = await getCandles(symbol, tf);
        const direction = detectTrendDirection(candles);
        const bos = detectBOS(candles, direction, 30);
        const fvgs = detectFVG(candles, 50);
        const ob = detectOrderBlock(candles, direction, 50);
        const unmitigatedFVG = fvgs.find(fvg => !isMitigated(fvg, candles));
        const unmitigatedOB = ob && !isMitigated(ob, candles) ? ob : null;
        const isKillzone = checkKillzone(new Date());
        const grade = scoreRelaxedSignal({ bos, fvg: !!unmitigatedFVG, ob: !!unmitigatedOB, killzone: isKillzone });

        if (grade) {
          resultPerSymbol[tf] = {
            grade,
            reason: [bos ? 'BOS' : null, unmitigatedFVG ? 'FVG' : null, unmitigatedOB ? 'OB' : null, isKillzone ? 'Killzone' : null].filter(Boolean).join(' + ')
          };
        }
      } catch (e) {
        console.error(`❌ Error for ${symbol} ${tf}:`, e.message);
      }
    }

    if (Object.keys(resultPerSymbol).length > 0) {
      const clean = symbol.replace(/^1000/, '');
      results[clean] = resultPerSymbol;
    }
  }

  res.json(results);
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
    openTime: c[0],
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    closeTime: c[6]
  }));
}

function detectTrendDirection(candles) {
  const closes = candles.slice(-10).map(c => c.close);
  return (closes.at(-1) - closes[0]) >= 0 ? 'bullish' : 'bearish';
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
      fvgs.push({
        top: c.low,
        bottom: a.high,
        midpoint: (c.low + a.high) / 2
      });
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

function isMitigated(zone, candles) {
  return candles.some(c => c.low <= zone.top && c.high >= zone.bottom);
}

function scoreSignal({ bos, fvg, ob, killzone }) {
  if (bos && fvg && ob && killzone) return 'A+';
  if (bos && fvg && ob) return 'A';
  if (fvg && ob) return 'B+';
  return null;
}

function scoreRelaxedSignal({ bos, fvg, ob, killzone }) {
  if (bos && fvg && ob && killzone) return 'A+';
  if (bos && fvg && ob) return 'A';
  if (fvg && ob) return 'B+';
  if (ob || fvg) return 'B';
  return 'Test'; // Surface even partial logic for visibility
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

app.get('/', (_, res) => {
  res.send('✅ Binance ICT Signal API is running. Use /signals.json');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
