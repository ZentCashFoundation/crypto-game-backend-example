const express = require("express");
const router = express.Router();
const axios = require("axios");
const auth = require("../middleware/auth");
const pool = require("../db");
require("dotenv").config();

router.get("/check", auth, async (req, res) => {
  try {
    const [requests] = await pool.query(
      "SELECT * FROM payment_requests WHERE user_id = ? AND status = 'pending'",
      [req.user.id]
    );

    if (!requests.length)
      return res.json({ message: "No hay pagos pendientes" });

    const request = requests[0];

    const response = await axios.get(
      `${process.env.WALLET_API_URL}/transactions/incoming`,
      {
        headers: {
          "X-API-KEY": process.env.WALLET_RPC_PASSWORD,
        },
      }
    );

    const transactions = response.data.transactions || [];

    const tx = transactions.find(
      (t) =>
        t.payment_id === request.payment_id &&
        t.amount / 1e12 >= request.expected_amount
    );

    if (!tx)
      return res.json({ message: "Pago no encontrado aún" });

    const [processed] = await pool.query(
      "SELECT id FROM processed_payments WHERE payment_id = ?",
      [request.payment_id]
    );

    if (processed.length)
      return res.json({ message: "Pago ya procesado" });

    const amountZent = tx.amount / 1e12;

    await pool.query(
      "UPDATE users SET balance = balance + ? WHERE id = ?",
      [amountZent, req.user.id]
    );

    await pool.query(
      "INSERT INTO processed_payments (user_id, payment_id, amount, tx_hash) VALUES (?, ?, ?, ?)",
      [req.user.id, request.payment_id, amountZent, tx.tx_hash]
    );

    await pool.query(
      "UPDATE payment_requests SET status = 'confirmed' WHERE id = ?",
      [request.id]
    );

    await pool.query(
      "INSERT INTO transaction_history (user_id, type, amount, reference_id) VALUES (?, 'deposit', ?, ?)",
      [req.user.id, amountZent, request.payment_id]
    );

    res.json({
      message: "Pago confirmado",
      amount: amountZent,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error verificando pago" });
  }
});

module.exports = router;
