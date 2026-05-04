const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");
const axios = require("axios");
const crypto = require("crypto");
const { CryptoNote } = require("zentcash-utils");
const coinUtils = new CryptoNote();

router.post("/deposit", auth, async (req, res) => {
  const { ticker, network = 'mainnet'} = req.body;
  const userId = req.user.id;

  if (!ticker)
    return res.status(400).json({ error: "Ticker Required" });

  try {
    /* Buscamos si el activo esta listado*/
    const [assetRows] = await pool.query(
      "SELECT * FROM exchange_assets WHERE ticker = ?",
      [ticker]
    );

    if (assetRows.length === 0) {
      return res.status(400).json({ error: "Unsupported asset" });
    }

    const asset = assetRows[0];

    /* Buscamos wallet existente */
    const [deposit] = await pool.query(
      "SELECT * FROM exchange_wallets WHERE asset_ticker = ? AND network = ? AND user_id = ?",
      [ticker, network, userId]
    );

    /* SI YA EXISTE → devolver */
    if (deposit.length > 0) {
      if (asset.type === "UTXO") {
        return res.json({ 
          address: deposit[0].address 
        });
      } else if (asset.type === "TURTLENOTE") {
        return res.json({ 
          address: deposit[0].address,
          payment_id: deposit[0].payment_id,
          integrated_address: deposit[0].integrated_address

        });
      } else {
        return res.status(400).json({error: "Unsupported Type"}) 
      }  
    }

    /* SI NO EXISTE → generar */
    let wallet = null;

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
        })
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
      console.log('User ID: ' + userId + '\n' + wallet)
    }

    if (asset.type === "TURTLENOTE") {
      const randomSalt = crypto.randomBytes(16).toString("hex");
      const paymentId = crypto.createHash("sha256").update(Date.now().toString() + randomSalt).digest("hex");

      let rpcUrl = asset.rpc_url;

      if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
        rpcUrl = "http://" + rpcUrl;
      }

      const response = await fetch(rpcUrl + '/addresses/create', {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          'X-API-KEY': process.env.WALLET_RPC_PASSWORD
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
      console.log('User ID: ' + userId + '\n' + wallet)
    }

    if (!wallet) {
      return res.status(500).json({ error: "Wallet generation failed" });
    }

    /* Guardar en DB */
    const [insert] = await pool.query(
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
    
    if (asset.type === "UTXO") {
        return res.json({ 
          address: wallet.address 
        });
    } else if (asset.type === "TURTLENOTE") {
        return res.json({ 
          address: wallet.address,
          payment_id: wallet.payment_id,
          integrated_address: wallet.integrated_address

        });
    } else {
        return res.status(400).json({
          error: "Unsupported Type"
        })
    }     
    

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching ticker" });
  }
});

module.exports = router;
