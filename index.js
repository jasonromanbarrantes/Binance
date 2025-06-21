const express = require('express');
const axios = require('axios');
const app = express();

const SYMBOLS = ['1000BONKUSDT'];

// === MAIN ROUTE: /signals.json ===
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
      const grade = scoreSignal({
        bos,
        fvg: !!unmitigatedFVG,
        ob: !!unmitigatedOB,
        killzone: isKillzone
      });

      if (grade) {
        const price = candles.at(-1).close;
        const atr = price * 0.008;

        signals['BONKUSDT'] = {
          price,
          grade,
          reason: [bos ? 'BOS' : null, unmitigatedFVG ? 'FVG' : null, unmitigatedOB ? 'OB' : null, isKillzone ? 'Killzone' : null].filter(Boolean).join(' + '),
          entry: unmitigatedOB ? [unmitigatedOB.bottom, unmitigatedOB.top] : [price * 0.996, price],
          sl: price - atr,
          tp1: price + atr * 1.5,
          tp2: price + atr * 3.0,
          session: getSessionName(now)
        };
      }
    } catch (e) {
      console.error(`❌ Error for ${symbol}:`, e.message);
    }
  }

  res.json(signals);
});

// === HELPERS ===

async function getCandles(symbol) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=100`;
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

function detectOrderBlock(candles, lookback = 50) {
  for (let i = lookback - 3; i >= 0; i--) {
    const c = candles[i], n1 = candles[i + 1], n2 = candles[i + 2];
    const isBearishOB = c.close < c.open && n1.close > n1.open && n2.close > n2.open;
    if (isBearishOB) {
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

function checkKillzone(date) {
  const utc = date.getUTCHours();
  return (utc >= 7 && utc <= 10) || (utc >= 12 && utc <= 16); // London or NY Killzone
}

function getSessionName(date) {
  const utc = date.getUTCHours();
  if (utc >= 7 && utc < 10) return 'London';
  if (utc >= 12 && utc < 16) return 'NY Killzone';
  return 'Outside session';
}

// === HOME ROUTE ===
app.get('/', (_, res) => {
  res.send('✅ Binance ICT Signal API is running. Go to /signals.json');
});

// === SERVER START ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
