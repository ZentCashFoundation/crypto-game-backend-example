const express = require("express");
const router = express.Router();
const axios = require("axios");
const auth = require("../middleware/auth");
const pool = require("../db");
require("dotenv").config();

router.get("/check", auth, async (req, res) => {
  try {

    const [requests] = await pool.query(
      "SELECT * FROM payment_requests WHERE user_id = ?",
      [req.user.id]
    );

    if (!requests.length)
      return res.json({ message: "No PaymentIDs registered." });

    const request = requests[0];

    const response = await axios.get(
      `${process.env.WALLET_API_URL}/transactions/paymentid/${request.payment_id}`,
      {
        headers: {
          "X-API-KEY": process.env.WALLET_RPC_PASSWORD,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    const transactions = response.data.transactions || [];

    let credited = 0;

    for (const tx of transactions) {

      for (const transfer of tx.transfers) {

        if (transfer.amount <= 0) continue;

        const amountZent = transfer.amount / 100;

        const [exists] = await pool.query(
          "SELECT id FROM processed_payments WHERE tx_hash = ?",
          [tx.hash]
        );

        if (exists.length) continue;

        await pool.query(
          "UPDATE users SET balance = balance + ? WHERE id = ?",
          [amountZent, req.user.id]
        );

        credited += amountZent;

        await pool.query(
          "INSERT INTO processed_payments (user_id, payment_id, amount, tx_hash) VALUES (?, ?, ?, ?)",
          [req.user.id, request.payment_id, amountZent, tx.hash]
        );

        await pool.query(
          "INSERT INTO transaction_history (user_id, type, amount, reference_id) VALUES (?, 'deposit', ?, ?)",
          [req.user.id, amountZent, tx.hash]
        );

      }

    }

    if (credited === 0)
      return res.json({ message: "There are no new payments." });

    res.json({
      message: "Payments credited.",
      amount: credited
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Error verifying payment." });

  }
});

module.exports = router;