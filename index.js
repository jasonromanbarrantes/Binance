// Full code for index.js with bullish + bearish signal support
// This version updates both /signals.json and /signals-relaxed.json
// Includes "direction": "Long" or "Short" in each signal

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

// === /signals.json (Strict Sniper) ===
app.get('/signals.json', async (req, res) => {
  const signals = {};
  const now = new Date();

  for (const symbol of SYMBOLS) {
    for (const direction of ['bullish', 'bearish']) {
      try {
        const candles = await getCandles(symbol);
        const bos = detectBOS(candles, direction, 30);
        const fvgs = detectFVG(candles, 50);
        const ob = detectOrderBlock(candles, direction, 50);
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
            direction: direction === 'bullish' ? 'Long' : 'Short',
            reason: [bos ? 'BOS' : null, unmitigatedFVG ? 'FVG' : null, unmitigatedOB ? 'OB' : null, isKillzone ? 'Killzone' : null].filter(Boolean).join(' + '),
            entry: unmitigatedOB ? [unmitigatedOB.bottom, unmitigatedOB.top] : [price * 0.996, price],
            sl: price - atr,
            tp1: price + atr * 1.5,
            tp2: price + atr * 3.0,
            session: getSessionName(now)
          };

          signals[`${cleanSymbol}_${signal.direction}`] = signal;

          if (grade === 'A+' || grade === 'A') {
            await sendTelegramAlert(`${cleanSymbol} (${signal.direction})`, signal);
          }
        }
      } catch (e) {
        console.error(`❌ Error for ${symbol} ${direction}:`, e.message);
      }
    }
  }

  res.json(signals);
});

// === /signals-relaxed.json ===
app.get('/signals-relaxed.json', async (req, res) => {
  const timeframes = ['15m', '5m'];
  const results = {};

  for (const symbol of SYMBOLS) {
    const resultPerSymbol = {};

    for (const tf of timeframes) {
      for (const direction of ['bullish', 'bearish']) {
        try {
          const candles = await getCandles(symbol, tf);
          const bos = detectBOS(candles, direction, 30);
          const fvgs = detectFVG(candles, 50);
          const ob = detectOrderBlock(candles, direction, 50);
          const unmitigatedFVG = fvgs.find(fvg => !isMitigated(fvg, candles));
          const unmitigatedOB = ob && !isMitigated(ob, candles) ? ob : null;
          const isKillzone = checkKillzone(new Date());
          const grade = scoreRelaxedSignal({ bos, fvg: !!unmitigatedFVG, ob: !!unmitigatedOB, killzone: isKillzone });

          if (grade) {
            resultPerSymbol[`${tf}_${direction}`] = {
              grade,
              direction: direction === 'bullish' ? 'Long' : 'Short',
              reason: [bos ? 'BOS' : null, unmitigatedFVG ? 'FVG' : null, unmitigatedOB ? 'OB' : null, isKillzone ? 'Killzone' : null].filter(Boolean).join(' + '),
              session: getSessionName(new Date()),
              price: candles.at(-1).close
            };
          }
        } catch (e) {
          console.error(`❌ Error for ${symbol} ${tf} ${direction}:`, e.message);
        }
      }
    }

    if (Object.keys(resultPerSymbol).length > 0) {
      const clean = symbol.replace(/^1000/, '');
      results[clean] = resultPerSymbol;
    }
  }

  res.json(results);
});

// Add all existing helpers below (sendTelegramAlert, getCandles, detectBOS, etc.)
// Make sure they're identical to your working version, no edits needed except where noted

// Update scoreRelaxedSignal to remove "Test":
function scoreRelaxedSignal({ bos, fvg, ob, killzone }) {
  if (bos && fvg && ob && killzone) return 'A+';
  if (bos && fvg && ob) return 'A';
  if (fvg && ob) return 'B+';
  if (ob || fvg) return 'B';
  return null;
}
