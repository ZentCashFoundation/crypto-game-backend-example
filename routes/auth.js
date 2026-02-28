const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../db");
require("dotenv").config();

// REGISTER
router.post("/register", async (req, res) => {
  const { email, password, expectedAmount } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Faltan datos" });

  try {
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length)
      return res.status(400).json({ error: "Usuario ya existe" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const randomSalt = crypto.randomBytes(16).toString("hex");
    const timestamp = Date.now().toString();

    const paymentId = crypto
      .createHash("sha256")
      .update(email + timestamp + randomSalt)
      .digest("hex");

    const [userResult] = await pool.query(
      "INSERT INTO users (email, password, payment_id, balance) VALUES (?, ?, ?, 0)",
      [email, hashedPassword, paymentId]
    );

    await pool.query(
      "INSERT INTO payment_requests (user_id, payment_id, expected_amount) VALUES (?, ?, ?)",
      [userResult.insertId, paymentId, expectedAmount || 10]
    );

    res.json({
      message: "Usuario creado",
      paymentId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (!users.length)
      return res.status(400).json({ error: "Usuario no encontrado" });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid)
      return res.status(400).json({ error: "Contraseña incorrecta" });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      balance: user.balance,
      paymentId: user.payment_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

module.exports = router;
