const express = require("express");
const router = express.Router();
const axios = require("axios");
const auth = require("../middleware/auth");
const pool = require("../db");
const chalk = require("chalk");
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

    if (credited > 0)
      console.log(chalk.orange.bold("Deposit: " + credited + " - User ID: " + [req.user.id]))

    res.json({
      message: "Payments credited.",
      amount: credited
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Error verifying payment." });

  }
});

const FEE = 150;

// POST /api/payment/withdraw
router.post("/withdraw", auth, async (req, res) => {
  const { destination, amount } = req.body;

  if (!destination || typeof amount !== "number") {
    return res.status(400).json({ error: "Destination and amount required" });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: "Amount must be positive" });
  }

  try {
    
    const [users] = await pool.query(
      "SELECT balance FROM users WHERE id = ?",
      [req.user.id]
    );

    if (!users.length) return res.status(404).json({ error: "User not found" });

    const userBalance = users[0].balance;

    if (amount + FEE > userBalance) {
      console.log(chalk.red.bold("Insufficient balance for amount. User Balance: " + userBalance + " - User ID: " + [req.user.id]))
      return res.status(400).json({ error: "Insufficient balance for amount + fee" });
    }

   
    await pool.query(
      "UPDATE users SET balance = balance - ? WHERE id = ?",
      [amount + FEE, req.user.id]
    );

    const amountAtomic = Math.floor(amount * 100);

    const response = await axios.post(
      `${process.env.WALLET_API_URL}/transactions/send/basic`,
      {
        destination,
        amount: amountAtomic
      },
      {
        headers: {
          "X-API-KEY": process.env.WALLET_RPC_PASSWORD,
          "Content-Type": "application/json",
        },
      }
    );

    await pool.query(
      "INSERT INTO transaction_history (user_id, type, amount, reference_id) VALUES (?, 'withdraw', ?, ?)",
      [req.user.id, amount, response.data.transactionHash]
    );

    console.log(chalk.red.bold("Withdrawal: " + amount + " - User ID: " + [req.user.id]))

    res.json({
      message: "Withdrawal sent",
      amount: amount,
      fee: FEE,
      balance: userBalance - amount - FEE,
      txHash: response.data.transactionHash || null
    });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Withdrawal failed" });
  }
});

module.exports = router;
