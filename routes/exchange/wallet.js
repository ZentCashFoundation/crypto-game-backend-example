const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");
const axios = require("axios");
const crypto = require("crypto");
const { CryptoNote } = require("zentcash-utils");
const coinUtils = new CryptoNote();

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
        payment_id: paymentId,
        integrated_address: coinUtils.createIntegratedAddress(data.address, paymentId),
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
        (user_id, asset_ticker, network, address, payment_id, integrated_address, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          ticker,
          network,
          wallet.address,
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

  if (asset.type === "TURTLENOTE") {
    return {
      address: wallet.address,
      payment_id: wallet.payment_id,
      integrated_address: wallet.integrated_address
    };
  }

  return { address: wallet.address };
}

module.exports = router;
