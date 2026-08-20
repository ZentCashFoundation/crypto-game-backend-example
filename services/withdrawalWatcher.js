module.exports = (pool) => {

  // =========================================================
  // UTXO
  // =========================================================
  async function scanUTXOWithdrawalConfirmations(asset) {

    let rpcUrl = asset.rpc_url;

    if (
      !rpcUrl.startsWith("http://") &&
      !rpcUrl.startsWith("https://")
    ) {
      rpcUrl = "http://" + rpcUrl;
    }

    // -----------------------------------------
    // LOAD BROADCASTED WITHDRAWALS
    // -----------------------------------------
    const [withdrawals] = await pool.query(
      `
      SELECT *
      FROM exchange_withdrawals
      WHERE asset_ticker = ?
        AND status = 'broadcasted'
      `,
      [asset.ticker]
    );

    for (const withdrawal of withdrawals) {

      try {

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
            body: JSON.stringify({
              jsonrpc: "1.0",
              id: "withdraw-check",
              method: "gettransaction",
              params: [
                withdrawal.tx_hash
              ]
            }),
            signal: AbortSignal.timeout(30000)
          }
        );

        if (!response.ok) {
          continue;
        }

        const data = await response.json();

        if (
          data.error ||
          !data.result
        ) {
          continue;
        }

        const confirmations =
          Number(
            data.result.confirmations || 0
          );

        await pool.query(
          `
          UPDATE exchange_withdrawals
          SET confirmations = ?
          WHERE id = ?
          `,
          [
            confirmations,
            withdrawal.id
          ]
        );

        if (
          confirmations >=
          Number(asset.confirmations_required || 1)
        ) {

          await pool.query(
            `
            UPDATE exchange_withdrawals
            SET
              status = 'confirmed',
              confirmed_at = NOW()
            WHERE id = ?
            `,
            [withdrawal.id]
          );

          console.log(
            `[UTXO WITHDRAW CONFIRMED] ${asset.ticker} ${withdrawal.tx_hash}`
          );
        }

      } catch (err) {

        console.error(
          `[UTXO WITHDRAW WATCHER ERROR] ${asset.ticker}`,
          err.message
        );
      }
    }
  }

  // =========================================================
  // CRYPTONOTE / MONERO
  // =========================================================
  async function scanCryptonoteWithdrawalConfirmations(asset) {

    let rpcUrl = asset.rpc_url;

    if (
      !rpcUrl.startsWith("http://") &&
      !rpcUrl.startsWith("https://")
    ) {
      rpcUrl = "http://" + rpcUrl;
    }

    // -----------------------------------------
    // LOAD BROADCASTED WITHDRAWALS
    // -----------------------------------------
    const [withdrawals] = await pool.query(
      `
      SELECT *
      FROM exchange_withdrawals
      WHERE asset_ticker = ?
        AND status = 'broadcasted'
      `,
      [asset.ticker]
    );

    for (const withdrawal of withdrawals) {

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
              method: "get_transfer_by_txid",
              params: {
                txid: withdrawal.tx_hash,
                account_index: 0
              }
            }),
            signal: AbortSignal.timeout(30000)
          }
        );

        if (!response.ok) {
          continue;
        }

        const data = await response.json();

        if (
          data.error ||
          !data.result
        ) {
          continue;
        }

        const transfer =
          data.result.transfer;

        if (!transfer) {
          continue;
        }

        const confirmations =
          Number(
            transfer.confirmations || 0
          );

        await pool.query(
          `
          UPDATE exchange_withdrawals
          SET confirmations = ?
          WHERE id = ?
          `,
          [
            confirmations,
            withdrawal.id
          ]
        );

        if (
          confirmations >=
          Number(asset.confirmations_required || 10)
        ) {

          await pool.query(
            `
            UPDATE exchange_withdrawals
            SET
              status = 'confirmed',
              confirmed_at = NOW()
            WHERE id = ?
            `,
            [withdrawal.id]
          );

          console.log(
            `[CRYPTONOTE WITHDRAW CONFIRMED] ${asset.ticker} ${withdrawal.tx_hash}`
          );
        }

      } catch (err) {

        console.error(
          `[CRYPTONOTE WITHDRAW WATCHER ERROR] ${asset.ticker}`,
          err.message
        );
      }
    }
  }

  // =========================================================
  // TURTLENOTE
  // =========================================================
  async function scanTurtleNoteWithdrawalConfirmations(asset) {

    let rpcUrl = asset.rpc_url;

    if (
      !rpcUrl.startsWith("http://") &&
      !rpcUrl.startsWith("https://")
    ) {
      rpcUrl = "http://" + rpcUrl;
    }

    // -----------------------------------------
    // GET NETWORK HEIGHT
    // -----------------------------------------
    let networkBlockCount = 0;

    try {

      const statusResponse = await fetch(
        rpcUrl + "/status",
        {
          method: "GET",
          headers: {
            "X-API-KEY":
              process.env.WALLET_RPC_PASSWORD
          },
          signal: AbortSignal.timeout(30000)
        }
      );

      if (!statusResponse.ok) {

        console.error(
          `[TURTLENOTE STATUS ERROR] ${asset.ticker}`
        );

        return;
      }

      const statusData =
        await statusResponse.json();

      networkBlockCount =
        Number(
          statusData.networkBlockCount || 0
        );

    } catch (err) {

      console.error(
        `[TURTLENOTE STATUS ERROR] ${asset.ticker}`,
        err.message
      );

      return;
    }

    // -----------------------------------------
    // LOAD BROADCASTED WITHDRAWALS
    // -----------------------------------------
    const [withdrawals] = await pool.query(
      `
      SELECT *
      FROM exchange_withdrawals
      WHERE asset_ticker = ?
        AND status = 'broadcasted'
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

      try {

        const response = await fetch(
          rpcUrl +
          "/transactions/hash/" +
          withdrawal.tx_hash,
          {
            method: "GET",
            headers: {
              "X-API-KEY":
                process.env.WALLET_RPC_PASSWORD
            },
            signal: AbortSignal.timeout(30000)
          }
        );

        if (!response.ok) {

          console.error(
            `[TURTLENOTE TX ERROR] ${asset.ticker} ${withdrawal.tx_hash}`
          );

          continue;
        }

        const data = await response.json();

        const tx =
          data.transaction;

        if (!tx) {
          continue;
        }

        // -----------------------------------------
        // CALCULATE CONFIRMATIONS
        // -----------------------------------------
        const txHeight =
          Number(tx.blockHeight || 0);

        let confirmations = 0;

        if (
          networkBlockCount > 0 &&
          txHeight > 0
        ) {
          confirmations =
            networkBlockCount - txHeight;
        }

        if (confirmations < 0) {
          confirmations = 0;
        }

        // -----------------------------------------
        // UPDATE CONFIRMATIONS
        // -----------------------------------------
        await pool.query(
          `
          UPDATE exchange_withdrawals
          SET confirmations = ?
          WHERE id = ?
          `,
          [
            confirmations,
            withdrawal.id
          ]
        );

        // -----------------------------------------
        // CONFIRMED
        // -----------------------------------------
        if (
          confirmations >=
          Number(asset.confirmations_required || 10)
        ) {

          await pool.query(
            `
            UPDATE exchange_withdrawals
            SET
              status = 'confirmed',
              confirmed_at = NOW()
            WHERE id = ?
            `,
            [withdrawal.id]
          );

          console.log(
            `[TURTLENOTE WITHDRAW CONFIRMED] ${asset.ticker} ${withdrawal.tx_hash}`
          );
        }

      } catch (err) {

        console.error(
          `[TURTLENOTE WITHDRAW WATCHER ERROR] ${asset.ticker}`,
          err.message
        );
      }
    }
  }

  async function scanZanoNoteWithdrawalConfirmations(asset) {

    let rpcUrl = asset.rpc_url;

    if (
      !rpcUrl.startsWith("http://") &&
      !rpcUrl.startsWith("https://")
    ) {
      rpcUrl = "http://" + rpcUrl;
    }

    // -----------------------------------------
    // LOAD BROADCASTED WITHDRAWALS
    // -----------------------------------------
    const [withdrawals] = await pool.query(
      `
      SELECT *
      FROM exchange_withdrawals
      WHERE asset_ticker = ?
        AND status = 'broadcasted'
      `,
      [asset.ticker]
    );

    if (!withdrawals.length) {
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
    // PROCESS EACH WITHDRAWAL
    // -----------------------------------------
    for (const withdrawal of withdrawals) {

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
              method: "search_for_transactions",
              params: {
                tx_id: withdrawal.tx_hash,
                in: false,
                out: true,
                pool: false
              }
            }),
            signal: AbortSignal.timeout(30000)
          }
        );

        if (!response.ok) {
          continue;
        }

        const data = await response.json();

        if (data.error) {
          continue;
        }

        const outTransfers = data.result?.out || [];

        const transfer = outTransfers.find(
          t => t.tx_hash === withdrawal.tx_hash
        );

        // -----------------------------------------
        // NOT FOUND YET (still in pool / not synced)
        // -----------------------------------------
        if (!transfer) {
          continue;
        }

        const blockHeight = Number(transfer.height || 0);

        const confirmations =
          blockHeight > 0
            ? Math.max(0, currentHeight - blockHeight)
            : 0;

        await pool.query(
          `
          UPDATE exchange_withdrawals
          SET confirmations = ?
          WHERE id = ?
          `,
          [
            confirmations,
            withdrawal.id
          ]
        );

        if (
          confirmations >=
          Number(asset.confirmations_required || 10)
        ) {

          await pool.query(
            `
            UPDATE exchange_withdrawals
            SET
              status = 'confirmed',
              confirmed_at = NOW()
            WHERE id = ?
            `,
            [withdrawal.id]
          );

          console.log(
            `[ZANONOTE WITHDRAW CONFIRMED] ${asset.ticker} ${withdrawal.tx_hash}`
          );
        }

      } catch (err) {

        console.error(
          `[ZANONOTE WITHDRAW WATCHER ERROR] ${asset.ticker}`,
          err.message
        );
      }
    }
  }


  // =========================================================
  // MAIN
  // =========================================================
  async function scanWithdrawalConfirmations() {

    const [assets] = await pool.query(
      `
      SELECT *
      FROM exchange_assets
      WHERE withdraw_enabled = 1
      `
    );

    for (const asset of assets) {

      try {

        if (asset.type === "UTXO") {
          await scanUTXOWithdrawalConfirmations(asset);
        }

        if (asset.type === "CRYPTONOTE") {
          await scanCryptonoteWithdrawalConfirmations(asset);
        }

        if (asset.type === "TURTLENOTE") {
          await scanTurtleNoteWithdrawalConfirmations(asset);
        }

        if (asset.type === "ZANONOTE") {
          await scanZanoNoteWithdrawalConfirmations(asset);
        }

      } catch (err) {

        console.error(
          `[WITHDRAW WATCHER ERROR] ${asset.ticker}`,
          err
        );
      }
    }
  }

  return {
    scanWithdrawalConfirmations
  };
};