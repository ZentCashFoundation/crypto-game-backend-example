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
    let data;

    try {

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

      if (!response.ok) {
        console.error(
          `[RPC ERROR] ${asset.ticker} daemon offline`
        );
        return;
      }

      data = await response.json();

      if (!data.result) {
        console.error(
          `[RPC ERROR] ${asset.ticker} invalid rpc response`
        );
        return;
      }

    } catch (err) {

      console.error(
        `[RPC ERROR] ${asset.ticker}`,
        err.message
      );

      return;
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

  async function scanCryptonoteDeposits(asset) {

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
    // PROCESS EACH ACCOUNT
    // -----------------------------------------
    for (const wallet of wallets) {

      let transfers = [];

      try {

        // -----------------------------------------
        // LOAD ACCOUNT TRANSFERS
        // -----------------------------------------
        const response = await fetch(
          rpcUrl + "/json_rpc",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "0",
              method: "get_transfers",
              params: {
                in: true,
                account_index: Number(wallet.account)
              }
            }),
            signal: AbortSignal.timeout(10000)
          }
        );

        if (!response.ok) {

          console.error(
            `[RPC ERROR] ${asset.ticker} get_transfers failed for account ${wallet.account}`
          );

          continue;
        }

        const data = await response.json();

        if (data.error) {

          console.error(
            `[RPC ERROR] ${asset.ticker}`,
            data.error.message
          );

          continue;
        }

        transfers = data.result?.in || [];

      } catch (err) {

        console.error(
          `[RPC ERROR] ${asset.ticker}`,
          err.message
        );

        continue;
      }

      // -----------------------------------------
      // PROCESS TRANSFERS
      // -----------------------------------------
      for (const tx of transfers) {

        // -----------------------------------------
        // NORMALIZE AMOUNT
        // -----------------------------------------
        const amount =
          Number(tx.amount) /
          Math.pow(10, asset.decimals);

        if (amount <= 0) {
          continue;
        }

        // -----------------------------------------
        // TX HASH
        // -----------------------------------------
        const txHash =
          tx.txid ||
          tx.tx_hash ||
          tx.hash;

        if (!txHash) {
          continue;
        }

        // -----------------------------------------
        // CONFIRMATIONS
        // -----------------------------------------
        const confirmations =
          Number(tx.confirmations || 0);

        const requiredConfirmations =
          Number(asset.confirmations_required || 10);

        const status =
          confirmations >= requiredConfirmations
            ? "confirmed"
            : "pending";

        // -----------------------------------------
        // DUPLICATE CHECK
        // -----------------------------------------
        const [existing] = await pool.query(
          `
          SELECT id, status, amount
          FROM exchange_deposits
          WHERE tx_hash = ?
            AND address = ?
          LIMIT 1
          `,
          [
            txHash,
            wallet.address
          ]
        );

        const conn = await pool.getConnection();

        try {

          await conn.beginTransaction();

          // =========================================
          // NEW DEPOSIT
          // =========================================
          if (!existing.length) {

            await conn.query(
              `
              INSERT INTO exchange_deposits
              (
                user_id,
                asset_ticker,
                network,
                address,
                payment_id,
                integrated_address,
                tx_hash,
                amount,
                confirmations,
                status
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [
                wallet.user_id,
                wallet.asset_ticker,
                wallet.network,
                wallet.address,
                wallet.payment_id,
                wallet.integrated_address,
                txHash,
                amount,
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
                amount
              );

              await balanceService.createTransaction(
                conn,
                wallet.user_id,
                wallet.asset_ticker,
                "deposit",
                amount,
                txHash,
                `${asset.name} - Cryptonote deposit`
              );

              console.log(
                `${asset.name} - [CRYPTONOTE DEPOSIT CONFIRMED] ${asset.ticker} ${amount} credited to user ${wallet.user_id}`
              );
            }
          }

          // =========================================
          // EXISTING DEPOSIT
          // =========================================
          else {

            const dbDeposit = existing[0];

            // -----------------------------------------
            // UPDATE CONFIRMATIONS
            // -----------------------------------------
            await conn.query(
              `
              UPDATE exchange_deposits
              SET confirmations = ?
              WHERE id = ?
              `,
              [
                confirmations,
                dbDeposit.id
              ]
            );

            // -----------------------------------------
            // PENDING -> CONFIRMED
            // -----------------------------------------
            if (
              dbDeposit.status === "pending" &&
              status === "confirmed"
            ) {

              await conn.query(
                `
                UPDATE exchange_deposits
                SET
                  status = 'confirmed',
                  confirmed_at = NOW()
                WHERE id = ?
                `,
                [dbDeposit.id]
              );

              await balanceService.addBalance(
                conn,
                wallet.user_id,
                wallet.asset_ticker,
                Number(dbDeposit.amount)
              );

              await balanceService.createTransaction(
                conn,
                wallet.user_id,
                wallet.asset_ticker,
                "deposit",
                Number(dbDeposit.amount),
                txHash,
                `${asset.name} - Cryptonote deposit confirmed`
              );

              console.log(
                `${asset.name} - [CRYPTONOTE DEPOSIT CONFIRMED] ${asset.ticker} ${dbDeposit.amount} credited to user ${wallet.user_id}`
              );
            }
          }

          await conn.commit();

        } catch (err) {

          await conn.rollback();

          console.error(err);

        } finally {

          conn.release();
        }
      }
    }
  }

  async function scanTurtleNoteDeposits(asset) {

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

    if (!wallets.length) return;

    // -----------------------------------------
    // GET NETWORK HEIGHT
    // -----------------------------------------
    let currentHeight = 0;

    try {

      const statusRes = await fetch(
        rpcUrl + "/status",
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": process.env.WALLET_RPC_PASSWORD
          }
        }
      );

      if (statusRes.ok) {
        const status = await statusRes.json();
        currentHeight = Number(status.networkBlockCount || 0);
      }

    } catch (err) {
      console.error(`[RPC STATUS ERROR] ${asset.ticker}`, err.message);
      return;
    }

    // -----------------------------------------
    // LOAD TRANSACTIONS
    // -----------------------------------------
    let transactions = [];

    try {

      const response = await fetch(
        rpcUrl + "/transactions",
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": process.env.WALLET_RPC_PASSWORD
          }
        }
      );

      if (!response.ok) {
        console.error(`[RPC ERROR] ${asset.ticker} tx fetch failed`);
        return;
      }

      const data = await response.json();

      transactions = data.transactions || [];

    } catch (err) {
      console.error(`[RPC ERROR] ${asset.ticker}`, err.message);
      return;
    }

    // -----------------------------------------
    // PROCESS TXS
    // -----------------------------------------
    for (const tx of transactions) {

      if (!tx.transfers || tx.isCoinbaseTransaction) continue;

      const transfers = Array.isArray(tx.transfers)
        ? tx.transfers
        : [tx.transfers];

      for (const transfer of transfers) {

        // -----------------------------------------
        // NORMALIZE AMOUNT
        // -----------------------------------------
        const amount =
          Number(transfer.amount) /
          Math.pow(10, asset.decimals);

        // ONLY INCOMING
        if (amount <= 0) continue;

        // -----------------------------------------
        // MATCH WALLET
        // -----------------------------------------
        const wallet = wallets.find(
          w => w.address === transfer.address
        );

        if (!wallet) continue;

        // -----------------------------------------
        // CONFIRMATIONS
        // -----------------------------------------
        const confirmations = tx.blockHeight
          ? Math.max(
              0,
              currentHeight - Number(tx.blockHeight)
            )
          : 0;

        const requiredConfirmations =
          Number(asset.confirmations_required || 10);

        const status =
          confirmations >= requiredConfirmations
            ? "confirmed"
            : "pending";

        // -----------------------------------------
        // DUPLICATE CHECK
        // -----------------------------------------
        const [existing] = await pool.query(
          `
          SELECT id, status, amount
          FROM exchange_deposits
          WHERE tx_hash = ?
            AND address = ?
          LIMIT 1
          `,
          [tx.hash, wallet.address]
        );

        const conn = await pool.getConnection();

        try {

          await conn.beginTransaction();

          // =========================================
          // NEW DEPOSIT
          // =========================================
          if (!existing.length) {

            await conn.query(
              `
              INSERT INTO exchange_deposits
              (
                user_id,
                asset_ticker,
                network,
                address,
                payment_id,
                integrated_address,
                tx_hash,
                amount,
                confirmations,
                status
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [
                wallet.user_id,
                wallet.asset_ticker,
                wallet.network,
                wallet.address,
                wallet.payment_id,
                wallet.integrated_address,
                tx.hash,
                amount,
                confirmations,
                status
              ]
            );

            if (status === "confirmed") {

              await balanceService.addBalance(
                conn,
                wallet.user_id,
                wallet.asset_ticker,
                amount
              );

              await balanceService.createTransaction(
                conn,
                wallet.user_id,
                wallet.asset_ticker,
                "deposit",
                amount,
                tx.hash,
                "TurtleNote deposit"
              );
            }

          }

          // =========================================
          // EXISTING DEPOSIT UPDATE
          // =========================================
          else {

            const dbDeposit = existing[0];

            await conn.query(
              `
              UPDATE exchange_deposits
              SET confirmations = ?
              WHERE id = ?
              `,
              [confirmations, dbDeposit.id]
            );

            if (
              dbDeposit.status === "pending" &&
              status === "confirmed"
            ) {

              await conn.query(
                `
                UPDATE exchange_deposits
                SET status = 'confirmed',
                    confirmed_at = NOW()
                WHERE id = ?
                `,
                [dbDeposit.id]
              );

              await balanceService.addBalance(
                conn,
                wallet.user_id,
                wallet.asset_ticker,
                Number(dbDeposit.amount)
              );

              await balanceService.createTransaction(
                conn,
                wallet.user_id,
                wallet.asset_ticker,
                "deposit",
                Number(dbDeposit.amount),
                tx.hash,
                "TurtleNote deposit confirmed"
              );
            }
          }

          await conn.commit();

        } catch (err) {

          await conn.rollback();
          console.error(err);

        } finally {

          conn.release();
        }
      }
    }
  }

  async function scanZanoNoteDeposits(asset) {

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
    // BUILD PAYMENT ID LIST
    // -----------------------------------------
    const paymentIds = wallets
      .filter(w => w.payment_id)
      .map(w => w.payment_id);

    if (!paymentIds.length) {
      return;
    }

    // -----------------------------------------
    // GET CURRENT WALLET HEIGHT
    // -----------------------------------------
    let currentHeight = 0;

    try {

      const infoRes = await fetch(
        rpcUrl + "/json_rpc",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "0",
            method: "get_wallet_info",
            params: {}
          }),
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!infoRes.ok) {
        console.error(`[RPC ERROR] ${asset.ticker} get_wallet_info failed`);
        return;
      }

      const infoData = await infoRes.json();

      if (infoData.error) {
        console.error(`[RPC ERROR] ${asset.ticker}`, infoData.error.message);
        return;
      }

      currentHeight = Number(
        infoData.result?.wi?.current_height ||
        infoData.result?.current_height ||
        0
      );

    } catch (err) {
      console.error(`[RPC ERROR] ${asset.ticker}`, err.message);
      return;
    }

    if (!currentHeight) {
      return;
    }

    // -----------------------------------------
    // LOAD BULK PAYMENTS (EXPLICIT PAYMENT_IDS)
    // -----------------------------------------
    let payments = [];

    try {

      const response = await fetch(
        rpcUrl + "/json_rpc",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "0",
            method: "get_bulk_payments",
            params: {
              payment_ids: paymentIds,
              min_block_height: 0
            }
          }),
          signal: AbortSignal.timeout(15000)
        }
      );

      if (!response.ok) {
        console.error(`[RPC ERROR] ${asset.ticker} get_bulk_payments failed`);
        return;
      }

      const data = await response.json();

      if (data.error) {
        console.error(`[RPC ERROR] ${asset.ticker}`, data.error.message);
        return;
      }

      payments = data.result?.payments || [];

    } catch (err) {
      console.error(`[RPC ERROR] ${asset.ticker}`, err.message);
      return;
    }

    // -----------------------------------------
    // PROCESS PAYMENTS
    // -----------------------------------------
    for (const payment of payments) {

      // -----------------------------------------
      // MATCH TO LOCAL WALLET BY PAYMENT_ID
      // -----------------------------------------
      const wallet = wallets.find(
        w => w.payment_id === payment.payment_id
      );

      if (!wallet) {
        console.warn(
          `[ZANONOTE UNMATCHED PAYMENT] ${asset.ticker} payment_id=${payment.payment_id} tx=${payment.tx_hash} amount=${payment.amount}`
        );
        continue;
      }

      // -----------------------------------------
      // NORMALIZE AMOUNT
      // -----------------------------------------
      const amount =
        Number(payment.amount) /
        Math.pow(10, asset.decimals);

      if (amount <= 0) {
        continue;
      }

      // -----------------------------------------
      // TX HASH
      // -----------------------------------------
      const txHash =
        payment.tx_hash ||
        payment.tx_id ||
        payment.hash;

      if (!txHash) {
        continue;
      }

      // -----------------------------------------
      // CONFIRMATIONS (CALCULATED MANUALLY)
      // -----------------------------------------
      const blockHeight = Number(payment.block_height || 0);

      const confirmations =
        blockHeight > 0
          ? Math.max(0, currentHeight - blockHeight)
          : 0;

      const requiredConfirmations =
        Number(asset.confirmations_required || 10);

      const status =
        confirmations >= requiredConfirmations
          ? "confirmed"
          : "pending";

      // -----------------------------------------
      // DUPLICATE CHECK
      // -----------------------------------------
      const [existing] = await pool.query(
        `
        SELECT id, status, amount
        FROM exchange_deposits
        WHERE tx_hash = ?
          AND address = ?
        LIMIT 1
        `,
        [
          txHash,
          wallet.address
        ]
      );

      const conn = await pool.getConnection();

      try {

        await conn.beginTransaction();

        // =========================================
        // NEW DEPOSIT
        // =========================================
        if (!existing.length) {

          await conn.query(
            `
            INSERT INTO exchange_deposits
            (
              user_id,
              asset_ticker,
              network,
              address,
              payment_id,
              integrated_address,
              tx_hash,
              amount,
              confirmations,
              status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              wallet.user_id,
              wallet.asset_ticker,
              wallet.network,
              wallet.address,
              wallet.payment_id,
              wallet.integrated_address,
              txHash,
              amount,
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
              amount
            );

            await balanceService.createTransaction(
              conn,
              wallet.user_id,
              wallet.asset_ticker,
              "deposit",
              amount,
              txHash,
              `${asset.name} - Zanonote deposit`
            );

            console.log(
              `${asset.name} - [ZANONOTE DEPOSIT CONFIRMED] ${asset.ticker} ${amount} credited to user ${wallet.user_id}`
            );
          }
        }

        // =========================================
        // EXISTING DEPOSIT
        // =========================================
        else {

          const dbDeposit = existing[0];

          // -----------------------------------------
          // UPDATE CONFIRMATIONS
          // -----------------------------------------
          await conn.query(
            `
            UPDATE exchange_deposits
            SET confirmations = ?
            WHERE id = ?
            `,
            [
              confirmations,
              dbDeposit.id
            ]
          );

          // -----------------------------------------
          // PENDING -> CONFIRMED
          // -----------------------------------------
          if (
            dbDeposit.status === "pending" &&
            status === "confirmed"
          ) {

            await conn.query(
              `
              UPDATE exchange_deposits
              SET
                status = 'confirmed',
                confirmed_at = NOW()
              WHERE id = ?
              `,
              [dbDeposit.id]
            );

            await balanceService.addBalance(
              conn,
              wallet.user_id,
              wallet.asset_ticker,
              Number(dbDeposit.amount)
            );

            await balanceService.createTransaction(
              conn,
              wallet.user_id,
              wallet.asset_ticker,
              "deposit",
              Number(dbDeposit.amount),
              txHash,
              `${asset.name} - Zanonote deposit confirmed`
            );

            console.log(
              `${asset.name} - [ZANONOTE DEPOSIT CONFIRMED] ${asset.ticker} ${dbDeposit.amount} credited to user ${wallet.user_id}`
            );
          }
        }

        await conn.commit();

      } catch (err) {

        await conn.rollback();

        console.error(err);

      } finally {

        conn.release();
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

        if (asset.type === "CRYPTONOTE") {
          await scanCryptonoteDeposits(asset)
        }        

        if (asset.type === "TURTLENOTE") {
          await scanTurtleNoteDeposits(asset)
        }

        if (asset.type === "ZANONOTE") {
          await scanZanoNoteDeposits(asset)
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
