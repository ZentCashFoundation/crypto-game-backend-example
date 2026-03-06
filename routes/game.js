const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const pool = require("../db");

router.post("/play", auth, async (req, res) => {
  const cost = 10;

  try {
    const [update] = await pool.query(
      "UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?",
      [cost, req.user.id, cost]
    );

    if (!update.affectedRows)
      return res.status(400).json({ error: "Insufficient balance" });

    const [session] = await pool.query(
      "INSERT INTO game_sessions (user_id, cost) VALUES (?, ?)",
      [req.user.id, cost]
    );

    await pool.query(
      "INSERT INTO transaction_history (user_id, type, amount, reference_id) VALUES (?, 'play', ?, ?)",
      [req.user.id, cost, session.insertId]
    );

    res.json({
      message: "Game started",
      sessionId: session.insertId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting game" });
  }
});

module.exports = router;
