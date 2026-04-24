const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const pool = require("../db");

router.get("/list", async (req, res) => {
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

    const [games] = await pool.query(
      "SELECT cost FROM games WHERE name = ?",
      [game]
    );

    if (!games.length)
      return res.status(404).json({ error: "Game not found" });

    const cost = games[0].cost;

    const [update] = await pool.query(
      "UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?",
      [cost, req.user.id, cost]
    );

    if (!update.affectedRows)
      return res.status(400).json({ error: "Insufficient balance" });

    const [session] = await pool.query(
      "INSERT INTO game_sessions (user_id, game, cost) VALUES (?, ?, ?)",
      [req.user.id, game ,cost]
    );

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

router.post("/score", auth, async (req, res) => {
  const { sessionId, score } = req.body;
  const userId = req.user.id;

  if (!sessionId || score == null) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {

    const [result] = await pool.query(
      `UPDATE game_sessions
       SET score = ?
       WHERE id = ?
       AND user_id = ?
       AND score = 0`,
      [score, sessionId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: "Invalid session or score already submitted" });
    }

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error saving score" });
  }
});

router.post("/bountyjackpot", async (req, res) => {
  const { game } = req.body;

  if (!game)
    return res.status(400).json({ error: "Game required" });

  try {
    const [bountyjackpot] = await pool.query(
      "SELECT ROUND(COALESCE(SUM(cost), 0) * 0.5, 2) AS bounty FROM game_sessions WHERE game = ?  AND created_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01') AND created_at < DATE_FORMAT(CURRENT_DATE() + INTERVAL 1 MONTH, '%Y-%m-01');",
      [game]
    );

    res.json({
      bountyjackpot
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching games" });
  }
});

router.post("/rankinglist", async (req, res) => {
  const { game, rank } = req.body;

  if (!game)
    return res.status(400).json({ error: "Game required" });

  try {
    const [rankinglist] = await pool.query(
      "SELECT users.username, MAX(game_sessions.score) AS score FROM game_sessions JOIN users ON game_sessions.user_id = users.id WHERE game_sessions.game = ? GROUP BY game_sessions.user_id ORDER BY score DESC LIMIT ?",
      [game, rank ?? 10]
    );

    res.json({
      rankinglist
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching games" });
  }
});

router.post("/gamesessions", auth, async (req, res) => {
  const { game } = req.body;
  const userId = req.user.id;

  try {
    let query = `
      SELECT id, game, cost, score, created_at AS created
      FROM game_sessions 
      WHERE user_id = ?
    `;

    const params = [userId];

    if (game) {
      query += " AND game = ?";
      params.push(game);
    }

    query += " ORDER BY created_at DESC";

    const [game_sessions] = await pool.query(query, params);

    res.json({ game_sessions });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetch games" });
  }
});

router.post("/admin/gamesessions", auth, async (req, res) => {
  try {
    const { game, user_Id } = req.body;
    const userId = req.user.id;

    const [rows] = await pool.query(
      "SELECT role FROM users WHERE id = ?",
      [userId]
    );

    const user = rows[0];

    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    let query = `
      SELECT id, user_id, game, cost, score, created_at AS created
      FROM game_sessions
    `;

    const conditions = [];
    const params = [];

    if (game) {
      conditions.push("game = ?");
      params.push(game);
    }

    if (user_Id) {
      conditions.push("user_id = ?");
      params.push(user_Id);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    
    query += " ORDER BY created_at DESC";

    const [game_sessions] = await pool.query(query, params);

    return res.json({ game_sessions });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching game sessions" });
  }
});

module.exports = router;
