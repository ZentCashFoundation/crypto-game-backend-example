const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");

router.get("/tickers", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM exchange_market_prices ORDER BY updated_at ASC"
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
      "SELECT * FROM exchange_market_prices WHERE pair = ?",
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
      rows.map(r => [Number(r.price), Number(r.total)]);

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

module.exports = router;
