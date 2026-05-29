const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");

router.get("/getlist", async (req, res) => {
    try {

      const [assets] = await pool.query(
        `
        SELECT
          ticker,
          name,
          type,
          network_default,
          decimals,
          confirmations_required,
          min_deposit,
          min_withdraw,
          withdraw_fee,
          deposit_enabled,
          withdraw_enabled,
          maintenance_mode,
          icon_url,
          explorer_tx_url
        FROM exchange_assets
        ORDER BY ticker ASC
        `
      );

      return res.json({
        success: true,
        assets
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
});	


router.get("/info", async (req, res) => {
	const { ticker } = req.query
	
	if (!ticker) {
    	return res.status(400).json({ error: "Ticker required" });
  	}

    try {

      const [asset] = await pool.query(
        `
        SELECT
          ticker,
          name,
          type,
          network_default,
          decimals,
          confirmations_required,
          min_deposit,
          min_withdraw,
          withdraw_fee,
          deposit_enabled,
          withdraw_enabled,
          maintenance_mode
        FROM exchange_assets WHERE ticker = ?
        ORDER BY ticker ASC`,
		[ticker]
      );

      return res.json({
        success: true,
        asset
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
});


module.exports = router;
