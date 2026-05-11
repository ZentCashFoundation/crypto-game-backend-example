const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");

router.get("/", auth, async (req, res) => {
  const { pair, limit = 50 } = req.query;
  const userId = req.user.id;

  if (!pair) {
    return res.status(400).json({
      error: "Pair required"
    });
  }

  try {

    const [trades] = await pool.query(
      `SELECT id, pair, price, amount, CASE WHEN buyer_user_id = ? THEN 'buy' ELSE 'sell' END AS side, created_at FROM exchange_trades WHERE (buyer_user_id = ? OR seller_user_id = ?) AND pair = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, userId, userId, pair, Number(limit)]
    );

    return res.json({
      pair,
      result: trades
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Error fetching trades"
    });
  }
});

module.exports = router;
