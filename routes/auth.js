const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../db");
const dns = require("dns").promises;
const chalk = require("chalk");
const auth = require("../middleware/auth");
require("dotenv").config();

async function validateEmail(email) {

  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!regex.test(email))
    return false;

  const domain = email.split("@")[1];

  try {
    const mx = await dns.resolveMx(domain);
    return mx.length > 0;
  } catch {
    return false;
  }
}

router.post("/register", async (req, res) => {
  const { email, password} = req.body;

  if (!(await validateEmail(email))) {
    return res.status(400).json({ error: "Invalid email" });
  }

  if (!email || !password)
    return res.status(400).json({ error: "Data is missing" });

  try {
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length)
      return res.status(400).json({ error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const randomSalt = crypto.randomBytes(16).toString("hex");
    const timestamp = Date.now().toString();

    const paymentId = crypto
      .createHash("sha256")
      .update(email + timestamp + randomSalt)
      .digest("hex");

    const [userResult] = await pool.query(
      "INSERT INTO users (email, username, password, payment_id, balance) VALUES (?, 'Anonymous', ?, ?, 0)",
      [email, hashedPassword, paymentId]
    );

    res.json({
      message: "User created",
      address: process.env.ADDRESS,
      paymentId,
    });
    console.log(chalk.blue.bold("User created. Email: " + email))
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (!users.length)
      return res.status(400).json({ error: "User not found" });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid)
      return res.status(400).json({ error: "Incorrect password" });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    console.log(chalk.blue.bold("Login User. Email: " + email))

    res.json({
      token,
      balance: user.balance,
      address: process.env.ADDRESS,
      paymentId: user.payment_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/changenick", auth, async (req, res) => {
  const { username } = req.body;
  const userId = req.user.id;

  if (!username || username.length < 3) {
    return res.status(400).json({ error: "Invalid username" });
  }

  try {

    const [existing] = await pool.query(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: "Username already taken" });
    }

    await pool.query(
      "UPDATE users SET username = ? WHERE id = ?",
      [username, userId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating username" });
  }
});

module.exports = router;
