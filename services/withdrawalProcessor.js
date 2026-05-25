module.exports = (pool, balanceService) => {

async function processUTXOWithdrawals(asset) {

  let rpcUrl = asset.rpc_url;

  if (
    !rpcUrl.startsWith("http://") &&
    !rpcUrl.startsWith("https://")
  ) {
    rpcUrl = "http://" + rpcUrl;
  }

  // -----------------------------------------
  // LOAD PENDING WITHDRAWALS
  // -----------------------------------------
  const [withdrawals] = await pool.query(
    `
    SELECT *
    FROM exchange_withdrawals
    WHERE asset_ticker = ?
      AND status = 'pending'
    ORDER BY id ASC
    LIMIT 25
    `,
    [asset.ticker]
  );

  if (!withdrawals.length) {
    return;
  }

  // -----------------------------------------
  // PROCESS WITHDRAWALS
  // -----------------------------------------
  for (const withdrawal of withdrawals) {

    const conn = await pool.getConnection();

    try {

      await conn.beginTransaction();

      // -----------------------------------------
      // LOCK WITHDRAWAL
      // -----------------------------------------
      const [rows] = await conn.query(
        `
        SELECT *
        FROM exchange_withdrawals
        WHERE id = ?
        FOR UPDATE
        `,
        [withdrawal.id]
      );

      if (!rows.length) {

        await conn.rollback();

        continue;
      }

      const dbWithdrawal = rows[0];

      if (dbWithdrawal.status !== "pending") {

        await conn.rollback();

        continue;
      }

      // -----------------------------------------
      // SET PROCESSING
      // -----------------------------------------
      await conn.query(
        `
        UPDATE exchange_withdrawals
        SET status = 'processing'
        WHERE id = ?
        `,
        [dbWithdrawal.id]
      );

      // -----------------------------------------
      // BUILD RPC REQUEST
      // -----------------------------------------
      const rpcBody = {
        jsonrpc: "1.0",
        id: "withdraw",
        method: "sendtoaddress",
        params: [
          dbWithdrawal.address,
          Number(dbWithdrawal.amount)
        ]
      };

      console.log(
        "[UTXO RPC REQUEST]",
        JSON.stringify(rpcBody, null, 2)
      );

      // -----------------------------------------
      // SEND TRANSACTION
      // -----------------------------------------
      const response = await fetch(
        rpcUrl,
        {
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
          body: JSON.stringify(rpcBody),
          signal: AbortSignal.timeout(120000)
        }
      );

      console.log(
        "[UTXO HTTP STATUS]",
        response.status
      );

      let data = {};

      try {

        data = await response.json();

      } catch (err) {

        console.error(
          "[INVALID RPC JSON RESPONSE]"
        );
      }

      console.log(
        "[UTXO RPC RESPONSE]",
        JSON.stringify(data, null, 2)
      );

      // -----------------------------------------
      // RPC ERROR
      // -----------------------------------------
      if (
        !response.ok ||
        data.error
      ) {

        const errorMessage =
          data.error?.message ||
          JSON.stringify(data);

        const totalLocked =
          Number(dbWithdrawal.amount) +
          Number(dbWithdrawal.fee || 0);

        // unlock balance
        await conn.query(
          `
          UPDATE exchange_balances
          SET
            available = available + ?,
            locked = locked - ?
          WHERE user_id = ?
            AND asset_ticker = ?
          `,
          [
            totalLocked,
            totalLocked,
            dbWithdrawal.user_id,
            dbWithdrawal.asset_ticker
          ]
        );

        await balanceService.createTransaction(
          conn,
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker,
          "unlock",
          totalLocked,
          dbWithdrawal.id,
          "Withdrawal failed - funds unlocked"
        );

        await conn.query(
          `
          UPDATE exchange_withdrawals
          SET
            status = 'failed',
            error_message = ?
          WHERE id = ?
          `,
          [
            errorMessage,
            dbWithdrawal.id
          ]
        );

        await conn.commit();

        console.error(
          `[UTXO WITHDRAW FAILED] ${asset.ticker}`,
          errorMessage
        );

        continue;
      }

      // -----------------------------------------
      // TX HASH
      // -----------------------------------------
      const txHash = data.result;

      if (!txHash) {

        throw new Error(
          "No transaction hash returned"
        );
      }

      // -----------------------------------------
      // REMOVE LOCKED BALANCE
      // -----------------------------------------
      const totalLocked =
        Number(dbWithdrawal.amount) +
        Number(dbWithdrawal.fee || 0);

      await conn.query(
        `
        UPDATE exchange_balances
        SET
          locked = locked - ?
        WHERE user_id = ?
          AND asset_ticker = ?
        `,
        [
          totalLocked,
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker
        ]
      );

      // -----------------------------------------
      // UPDATE WITHDRAWAL
      // -----------------------------------------
      await conn.query(
        `
        UPDATE exchange_withdrawals
        SET
          status = 'broadcasted',
          tx_hash = ?,
          processed_at = NOW()
        WHERE id = ?
        `,
        [
          txHash,
          dbWithdrawal.id
        ]
      );

      // -----------------------------------------
      // CREATE TRANSACTION LOG
      // -----------------------------------------
      await balanceService.createTransaction(
        conn,
        dbWithdrawal.user_id,
        dbWithdrawal.asset_ticker,
        "withdraw",
        totalLocked,
        txHash,
        "UTXO withdrawal"
      );

      await conn.commit();

      console.log(
        `[UTXO WITHDRAW BROADCASTED] ${asset.ticker} ${dbWithdrawal.amount} sent for user ${dbWithdrawal.user_id}`
      );

    } catch (err) {

      await conn.rollback();

      console.error(
        `[UTXO WITHDRAW PROCESSOR ERROR] ${asset.ticker}`,
        err
      );

    } finally {

      conn.release();
    }
  }
}

async function processCryptonoteWithdrawals(asset) {

  let rpcUrl = asset.rpc_url;

  if (
    !rpcUrl.startsWith("http://") &&
    !rpcUrl.startsWith("https://")
  ) {
    rpcUrl = "http://" + rpcUrl;
  }

  // -----------------------------------------
  // LOAD PENDING WITHDRAWALS
  // -----------------------------------------
  const [withdrawals] = await pool.query(
    `
    SELECT *
    FROM exchange_withdrawals
    WHERE asset_ticker = ?
      AND status = 'pending'
    ORDER BY id ASC
    LIMIT 25
    `,
    [asset.ticker]
  );

  if (!withdrawals.length) {
    return;
  }

  // -----------------------------------------
  // PROCESS WITHDRAWALS
  // -----------------------------------------
  for (const withdrawal of withdrawals) {

    const conn = await pool.getConnection();

    try {

      await conn.beginTransaction();

      // -----------------------------------------
      // LOCK WITHDRAWAL
      // -----------------------------------------
      const [rows] = await conn.query(
        `
        SELECT *
        FROM exchange_withdrawals
        WHERE id = ?
        FOR UPDATE
        `,
        [withdrawal.id]
      );

      if (!rows.length) {

        await conn.rollback();

        continue;
      }

      const dbWithdrawal = rows[0];

      if (dbWithdrawal.status !== "pending") {

        await conn.rollback();

        continue;
      }

      // -----------------------------------------
      // LOAD USER WALLET
      // -----------------------------------------
      const [walletRows] = await conn.query(
        `
        SELECT *
        FROM exchange_wallets
        WHERE user_id = ?
          AND asset_ticker = ?
        LIMIT 1
        `,
        [
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker
        ]
      );

      if (!walletRows.length) {

        const totalLocked =
          Number(dbWithdrawal.amount) +
          Number(dbWithdrawal.fee || 0);

        // unlock balance
        await conn.query(
          `
          UPDATE exchange_balances
          SET
            available = available + ?,
            locked = locked - ?
          WHERE user_id = ?
            AND asset_ticker = ?
          `,
          [
            totalLocked,
            totalLocked,
            dbWithdrawal.user_id,
            dbWithdrawal.asset_ticker
          ]
        );

        await balanceService.createTransaction(
          conn,
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker,
          "unlock",
          totalLocked,
          dbWithdrawal.id,
          "Withdrawal failed - funds unlocked"
        );

        await conn.query(
          `
          UPDATE exchange_withdrawals
          SET
            status = 'failed',
            error_message = 'User wallet not found'
          WHERE id = ?
          `,
          [dbWithdrawal.id]
        );

        await conn.commit();

        continue;
      }

      const userWallet = walletRows[0];

      // -----------------------------------------
      // SET PROCESSING
      // -----------------------------------------
      await conn.query(
        `
        UPDATE exchange_withdrawals
        SET status = 'processing'
        WHERE id = ?
        `,
        [dbWithdrawal.id]
      );

      // -----------------------------------------
      // PREPARE AMOUNT
      // -----------------------------------------
      const atomicAmount = Math.floor(
        Number(dbWithdrawal.amount) *
        Math.pow(10, asset.decimals)
      );

      // -----------------------------------------
      // BUILD RPC BODY
      // -----------------------------------------
      const rpcBody = {
        jsonrpc: "2.0",
        id: "0",
        method: "transfer",
        params: {
          destinations: [
            {
              address: dbWithdrawal.address,
              amount: atomicAmount
            }
          ],

          account_index:
            Number(userWallet.account || 0),

          subaddr_indices:
            [Number(userWallet.address_index || 0)],

          priority: 0,
          ring_size: 11,
          get_tx_key: true
        }
      };

      // optional payment id
      if (dbWithdrawal.payment_id) {
        rpcBody.params.payment_id =
          dbWithdrawal.payment_id;
      }

      console.log(
        "[MONERO RPC REQUEST]",
        JSON.stringify(rpcBody, null, 2)
      );

      // -----------------------------------------
      // SEND TRANSACTION
      // -----------------------------------------
      const response = await fetch(
        rpcUrl + "/json_rpc",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(rpcBody),
          signal: AbortSignal.timeout(120000)
        }
      );

      console.log(
        "[MONERO HTTP STATUS]",
        response.status
      );

      let data = {};

      try {

        data = await response.json();

      } catch (err) {

        console.error(
          "[INVALID MONERO JSON RESPONSE]"
        );
      }

      console.log(
        "[MONERO RPC RESPONSE]",
        JSON.stringify(data, null, 2)
      );

      // -----------------------------------------
      // RPC ERROR
      // -----------------------------------------
      if (
        !response.ok ||
        data.error
      ) {

        const errorMessage =
          data.error?.message ||
          JSON.stringify(data);

        const totalLocked =
          Number(dbWithdrawal.amount) +
          Number(dbWithdrawal.fee || 0);

        // unlock balance
        await conn.query(
          `
          UPDATE exchange_balances
          SET
            available = available + ?,
            locked = locked - ?
          WHERE user_id = ?
            AND asset_ticker = ?
          `,
          [
            totalLocked,
            totalLocked,
            dbWithdrawal.user_id,
            dbWithdrawal.asset_ticker
          ]
        );

        await balanceService.createTransaction(
          conn,
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker,
          "unlock",
          totalLocked,
          dbWithdrawal.id,
          "Withdrawal failed - funds unlocked"
        );

        await conn.query(
          `
          UPDATE exchange_withdrawals
          SET
            status = 'failed',
            error_message = ?
          WHERE id = ?
          `,
          [
            errorMessage,
            dbWithdrawal.id
          ]
        );

        await conn.commit();

        console.error(
          `[MONERO WITHDRAW FAILED] ${asset.ticker}`,
          errorMessage
        );

        continue;
      }

      // -----------------------------------------
      // TX HASH
      // -----------------------------------------
      const txHash =
        data.result?.tx_hash ||
        data.result?.tx_hash_list?.[0];

      if (!txHash) {

        throw new Error(
          "No transaction hash returned"
        );
      }

      // -----------------------------------------
      // REMOVE LOCKED BALANCE
      // -----------------------------------------
      const totalLocked =
        Number(dbWithdrawal.amount) +
        Number(dbWithdrawal.fee || 0);

      await conn.query(
        `
        UPDATE exchange_balances
        SET
          locked = locked - ?
        WHERE user_id = ?
          AND asset_ticker = ?
        `,
        [
          totalLocked,
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker
        ]
      );

      // -----------------------------------------
      // UPDATE WITHDRAWAL
      // -----------------------------------------
      await conn.query(
        `
        UPDATE exchange_withdrawals
        SET
          status = 'broadcasted',
          tx_hash = ?,
          processed_at = NOW()
        WHERE id = ?
        `,
        [
          txHash,
          dbWithdrawal.id
        ]
      );

      // -----------------------------------------
      // CREATE TRANSACTION LOG
      // -----------------------------------------
      await balanceService.createTransaction(
        conn,
        dbWithdrawal.user_id,
        dbWithdrawal.asset_ticker,
        "withdraw",
        totalLocked,
        txHash,
        "Cryptonote withdrawal"
      );

      await conn.commit();

      console.log(
        `[MONERO WITHDRAW BROADCASTED] ${asset.ticker} ${dbWithdrawal.amount} sent for user ${dbWithdrawal.user_id}`
      );

    } catch (err) {

      await conn.rollback();

      console.error(
        `[MONERO WITHDRAW PROCESSOR ERROR] ${asset.ticker}`,
        err
      );

    } finally {

      conn.release();
    }
  }
}

async function processTurtleNoteWithdrawals(asset) {

  let rpcUrl = asset.rpc_url;

  if (
    !rpcUrl.startsWith("http://") &&
    !rpcUrl.startsWith("https://")
  ) {
    rpcUrl = "http://" + rpcUrl;
  }

  // -----------------------------------------
  // LOAD PENDING WITHDRAWALS
  // -----------------------------------------
  const [withdrawals] = await pool.query(
    `
    SELECT *
    FROM exchange_withdrawals
    WHERE asset_ticker = ?
      AND status = 'pending'
    ORDER BY id ASC
    LIMIT 25
    `,
    [asset.ticker]
  );

  if (!withdrawals.length) {
    return;
  }

  // -----------------------------------------
  // PROCESS WITHDRAWALS
  // -----------------------------------------
  for (const withdrawal of withdrawals) {

    const conn = await pool.getConnection();

    try {

      await conn.beginTransaction();

      // -----------------------------------------
      // LOCK WITHDRAWAL
      // -----------------------------------------
      const [rows] = await conn.query(
        `
        SELECT *
        FROM exchange_withdrawals
        WHERE id = ?
        FOR UPDATE
        `,
        [withdrawal.id]
      );

      if (!rows.length) {

        await conn.rollback();

        continue;
      }

      const dbWithdrawal = rows[0];

      if (dbWithdrawal.status !== "pending") {

        await conn.rollback();

        continue;
      }

      // -----------------------------------------
      // LOAD USER WALLET
      // -----------------------------------------
      const [walletRows] = await conn.query(
        `
        SELECT *
        FROM exchange_wallets
        WHERE user_id = ?
          AND asset_ticker = ?
        LIMIT 1
        `,
        [
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker
        ]
      );

      if (!walletRows.length) {

        // unlock balance
        const totalLocked =
          Number(dbWithdrawal.amount) +
          Number(dbWithdrawal.fee || 0);

        await conn.query(
          `
          UPDATE exchange_balances
          SET
            available = available + ?,
            locked = locked - ?
          WHERE user_id = ?
            AND asset_ticker = ?
          `,
          [
            totalLocked,
            totalLocked,
            dbWithdrawal.user_id,
            dbWithdrawal.asset_ticker
          ]
        );

        await conn.query(
          `
          UPDATE exchange_withdrawals
          SET
            status = 'failed',
            error_message = 'User wallet not found'
          WHERE id = ?
          `,
          [dbWithdrawal.id]
        );

        await conn.commit();

        continue;
      }

      const userWallet = walletRows[0];

      // -----------------------------------------
      // SET PROCESSING
      // -----------------------------------------
      await conn.query(
        `
        UPDATE exchange_withdrawals
        SET status = 'processing'
        WHERE id = ?
        `,
        [dbWithdrawal.id]
      );

      // -----------------------------------------
      // PREPARE AMOUNT
      // -----------------------------------------
      const atomicAmount = Math.floor(
        Number(dbWithdrawal.amount) *
        Math.pow(10, asset.decimals)
      );

      // -----------------------------------------
      // BUILD REQUEST
      // -----------------------------------------
      const requestBody = {
        destinations: [
          {
            address: dbWithdrawal.address,
            amount: atomicAmount
          }
        ],
        /* Disable
        sourceAddresses: [
          userWallet.address
        ],

        changeAddress:
          userWallet.address
        */          
      };

      // optional payment id
      if (typeof dbWithdrawal.payment_id === "string" && dbWithdrawal.payment_id.length === 64 && dbWithdrawal.payment_id != null) {
        requestBody.paymentID = dbWithdrawal.payment_id;
      }      

      // -----------------------------------------
      // SEND TRANSACTION
      // -----------------------------------------
      const response = await fetch(
        rpcUrl + "/transactions/send/advanced",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": process.env.WALLET_RPC_PASSWORD
          },
          body: JSON.stringify(requestBody)
        }
      );

      const data = await response.json();

      // -----------------------------------------
      // RPC ERROR
      // -----------------------------------------
      if (!response.ok || data.error) {

        const errorMessage =  data.error?.message || data.errorMessage || data.message ||  JSON.stringify(data) || "Wallet RPC error";

        const totalLocked =
          Number(dbWithdrawal.amount) +
          Number(dbWithdrawal.fee || 0);

        // unlock balance
        await conn.query(
          `
          UPDATE exchange_balances
          SET
            available = available + ?,
            locked = locked - ?
          WHERE user_id = ?
            AND asset_ticker = ?
          `,
          [
            totalLocked,
            totalLocked,
            dbWithdrawal.user_id,
            dbWithdrawal.asset_ticker
          ]
        );

        await balanceService.createTransaction(conn, dbWithdrawal.user_id, dbWithdrawal.asset_ticker, "unlock", totalLocked, dbWithdrawal.id, `${dbWithdrawal.asset_ticker} - Withdrawal failed - funds unlocked`);

        await conn.query(
          `
          UPDATE exchange_withdrawals
          SET
            status = 'failed',
            error_message = ?
          WHERE id = ?
          `,
          [
            errorMessage,
            dbWithdrawal.id
          ]
        );

        await conn.commit();

        console.error(
          `[WITHDRAW FAILED] ${asset.ticker}`,
          errorMessage
        );

        continue;
      }

      // -----------------------------------------
      // TX HASH
      // -----------------------------------------
      const txHash =
        data.transactionHash ||
        data.txHash ||
        data.hash;

      if (!txHash) {

        throw new Error(
          "No transaction hash returned"
        );
      }

      // -----------------------------------------
      // REMOVE LOCKED BALANCE
      // -----------------------------------------
      const totalLocked =
        Number(dbWithdrawal.amount) +
        Number(dbWithdrawal.fee || 0);

      await conn.query(
        `
        UPDATE exchange_balances
        SET
          locked = locked - ?
        WHERE user_id = ?
          AND asset_ticker = ?
        `,
        [
          totalLocked,
          dbWithdrawal.user_id,
          dbWithdrawal.asset_ticker
        ]
      );

      // -----------------------------------------
      // UPDATE WITHDRAWAL
      // -----------------------------------------
      await conn.query(
        `
        UPDATE exchange_withdrawals
        SET
          status = 'broadcasted',
          tx_hash = ?,
          processed_at = NOW()
        WHERE id = ?
        `,
        [
          txHash,
          dbWithdrawal.id
        ]
      );

      // -----------------------------------------
      // CREATE TRANSACTION LOG
      // -----------------------------------------
      await balanceService.createTransaction(
        conn,
        dbWithdrawal.user_id,
        dbWithdrawal.asset_ticker,
        "withdraw",
        totalLocked,
        txHash,
        `${asset.name} withdrawal. ${asset.ticker} ${dbWithdrawal.amount} sent for user ${dbWithdrawal.user_id}.`
      );

      await conn.commit();

      console.log(
        `[WITHDRAW BROADCASTED] ${asset.ticker} ${dbWithdrawal.amount} sent for user ${dbWithdrawal.user_id}`
      );

    } catch (err) {

      await conn.rollback();

      console.error(
        `[WITHDRAW PROCESSOR ERROR] ${asset.ticker}`,
        err
      );

    } finally {

      conn.release();
    }
  }
}

  async function processWithdrawals() {

    const [assets] = await pool.query(
      `
      SELECT *
      FROM exchange_assets
      WHERE withdraw_enabled = 1
        AND maintenance_mode = 0
      `
    );

    for (const asset of assets) {

      try {
        
        if (asset.type === "UTXO") {
            await processUTXOWithdrawals(asset);
        }

        if (asset.type === "CRYPTONOTE") {
          await processCryptonoteWithdrawals(asset);
        }

        if (asset.type === "TURTLENOTE") {
          await processTurtleNoteWithdrawals(asset);
        }

      } catch (err) {

        console.error(
          `[WITHDRAW PROCESSOR ERROR] ${asset.ticker}`,
          err
        );
      }
    }
  }

  return {
    processWithdrawals
  };
};
