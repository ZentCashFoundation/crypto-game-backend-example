const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");
const axios = require("axios");
const crypto = require("crypto");
const { CryptoNote } = require("zentcash-utils");
const coinUtils = new CryptoNote();
const balanceService = require("../../services/balanceService")(pool);

router.post("/deposit", auth, async (req, res) => {
  const { ticker, network = "mainnet" } = req.body;
  const userId = req.user.id;

  if (!ticker)
    return res.status(400).json({ error: "Ticker Required" });

  const lockKey = `deposit:${userId}:${ticker}:${network}`;

  if (global[lockKey]) {
    return res.status(429).json({ error: "Wallet generation in progress" });
  }

  global[lockKey] = true;

  try {
    /* 1. Asset */
    const [assetRows] = await pool.query(
      "SELECT * FROM exchange_assets WHERE ticker = ?",
      [ticker]
    );

    if (assetRows.length === 0) {
      return res.status(400).json({ error: "Unsupported asset" });
    }

    const asset = assetRows[0];

    /* 2. Wallet existente */
    const [deposit] = await pool.query(
      "SELECT * FROM exchange_wallets WHERE asset_ticker = ? AND network = ? AND user_id = ?",
      [ticker, network, userId]
    );

    if (deposit.length > 0) {
      return res.json(formatWallet(asset, deposit[0]));
    }

    /* 3. Generación */
    let wallet;

    if (asset.type === "UTXO") {

      let rpcUrl = asset.rpc_url;

      if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
        rpcUrl = "http://" + rpcUrl;
      }

      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Basic " + Buffer.from(
            process.env.RPC_USER + ":" + process.env.RPC_PASS
          ).toString("base64")
        },
        body: JSON.stringify({
          jsonrpc: "1.0",
          id: "utxo-deposit",
          method: "getnewaddress",
          params: [`user_${userId}`]
        }),
        signal: AbortSignal.timeout(500) 
      });

      const data = await response.json();

      if (!response.ok || !data.result) {
        return res.status(500).json({ error: "RPC error generating address" });
      }

      wallet = {
        address: data.result,
        account: null,
        payment_id: null,
        integrated_address: null,
        memo: null
      };
    }

    if (asset.type === "CRYPTONOTE") {

      let rpcUrl = asset.rpc_url;

      if (
        !rpcUrl.startsWith("http://") &&
        !rpcUrl.startsWith("https://")
      ) {
        rpcUrl = "http://" + rpcUrl;
      }

      const response = await fetch(
        rpcUrl + "/json_rpc",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "cryptonote-create-account",
            method: "create_account",
            params: {
              label: `user_${userId}`
            }
          }),
        }
      );

      const data = await response.json();

      if (
        !response.ok ||
        data.error ||
        !data.result ||
        !data.result.address
      ) {
        return res.status(500).json({
          error:
            data.error?.message ||
            "RPC error generating address"
        });
      }

      wallet = {
        address: data.result.address,
        account: data.result.account_index,
        payment_id: null,
        integrated_address: null,
        memo: null
      };
    }

    if (asset.type === "TURTLENOTE") {

      const randomSalt = crypto.randomBytes(16).toString("hex");
      const paymentId = crypto
        .createHash("sha256")
        .update(Date.now().toString() + randomSalt)
        .digest("hex");

      let rpcUrl = asset.rpc_url;

      if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
        rpcUrl = "http://" + rpcUrl;
      }

      const response = await fetch(rpcUrl + "/addresses/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.WALLET_RPC_PASSWORD
        },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (!response.ok || !data.address) {
        return res.status(500).json({ error: "RPC error generating address" });
      }

      wallet = {
        address: data.address,
        account: null,
        payment_id: paymentId,
        integrated_address: coinUtils.createIntegratedAddress(data.address, paymentId),
        memo: null
      };
    }

    if (asset.type === "ZANONOTE") {

      const paymentId = textAHex(
          `${userId} - ${ticker}`
      );

      console.log(paymentId);

      let rpcUrl = asset.rpc_url;

      if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
          rpcUrl = "http://" + rpcUrl;
      }

      const response_part_one = await fetch(
          rpcUrl + "/json_rpc",
          {
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
              },
              body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 0,
                  method: "getaddress",
                  params: {}
              }),
              signal: AbortSignal.timeout(5000)
          }
      );

      const data_one = await response_part_one.json();

      if (
          !response_part_one.ok ||
          !data_one.result ||
          !data_one.result.address
      ) {
          return res.status(500).json({
              error: "RPC error generating address"
          });
      }

      const response_part_two = await fetch(
          rpcUrl + "/json_rpc",
          {
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
              },
              body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 0,
                  method: "make_integrated_address",
                  params: {
                    payment_id: paymentId
                  }
              }),
              signal: AbortSignal.timeout(5000)
          }
      );

      const data_two = await response_part_two.json();
      console.log(JSON.stringify(data_two, null, 2));
      if (
        !response_part_two.ok ||
        !data_two.result ||
        !data_two.result.integrated_address
      ) {
          return res.status(500).json({
              error: "RPC error generating integrated address"
          });
      }

      wallet = {
          address: data_one.result.address,
          account: null,
          payment_id: paymentId,
          integrated_address: data_two.result.integrated_address,
          memo: null
      };
    }    

    if (!wallet) {
      return res.status(500).json({ error: "Wallet generation failed" });
    }

    /* 4. Guardar en DB */
    try {
      await pool.query(
        `INSERT INTO exchange_wallets 
        (user_id, asset_ticker, network, address, account, payment_id, integrated_address, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          ticker,
          network,
          wallet.address,
          wallet.account,
          wallet.payment_id,
          wallet.integrated_address,
          wallet.memo
        ]
      );
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        const [rows] = await pool.query(
          `SELECT * FROM exchange_wallets
           WHERE user_id=? AND asset_ticker=? AND network=?`,
          [userId, ticker, network]
        );

        return res.json(formatWallet(asset, rows[0]));
      }

      throw err;
    }

    return res.json(formatWallet(asset, wallet));

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });

  } finally {
    delete global[lockKey];
  }
});

/* helper */
function formatWallet(asset, wallet) {
  if (asset.type === "UTXO") {
    return { address: wallet.address };
  }

  if (asset.type === "CRYPTONOTE") {
    return {
      address: wallet.address,
      payment_id: wallet.payment_id
    };
  }  

  if (asset.type === "TURTLENOTE") {
    return {
      address: wallet.address,
      payment_id: wallet.payment_id,
      integrated_address: wallet.integrated_address
    };
  }

    if (asset.type === "ZANONOTE") {
    return {
      address: wallet.address,
      payment_id: wallet.payment_id,
      integrated_address: wallet.integrated_address
    };
  }

  return { address: wallet.address };
}

/* Convierte texto a hexadecimal */
function textAHex(text) {
    return Array.from(new TextEncoder().encode(text))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

router.post("/deposit/history", auth, async (req, res) => {
  const userId = req.user.id;
  const { ticker, limit = 50 } = req.body;
    try {
    const [rows] = await pool.query(`
      SELECT * FROM exchange_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, 
      [userId, Number(limit)]
    );

    return res.json({ history: rows });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching history with deposits" });
  }
});

router.post("/deposit/mock", auth, async (req, res) => {
  const conn = await pool.getConnection();
  const userId = req.user.id;
  const { asset, amount } = req.body;

  const [userCheck] = await pool.query(
    "SELECT role FROM users WHERE id = ?",
    [userId]
  );
    
  const user = userCheck[0];
    
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    await conn.beginTransaction();

    await balanceService.addBalance(conn, userId, asset, Number(amount));

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });

  } finally {
    conn.release();
  }
});

router.get("/balances", auth, async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await pool.query(`
      SELECT 
        asset_ticker AS asset,
        available,
        locked,
        (available + locked) AS total
      FROM exchange_balances
      WHERE user_id = ?
      ORDER BY asset_ticker ASC
    `, [userId]);

    const balances = rows.map(b => ({
      asset: b.asset,
      available: String(b.available),
      locked: String(b.locked),
      total: String(b.total)
    }));

    return res.json({ balances });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching balances" });
  }
});

router.get("/balance", auth, async (req, res) => {
  const userId = req.user.id;
  const { asset } = req.query;

  if (!asset) {
    return res.status(400).json({ error: "Asset required" });
  }

  try {

    await pool.query(`
      INSERT IGNORE INTO exchange_balances (user_id, asset_ticker)
      VALUES (?, ?)
    `, [userId, asset]);

    const [rows] = await pool.query(`
      SELECT 
        asset_ticker AS asset,
        available,
        locked,
        (available + locked) AS total
      FROM exchange_balances
      WHERE user_id = ? AND asset_ticker = ?
    `, [userId, asset]);

    const b = rows[0];

    return res.json({
      asset: b.asset,
      available: String(b.available),
      locked: String(b.locked),
      total: String(b.total)
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching balance" });
  }
});

router.post("/withdraw", auth, async (req, res) => {

  const {
    ticker,
    amount,
    address,
    payment_id = null,
    integrated_address = null,
    memo = null,
    tag = null,
    network = "mainnet"
  } = req.body;

  const userId = req.user.id;

  // -----------------------------------------
  // VALIDATION
  // -----------------------------------------
  if (!ticker || !amount || !address) {
    return res.status(400).json({
      error: "ticker, amount and address are required"
    });
  }

  const parsedAmount = Number(amount);

  if (
    Number.isNaN(parsedAmount) ||
    parsedAmount <= 0
  ) {
    return res.status(400).json({
      error: "Invalid amount"
    });
  }

  const conn = await pool.getConnection();

  try {

    await conn.beginTransaction();

    // -----------------------------------------
    // LOAD ASSET
    // -----------------------------------------
    const [assets] = await conn.query(
      `
      SELECT *
      FROM exchange_assets
      WHERE ticker = ?
      LIMIT 1
      `,
      [ticker]
    );

    if (!assets.length) {

      await conn.rollback();

      return res.status(400).json({
        error: "Unsupported asset"
      });
    }

    const asset = assets[0];

    // -----------------------------------------
    // WITHDRAW ENABLED
    // -----------------------------------------
    if (!asset.withdraw_enabled) {

      await conn.rollback();

      return res.status(400).json({
        error: "Withdrawals disabled"
      });
    }

    // -----------------------------------------
    // MAINTENANCE MODE
    // -----------------------------------------
    if (asset.maintenance_mode) {

      await conn.rollback();

      return res.status(400).json({
        error: "Asset in maintenance mode"
      });
    }

    // -----------------------------------------
    // MIN WITHDRAW
    // -----------------------------------------
    const minWithdraw =
      Number(asset.min_withdraw || 0);

    if (parsedAmount < minWithdraw) {

      await conn.rollback();

      return res.status(400).json({
        error: `Minimum withdraw is ${minWithdraw}`
      });
    }

    // -----------------------------------------
    // WITHDRAW FEE
    // -----------------------------------------
    const withdrawFee =
      Number(asset.withdraw_fee || 0);

    // total locked from balance
    const totalDebit =
      parsedAmount + withdrawFee;

    // -----------------------------------------
    // LOAD USER BALANCE
    // -----------------------------------------
    const [balances] = await conn.query(
      `
      SELECT *
      FROM exchange_balances
      WHERE user_id = ?
        AND asset_ticker = ?
      LIMIT 1
      FOR UPDATE
      `,
      [
        userId,
        ticker
      ]
    );

    if (!balances.length) {

      await conn.rollback();

      return res.status(400).json({
        error: "Balance not found"
      });
    }

    const balance = balances[0];

    // -----------------------------------------
    // CHECK AVAILABLE BALANCE
    // -----------------------------------------
    if (
      Number(balance.available) <
      totalDebit
    ) {

      await conn.rollback();

      return res.status(400).json({
        error: "Insufficient balance"
      });
    }

    // -----------------------------------------
    // LOCK BALANCE
    // -----------------------------------------
    await conn.query(
      `
      UPDATE exchange_balances
      SET
        available = available - ?,
        locked = locked + ?
      WHERE user_id = ?
        AND asset_ticker = ?
      `,
      [
        totalDebit,
        totalDebit,
        userId,
        ticker
      ]
    );

    // -----------------------------------------
    // CREATE WITHDRAWAL
    // -----------------------------------------
    const [withdrawalResult] = await conn.query(
      `
      INSERT INTO exchange_withdrawals
      (
        user_id,
        asset_ticker,
        network,
        address,
        payment_id,
        integrated_address,
        memo,
        tag,
        amount,
        fee,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        ticker,
        network,
        address,
        payment_id,
        integrated_address,
        memo,
        tag,
        parsedAmount,
        withdrawFee,
        "pending"
      ]
    );

    // -----------------------------------------
    // CREATE TRANSACTION LOG
    // -----------------------------------------
    await balanceService.createTransaction(
      conn,
      userId,
      ticker,
      "lock",
      totalDebit,
      withdrawalResult.insertId,
      `Withdrawal locked (${parsedAmount} + ${withdrawFee} fee)`
    );

    await conn.commit();

    return res.json({
      success: true,
      withdrawal_id: withdrawalResult.insertId,
      amount: parsedAmount,
      fee: withdrawFee,
      total_locked: totalDebit,
      status: "pending"
    });

  } catch (err) {

    await conn.rollback();

    console.error(err);

    return res.status(500).json({
      error: "Internal error"
    });

  } finally {

    conn.release();
  }
});

router.post("/withdraw/history", auth, async (req, res) => {
  const userId = req.user.id;
  const { ticker, limit = 50 } = req.body;
    try {
    const [rows] = await pool.query(`
      SELECT * FROM exchange_withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, 
      [userId, Number(limit)]
    );

    return res.json({ history: rows });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching history with withdrawals" });
  }
});

router.get("/transactions", auth, async (req, res) => {

  const userId = req.user.id;
  const { asset, type, limit = 50 } = req.query;

  try {

    let query = `
      SELECT
        id,
        asset_ticker,
        type,
        amount,
        reference_id,
        description,
        created_at
      FROM exchange_transactions
      WHERE user_id = ?
    `;

    const params = [userId];

    if (asset) {
      query += " AND asset_ticker = ?";
      params.push(asset);
    }

    if (type) {
      query += " AND type = ?";
      params.push(type);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(Number(limit));

    const [rows] = await pool.query(query, params);

    return res.json({
      result: rows
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Error fetching transactions"
    });
  }
});

module.exports = router;
