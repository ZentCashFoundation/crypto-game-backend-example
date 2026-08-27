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

/** 
 * Feature:
 * - Validate email format and check for MX records before registration
 */

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

/** 
 * Feature:
 * - User registration with email and password
 */

router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!(await validateEmail(email))) {
    return res.status(400).json({ error: "Invalid email" });
  }

  if (!email || !password)
    return res.status(400).json({ error: "Data is missing" });

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      "SELECT id, active FROM users WHERE email = ?",
      [email]
    );

    if (existing.length && existing[0].active === 0) {
      await connection.rollback();
      return res.status(400).json({
        error: "Account closed by the client. Contact support."
      });
    }

    if (existing.length) {
      await connection.rollback();
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const randomSalt = crypto.randomBytes(16).toString("hex");

    const username = `Anonymous-${Date.now()}`;

    const [userResult] = await connection.query(
      "INSERT INTO users (email, username, password, role, active) VALUES (?, ?, ?, 'user', 1)",
      [email, username, hashedPassword]
    );

    const userId = userResult.insertId;

    const paymentId = crypto
      .createHash("sha256")
      .update(email + Date.now().toString() + randomSalt)
      .digest("hex");

    await connection.query(
      "INSERT INTO game_wallets (user_id, balance, payment_id) VALUES (?, 0, ?)",
      [userId, paymentId]
    );

    await connection.commit();

    res.json({ message: "User created" });

    console.log(chalk.blue.bold("User created. Email: " + email));

  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  } finally {
    connection.release();
  }
});

/** 
 * Feature:
 * - User login with email and password
 */

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const ip = req.ip;
  const userAgent = req.get("User-Agent") || null;

  try {
    const [users] = await pool.query(
      "SELECT id, email, username, password, active FROM users WHERE email = ?",
      [email]
    );

    if (!users.length) {
      await pool.query(
        `INSERT INTO login_attempts
          (user_id, identifier, success, failure_reason, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [null, email, false, "user_not_found", ip, userAgent]
      );

      return res.status(400).json({ error: "Invalid credentials" });
    }

    const user = users[0];

    if (user.active === 0) {
      await pool.query(
        `INSERT INTO login_attempts
          (user_id, identifier, success, failure_reason, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.id, email, false, "account_inactive", ip, userAgent]
      );

      return res.status(403).json({ error: "Account disabled" });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      await pool.query(
        `INSERT INTO login_attempts
          (user_id, identifier, success, failure_reason, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.id, email, false, "invalid_credentials", ip, userAgent]
      );

      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Login correcto
    await pool.query(
      `INSERT INTO login_attempts
        (user_id, identifier, success, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, email, true, ip, userAgent]
    );

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    console.log(
      chalk.blue.bold("Login User. Email: " + email)
    );

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      token
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

/** 
 * Feature:
 * - Change username
 */

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

/** 
 * Feature:
 * - Change user email
 */

router.post("/changeemail", auth, async (req, res) => {
  const { email } = req.body;
  const userId = req.user.id;

  if (!email || !await validateEmail(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {

    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: "Email already taken" });
    }

    await pool.query(
      "UPDATE users SET email = ? WHERE id = ?",
      [email, userId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating email" });
  }
});

/** 
 * Feature:
 * - Delete user account
 */

router.post("/deleteaccount", auth, async (req, res) => {
  const userId = req.user.id;

  try {

    const [existing] = await pool.query(
      "SELECT id FROM users WHERE id = ?",
      [userId]
    );

    if (existing.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    await pool.query(
      "UPDATE users SET active = 0, deleted_at = NOW() WHERE id = ?",
      [userId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating user status" });
  }
});

module.exports = router;