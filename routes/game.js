const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const pool = require("../db");

router.get("/list", auth, async (req, res) => {
  try {
    const [games] = await pool.query(
      "SELECT name, cost FROM games ORDER BY name"
    );

    res.json({
      games
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching games" });
  }
});

router.post("/play", auth, async (req, res) => {
  const { game } = req.body;

  if (!game)
    return res.status(400).json({ error: "Game required" });

  try {

    // 1️⃣ obtener coste del juego
    const [games] = await pool.query(
      "SELECT cost FROM games WHERE name = ?",
      [game]
    );

    if (!games.length)
      return res.status(404).json({ error: "Game not found" });

    const cost = games[0].cost;

    // 2️⃣ descontar balance
    const [update] = await pool.query(
      "UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?",
      [cost, req.user.id, cost]
    );

    if (!update.affectedRows)
      return res.status(400).json({ error: "Insufficient balance" });

    // 3️⃣ crear sesión (sin cambiar estructura)
    const [session] = await pool.query(
      "INSERT INTO game_sessions (user_id, cost) VALUES (?, ?)",
      [req.user.id, cost]
    );

    // 4️⃣ historial
    await pool.query(
      "INSERT INTO transaction_history (user_id, type, amount, reference_id) VALUES (?, 'play', ?, ?)",
      [req.user.id, cost, session.insertId]
    );

    res.json({
      message: "Game started",
      sessionId: session.insertId,
      cost: cost
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting game" });
  }
});

module.exports = router;
