module.exports = (pool) => {

  async function scanListingPayments() {

    const [btcAssetRows] = await pool.query(
      `SELECT * FROM exchange_assets WHERE ticker = 'BTC'`
    );

    const btcAsset = btcAssetRows[0];

    if (!btcAsset) {
      console.error(`[LISTING WATCHER ERROR] BTC asset not configured`);
      return;
    }

    let rpcUrl = btcAsset.rpc_url;

    if (
      !rpcUrl.startsWith("http://") &&
      !rpcUrl.startsWith("https://")
    ) {
      rpcUrl = "http://" + rpcUrl;
    }

    // -----------------------------------------
    // LOAD PENDING LISTINGS
    // -----------------------------------------
    const [listings] = await pool.query(
      `
      SELECT *
      FROM exchange_listing_assets
      WHERE status = 'pending payment'
      `
    );

    if (!listings.length) {
      return;
    }

    // -----------------------------------------
    // PROCESS EACH LISTING
    // -----------------------------------------
    for (const listing of listings) {

      if (!listing.payment_address_per_listing) {
        continue;
      }

      try {

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
            id: "listing-balance",
            method: "getreceivedbyaddress",
            params: [listing.payment_address_per_listing, 1]
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
          console.error(
            `[LISTING WATCHER ERROR] ${listing.ticker} RPC not ok`
          );
          continue;
        }

        const data = await response.json();

        if (data.error) {
          console.error(
            `[LISTING WATCHER ERROR] ${listing.ticker}`,
            data.error.message
          );
          continue;
        }

        const received = Number(data.result || 0);
        const totalCost = Number(listing.total_cost || 0);
        const pending = Math.max(0, totalCost - received);

        // -----------------------------------------
        // UPDATE OUTSTANDING / RECEIVED
        // -----------------------------------------
        await pool.query(
          `
          UPDATE exchange_listing_assets
          SET
            total_revenue = ?,
            total_outstanding = ?
          WHERE ticker = ?
          `,
          [
            received,
            pending,
            listing.ticker
          ]
        );

        // -----------------------------------------
        // MARK AS PAID IF FULLY COVERED
        // -----------------------------------------
        if (received >= totalCost) {

          await pool.query(
            `
            UPDATE exchange_listing_assets
            SET status = 'Payment Complete'
            WHERE ticker = ?
            `,
            [listing.ticker]
          );

          console.log(
            `[LISTING PAYMENT COMPLETE] ${listing.ticker} received=${received} required=${totalCost}`
          );
        }

      } catch (err) {

        console.error(
          `[LISTING WATCHER ERROR] ${listing.ticker}`,
          err.message
        );
      }
    }
  }

  return {
    scanListingPayments
  };
};