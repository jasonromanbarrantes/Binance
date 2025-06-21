const express = require('express');
const axios = require('axios');
const app = express();

const SYMBOLS = [
  '1000BONKUSDT', 'HBARUSDT', 'BTCUSDT',
  'OPUSDT', 'SOLUSDT', 'SEIUSDT',
  'RNDRUSDT', 'PEPEUSDT'
];

app.get('/prices.json', async (req, res) => {
  try {
    const resp = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price');

    const available = new Set(resp.data.map(item => item.symbol));
    const missing = SYMBOLS.filter(s => !available.has(s));
    if (missing.length > 0) {
      console.warn("⚠️ Missing symbols:", missing);
    }

    const data = resp.data.filter(item => SYMBOLS.includes(item.symbol));
    const prices = {};

    for (const item of data) {
      const symbol = item.symbol === '1000BONKUSDT' ? 'BONKUSDT' : item.symbol;
      prices[symbol] = parseFloat(item.price);
    }

    return res.json(prices);
  } catch (e) {
    console.error("❌ Error fetching Binance prices:", e.response?.data || e.message);
    return res.status(500).json({
      error: "Failed to fetch Binance prices",
      reason: e.response?.data || e.message
    });
  }
});

app.get('/', (_, res) => {
  res.send('✅ Binance Price API is running. Use /prices.json for data.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
