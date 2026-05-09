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

      const confirmations =
        Number(tx.confirmations || 0);

      const requiredConfirmations =
        Number(asset.confirmations_required || 1);

      // -----------------------------------------
      // CHECK EXISTING DEPOSIT
      // -----------------------------------------
      const [existingRows] = await pool.query(
        `
        SELECT *
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

      // =========================================
      // NEW DEPOSIT
      // =========================================
      if (!existingRows.length) {

        const status =
          confirmations >= requiredConfirmations
            ? "confirmed"
            : "pending";

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
              confirmations,
              status
            ]
          );

          // -----------------------------------------
          // CREDIT ONLY IF CONFIRMED
          // -----------------------------------------
          if (status === "confirmed") {

            await balanceService.addBalance(
              conn,
              wallet.user_id,
              wallet.asset_ticker,
              Number(tx.amount)
            );

            await balanceService.createTransaction(
              conn,
              wallet.user_id,
              wallet.asset_ticker,
              "deposit",
              Number(tx.amount),
              tx.txid,
              "Blockchain deposit"
            );

            console.log(
              `[DEPOSIT CONFIRMED] ${wallet.asset_ticker} ${tx.amount} credited to user ${wallet.user_id}`
            );
          }

          await conn.commit();

        } catch (err) {

          await conn.rollback();

          console.error(err);

        } finally {

          conn.release();
        }

        continue;
      }

      // =========================================
      // EXISTING DEPOSIT
      // =========================================
      const existing = existingRows[0];

      // -----------------------------------------
      // UPDATE CONFIRMATIONS
      // -----------------------------------------
      await pool.query(
        `
        UPDATE exchange_deposits
        SET confirmations = ?
        WHERE id = ?
        `,
        [
          confirmations,
          existing.id
        ]
      );

      // -----------------------------------------
      // PENDING -> CONFIRMED
      // -----------------------------------------
      if (
        existing.status === "pending" &&
        confirmations >= requiredConfirmations
      ) {

        const conn = await pool.getConnection();

        try {

          await conn.beginTransaction();

          // -----------------------------------------
          // UPDATE STATUS
          // -----------------------------------------
          await conn.query(
            `
            UPDATE exchange_deposits
            SET
              status = 'confirmed',
              confirmed_at = NOW(),
              confirmations = ?
            WHERE id = ?
            `,
            [
              confirmations,
              existing.id
            ]
          );

          // -----------------------------------------
          // CREDIT BALANCE
          // -----------------------------------------
          await balanceService.addBalance(
            conn,
            wallet.user_id,
            wallet.asset_ticker,
            Number(existing.amount)
          );

          // -----------------------------------------
          // CREATE TRANSACTION
          // -----------------------------------------
          await balanceService.createTransaction(
            conn,
            wallet.user_id,
            wallet.asset_ticker,
            "deposit",
            Number(existing.amount),
            existing.tx_hash,
            "Blockchain deposit confirmed"
          );

          await conn.commit();

          console.log(
            `[DEPOSIT CONFIRMED] ${wallet.asset_ticker} ${existing.amount} credited to user ${wallet.user_id}`
          );

        } catch (err) {

          await conn.rollback();

          console.error(err);

        } finally {

          conn.release();
        }
      }
    }
  }

  async function scanDeposits() {

    const [assets] = await pool.query(
      `
      SELECT *
      FROM exchange_assets
      WHERE deposit_enabled = 1
        AND maintenance_mode = 0
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
          err
        );
      }
    }
  }

  return {
    scanDeposits
  };
};