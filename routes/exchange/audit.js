const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");

router.get("/", async (req, res) => {

  try {

    const [rows] = await pool.query(`
      SELECT
        user_id,
        asset_ticker,
        available,
        locked,
        (available + locked) AS total
      FROM exchange_balances
    `);

    const [ledger] = await pool.query(`
      SELECT
        user_id,
        asset_ticker,
        SUM(
          CASE
            WHEN type IN ('deposit','trade_in','unlock') THEN amount
            WHEN type IN ('trade_out','lock','withdraw') THEN -amount
            ELSE 0
          END
        ) AS expected_total
      FROM exchange_transactions
      GROUP BY user_id, asset_ticker
    `);

    return res.json({
      balances: rows,
      ledger: ledger
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "audit error" });
  }
});
module.exports = router;
