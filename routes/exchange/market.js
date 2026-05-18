const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");

router.get("/tickers", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, pair, last_price, bid_price, ask_price, spread, updated_at FROM exchange_markets ORDER BY updated_at ASC"
    );

    res.json({ result: rows });

  } catch (err) {
    res.status(500).json({ error: "Error fetching tickers" });
  }
});

router.get("/ticker", async (req, res) => {
  const { pair } = req.query;

  if (!pair) {
    return res.status(400).json({ error: "Pair required" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, pair, last_price, bid_price, ask_price, spread, updated_at FROM exchange_markets WHERE pair = ?",
      [pair]
    );

    res.json({ result: rows[0] || null });

  } catch (err) {
    res.status(500).json({ error: "Error fetching ticker" });
  }
});

router.get("/orderbook", async (req, res) => {
  const { pair, limit = 50 } = req.query;

  if (!pair) {
    return res.status(400).json({ error: "Pair required" });
  }

  const [market] = await pool.query(
    `
    SELECT *
    FROM exchange_markets
    WHERE pair = ?
      AND is_active = 1
    LIMIT 1
    `,
    [pair]
  );

  if (!market.length) {
    return res.status(400).json({
      error: "Inactive market"
    });
  }

  const safeLimit = Math.min(Number(limit) || 50, 100);

  try {

    const [bids] = await pool.query(
      `
      SELECT price, SUM(amount - filled) AS total
      FROM exchange_orders
      WHERE pair = ?
        AND side = 'buy'
        AND status IN ('open','partial')
        AND (amount - filled) > 0
      GROUP BY price
      ORDER BY price DESC
      LIMIT ?
      `,
      [pair, safeLimit]
    );

    const [asks] = await pool.query(
      `
      SELECT price, SUM(amount - filled) AS total
      FROM exchange_orders
      WHERE pair = ?
        AND side = 'sell'
        AND status IN ('open','partial')
        AND (amount - filled) > 0
      GROUP BY price
      ORDER BY price ASC
      LIMIT ?
      `,
      [pair, safeLimit]
    );

    const format = (rows) =>
      rows.map(r => [String(r.price), String(r.total)]);

    return res.json({
      pair,
      bids: format(bids),
      asks: format(asks)
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching orderbook" });
  }
});

router.get("/trades", async (req, res) => {
  const { pair, limit = 50} = req.query;

  if (!pair) {
    return res.status(400).json({ error: "Pair required" });
  }

  try {
    const [trades] = await pool.query(
      "SELECT id, pair, price, amount, created_at FROM exchange_trades WHERE pair = ? ORDER BY created_at DESC LIMIT ?",
      [pair, Number(limit)]
    );

    res.json({ 
      pair,
      result: trades
    });

  } catch (err) {
    res.status(500).json({ error: "Error fetching pair" });
  }
});

router.get("/candles", async (req, res) => {

  try {

    const {pair, timeframe = "1m", limit = 200} = req.query;

    if (!pair) {
      return res.status(400).json({
        error: "Pair required"
      });
    }

    const allowed = [
      "1m",
      "5m",
      "15m",
      "1h",
      "4h",
      "1d"
    ];

    if (!allowed.includes(timeframe)) {
      return res.status(400).json({
        error: "Invalid timeframe"
      });
    }

    const [candles] = await pool.query(`
      SELECT
        open_time,
        open_price,
        high_price,
        low_price,
        close_price,
        volume
      FROM exchange_candles
      WHERE pair = ?
        AND timeframe = ?
      ORDER BY open_time DESC
      LIMIT ?
    `, [
      pair,
      timeframe,
      Number(limit)
    ]);

    return res.json(
      candles.reverse()
    );

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Internal server error"
    });
  }
});


module.exports = router;