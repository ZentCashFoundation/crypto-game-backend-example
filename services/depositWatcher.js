module.exports = (pool, balanceService) => {

  async function scanUTXODeposits(asset) {

    let rpcUrl = asset.rpc_url;

    if (
      !rpcUrl.startsWith("http://") &&
      !rpcUrl.startsWith("https://")
    ) {
      rpcUrl = "http://" + rpcUrl;
    }

    // -----------------------------------------
    // LOAD USER WALLETS
    // -----------------------------------------
    const [wallets] = await pool.query(
      `
      SELECT *
      FROM exchange_wallets
      WHERE asset_ticker = ?
      `,
      [asset.ticker]
    );

    if (!wallets.length) {
      return;
    }

    // -----------------------------------------
    // LOAD RECENT TXS
    // -----------------------------------------
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization":
          "Basic " +
          Buffer.from(
            process.env.RPC_USER +
            ":" +
            process.env.RPC_PASS
          ).toString("base64")
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "deposit-scan",
        method: "listtransactions",
        params: ["*", 100]
      })
    });

    const data = await response.json();

    if (!response.ok || !data.result) {
      throw new Error("RPC error");
    }

    const transactions = data.result;

    // -----------------------------------------
    // PROCESS TXS
    // -----------------------------------------
    for (const tx of transactions) {

      if (tx.category !== "receive") {
        continue;
      }

      const wallet = wallets.find(
        w => w.address === tx.address
      );

      if (!wallet) {
        continue;
      }

      // -----------------------------------------
      // DUPLICATE CHECK
      // -----------------------------------------
      const [existing] = await pool.query(
        `
        SELECT id
        FROM exchange_deposits
        WHERE tx_hash = ?
          AND address = ?
        LIMIT 1
        `,
        [
          tx.txid,
          tx.address
        ]
      );

      if (existing.length) {
        continue;
      }

      // -----------------------------------------
      // BEGIN TX
      // -----------------------------------------
      const conn = await pool.getConnection();

      try {

        await conn.beginTransaction();

        // -----------------------------------------
        // INSERT DEPOSIT
        // -----------------------------------------
        await conn.query(
          `
          INSERT INTO exchange_deposits
          (
            user_id,
            asset_ticker,
            network,
            address,
            tx_hash,
            amount,
            confirmations,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            wallet.user_id,
            wallet.asset_ticker,
            wallet.network,
            wallet.address,
            tx.txid,
            Number(tx.amount),
            Number(tx.confirmations || 0),
            "confirmed"
          ]
        );

        // -----------------------------------------
        // CREDIT BALANCE
        // -----------------------------------------
        await balanceService.addBalance(
          conn,
          wallet.user_id,
          wallet.asset_ticker,
          Number(tx.amount)
        );

        // -----------------------------------------
        // CREATE TRANSACTION LOG
        // -----------------------------------------
        await balanceService.createTransaction(
          conn,
          wallet.user_id,
          wallet.asset_ticker,
          "deposit",
          Number(tx.amount),
          tx.txid,
          "Blockchain deposit"
        );

        await conn.commit();

        console.log(
          `[DEPOSIT] ${wallet.asset_ticker} ${tx.amount} credited to user ${wallet.user_id}`
        );

      } catch (err) {

        await conn.rollback();

        console.error(err);

      } finally {

        conn.release();
      }
    }
  }

  async function scanDeposits() {

    // -----------------------------------------
    // LOAD ASSETS
    // -----------------------------------------
    const [assets] = await pool.query(
      `
      SELECT *
      FROM exchange_assets
      `
    );

    for (const asset of assets) {

      try {

        if (asset.type === "UTXO") {
          await scanUTXODeposits(asset);
        }

      } catch (err) {

        console.error(
          `[DEPOSIT WATCHER ERROR] ${asset.ticker}`,
          err.message
        );
      }
    }
  }

  return {
    scanDeposits
  };
};