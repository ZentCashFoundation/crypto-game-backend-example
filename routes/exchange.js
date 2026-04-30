const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const pool = require("../db");

router.get("/market/tickers", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM exchange_market_prices ORDER BY updated_at ASC"
    );

    res.json({ result: rows });

  } catch (err) {
    res.status(500).json({ error: "Error fetching tickers" });
  }
});

router.get("/market/ticker", async (req, res) => {
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

module.exports = router;
