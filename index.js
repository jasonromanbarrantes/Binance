const express = require('express');
const axios = require('axios');
const app = express();

const SYMBOLS = [
  'BONKUSDT', 'HBARUSDT', 'BTCUSDT',
  'OPUSDT', 'SOLUSDT', 'SEIUSDT',
  'RNDRUSDT', 'PEPEUSDT'
];

app.get('/prices.json', async (req, res) => {
  try {
    const resp = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price');
    const data = resp.data.filter(item => SYMBOLS.includes(item.symbol));
    const prices = {};
    for (const item of data) {
      prices[item.symbol] = parseFloat(item.price);
    }
    res.json(prices);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'Failed to fetch Binance prices' });
  }
});

app.get('/', (_, res) => {
  res.send('Binance Price API is running. Go to /prices.json');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
