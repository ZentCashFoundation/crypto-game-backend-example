const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");

router.get("/deposit", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM exchange_market_prices ORDER BY updated_at ASC"
    );

    res.json({ result: rows });

  } catch (err) {
    res.status(500).json({ error: "Error fetching tickers" });
  }
});

router.get("/check", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM exchange_market_prices ORDER BY updated_at ASC"
    );

    res.json({ result: rows });

  } catch (err) {
    res.status(500).json({ error: "Error fetching tickers" });
  }
});

router.get("/balance", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM exchange_market_prices ORDER BY updated_at ASC"
    );

    res.json({ result: rows });

  } catch (err) {
    res.status(500).json({ error: "Error fetching tickers" });
  }
});

router.get("/withdraw", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM exchange_market_prices ORDER BY updated_at ASC"
    );

    res.json({ result: rows });

  } catch (err) {
    res.status(500).json({ error: "Error fetching tickers" });
  }
});




module.exports = router;
