const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");
const axios = require("axios");

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT ticker, name, type, decimals, contract_address, confirmations_required, explorer_url, explorer_tx_url, explorer_address_url, network_fee, icon_url, website, coinmarketcap, coingecko, github, payment_address_per_listing, total_revenue, total_outstanding, total_cost, status, created_at, updated_at FROM exchange_listing_assets"
    );

    res.json({ result: rows });

    

  } catch (err) {
    res.status(500).json({ error: "Error fetching listing" });
  }
});

router.post("/", async (req, res) => {
    const {
        ticker,
        name,
        type,
        decimals,
        contract_address,
        requires_memo,
        confirmations_required,
        explorer_url,
        explorer_tx_url,
        explorer_address_url,
        network_fee,
        icon_url,
        website,
        coinmarketcap,
        coingecko,
        github
    } = req.body;

    const [assetRows] = await pool.query(
      "SELECT * FROM exchange_assets WHERE ticker = 'BTC'"
    );

    const asset = assetRows[0];

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
          params: [`listing_${ticker}`]
        }),
        signal: AbortSignal.timeout(50000) 
      });

      const data = await response.json();

      if (!response.ok || !data.result) {
        return res.status(500).json({ error: "RPC error generating address" });
      }


    let total_cost;

    if (type === "ZANONOTE") {
        total_cost = 0.001;
    } else if (type === "UTXO") {
        total_cost = 0.01;
    } else {
        total_cost = 0.1;
    }

    try {
        const [rows] = await pool.query(
            `INSERT INTO exchange_listing_assets (
                ticker,
                name,
                type,
                decimals,
                contract_address,
                requires_memo,
                confirmations_required,
                explorer_url,
                explorer_tx_url,
                explorer_address_url,
                network_fee,
                icon_url,
                website,
                coinmarketcap,
                coingecko,
                github,
                payment_address_per_listing,
                total_revenue,
                total_outstanding,
                total_cost,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                ticker,
                name,
                type,
                decimals,
                contract_address,
                requires_memo,
                confirmations_required,
                explorer_url,
                explorer_tx_url,
                explorer_address_url,
                network_fee,
                icon_url,
                website,
                coinmarketcap,
                coingecko,
                github,
                data.result,
                0,
                0,
                total_cost,
                "pending payment"
            ]
        );

        res.json({ result: rows });

    } catch (err) {
        console.error("ERROR INSERT:", err);

        res.status(500).json({
            error: err.message
        });
    }
});

module.exports = router;