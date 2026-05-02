const express = require("express");
const router = express.Router();
const axios = require("axios");
const auth = require("../../middleware/auth");
const pool = require("../../db");
const chalk = require("chalk");
const { CryptoNote } = require("zentcash-utils");
const coinUtils = new CryptoNote();
require("dotenv").config();

/* Get deposit address */
router.get("/deposit", auth, async (req, res) => {
  try {
    const [deposit] = await pool.query(
      "SELECT payment_id FROM game_wallets WHERE user_id = ?",
      [req.user.id]
    );

    const integratedAddress = coinUtils.createIntegratedAddress(process.env.ADDRESS, deposit[0].payment_id);

    res.json({
      message: "Use the following address and payment ID to make a deposit.",
      address: process.env.ADDRESS,
      paymentId: deposit[0].payment_id,
      integratedAddress: integratedAddress
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Deposit failed" });
  }
});

/* Check for new payments and credit user */
router.get("/check", auth, async (req, res) => {
  try {

    const [users] = await pool.query(
      "SELECT payment_id FROM game_wallets WHERE user_id = ?",
      [req.user.id]
    );

    const paymentId = users[0].payment_id;

    if (!paymentId)
      return res.status(400).json({ error: "Payment ID not configured" });

    const response = await axios.get(
      `${process.env.WALLET_API_URL}/transactions/paymentid/${paymentId}`,
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
          "SELECT id FROM game_processed_payments WHERE tx_hash = ?",
          [tx.hash]
        );

        if (exists.length) continue;

        await pool.query(
          "UPDATE game_wallets SET balance = balance + ? WHERE user_id = ?",
          [amountZent, req.user.id]
        );

        credited += amountZent;

        await pool.query(
          "INSERT INTO game_processed_payments (user_id, payment_id, amount, tx_hash) VALUES (?, ?, ?, ?)",
          [req.user.id, paymentId, amountZent, tx.hash]
        );

        await pool.query(
          "INSERT INTO game_transaction_history (user_id, type, amount, reference_id) VALUES (?, 'deposit', ?, ?)",
          [req.user.id, amountZent, tx.hash]
        );

      }
    }

    if (credited === 0)
      return res.json({ message: "There are no new payments." });

    if (credited > 0)
      console.log(chalk.yellow.bold(`Deposit: ${credited} - User ID: ${req.user.id}`));

    res.json({
      message: "Payments credited.",
      amount: credited
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Error verifying payment." });

  }
});

/* Get user balance */
router.get("/balance", auth, async (req, res) => {
  try {
    const [users] = await pool.query(
      "SELECT balance FROM game_wallets WHERE user_id = ?",
      [req.user.id]
    );

    res.json({
      balance: users[0].balance
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching games" });
  }
});

/* Withdraw funds to external address */
router.post("/withdraw", auth, async (req, res) => {
  const { destination, amount } = req.body;
  const FEE = 150;

  if (!destination || typeof amount !== "number") {
    return res.status(400).json({ error: "Destination and amount required" });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: "Amount must be positive" });
  }

  try {
    
    const [users] = await pool.query(
      "SELECT balance FROM game_wallets WHERE user_id = ?",
      [req.user.id]
    );

    if (!users.length) return res.status(404).json({ error: "User not found" });

    const userBalance = users[0].balance;

    if (amount + FEE > userBalance) {
      console.log(chalk.red.bold("Insufficient balance for amount. User Balance: " + userBalance + " - User ID: " + [req.user.id]))
      return res.status(400).json({ error: "Insufficient balance for amount + fee" });
    }

   
    await pool.query(
      "UPDATE game_wallets SET balance = balance - ? WHERE user_id = ?",
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
      "INSERT INTO game_transaction_history (user_id, type, amount, reference_id) VALUES (?, 'withdraw', ?, ?)",
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
