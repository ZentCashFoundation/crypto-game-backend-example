module.exports = (pool, balanceService) => {

  async function updateMarketSnapshot(conn, pair, tradePrice) {

    const [[bid]] = await conn.query(`
      SELECT price
      FROM exchange_orders
      WHERE pair = ?
        AND side = 'buy'
        AND status IN ('open','partial')
      ORDER BY price DESC
      LIMIT 1
    `, [pair]);

    const [[ask]] = await conn.query(`
      SELECT price
      FROM exchange_orders
      WHERE pair = ?
        AND side = 'sell'
        AND status IN ('open','partial')
      ORDER BY price ASC
      LIMIT 1
    `, [pair]);

    await conn.query(`
      UPDATE exchange_markets
      SET
        bid_price = ?,
        ask_price = ?,
        last_price = ?,
        updated_at = NOW()
      WHERE pair = ?
    `, [
      bid?.price ?? null,
      ask?.price ?? null,
      tradePrice,
      pair
    ]);
  }

  async function tryMatch(conn, orderId) {

    // LOAD ORDER
    const [orders] = await conn.query(`
      SELECT *
      FROM exchange_orders
      WHERE id = ?
      LIMIT 1
    `, [orderId]);

    if (!orders.length) {
      throw new Error("Order not found");
    }

    const order = orders[0];

    // LOAD MARKET
    const [marketRows] = await conn.query(`
      SELECT *
      FROM exchange_markets
      WHERE pair = ?
      LIMIT 1
    `, [order.pair]);

    if (!marketRows.length) {
      throw new Error("Market not found");
    }

    const feeRate =
      Number(marketRows[0].taker_fee || 0.002);

    const [baseAsset, quoteAsset] =
      order.pair.split("_");

    let remaining =
      Number(order.amount) - Number(order.filled);

    if (remaining <= 0) return;

    let totalSpent = 0;

    // MATCH LOOP
    while (remaining > 0) {

      let matchQuery = "";
      let params = [];

      // BUY
      if (order.side === "buy") {

        if (order.type === "market") {

          matchQuery = `
            SELECT *
            FROM exchange_orders
            WHERE pair = ?
              AND side = 'sell'
              AND status IN ('open','partial')
              AND id != ?
              AND user_id != ?
            ORDER BY price ASC, created_at ASC
            LIMIT 1
          `;

          params = [
            order.pair,
            order.id,
            order.user_id
          ];

        } else {

          matchQuery = `
            SELECT *
            FROM exchange_orders
            WHERE pair = ?
              AND side = 'sell'
              AND status IN ('open','partial')
              AND price <= ?
              AND id != ?
              AND user_id != ?
            ORDER BY price ASC, created_at ASC
            LIMIT 1
          `;

          params = [
            order.pair,
            order.price,
            order.id,
            order.user_id
          ];
        }

      // SELL
      } else {

        if (order.type === "market") {

          matchQuery = `
            SELECT *
            FROM exchange_orders
            WHERE pair = ?
              AND side = 'buy'
              AND status IN ('open','partial')
              AND id != ?
              AND user_id != ?
            ORDER BY price DESC, created_at ASC
            LIMIT 1
          `;

          params = [
            order.pair,
            order.id,
            order.user_id
          ];

        } else {

          matchQuery = `
            SELECT *
            FROM exchange_orders
            WHERE pair = ?
              AND side = 'buy'
              AND status IN ('open','partial')
              AND price >= ?
              AND id != ?
              AND user_id != ?
            ORDER BY price DESC, created_at ASC
            LIMIT 1
          `;

          params = [
            order.pair,
            order.price,
            order.id,
            order.user_id
          ];
        }
      }

      const [matches] =
        await conn.query(matchQuery, params);

      // NO LIQUIDITY
      if (!matches.length) {
        break;
      }

      const matched = matches[0];

      // TRADE CALC
      const matchedRemaining =
        Number(matched.amount) -
        Number(matched.filled);

      const tradeAmount =
        Math.min(remaining, matchedRemaining);

      const tradePrice =
        Number(matched.price);

      const quoteAmount =
        tradeAmount * tradePrice;

      totalSpent += quoteAmount;

      // FEES
      const buyerFee =
        tradeAmount * feeRate;

      const sellerFee =
        quoteAmount * feeRate;

      const buyerNet =
        tradeAmount - buyerFee;

      const sellerNet =
        quoteAmount - sellerFee;

      // ORDER STATES
      const orderNewFilled =
        Number(order.filled) + tradeAmount;

      const matchedNewFilled =
        Number(matched.filled) + tradeAmount;

      let orderStatus = "open";

      if (orderNewFilled > 0) {
        orderStatus = "partial";
      }

      if (orderNewFilled >= Number(order.amount)) {
        orderStatus = "filled";
      }

      let matchedStatus = "open";

      if (matchedNewFilled > 0) {
        matchedStatus = "partial";
      }

      if (matchedNewFilled >= Number(matched.amount)) {
        matchedStatus = "filled";
      }

      // UPDATE ORDERS
      await conn.query(`
        UPDATE exchange_orders
        SET
          filled = ?,
          status = ?
        WHERE id = ?
      `, [
        orderNewFilled,
        orderStatus,
        order.id
      ]);

      await conn.query(`
        UPDATE exchange_orders
        SET
          filled = ?,
          status = ?
        WHERE id = ?
      `, [
        matchedNewFilled,
        matchedStatus,
        matched.id
      ]);

      // UPDATE MEMORY
      order.filled = orderNewFilled;
      matched.filled = matchedNewFilled;

      // TRADE INSERT
      const buyOrder =
        order.side === "buy"
          ? order
          : matched;

      const sellOrder =
        order.side === "sell"
          ? order
          : matched;

      const [tradeResult] = await conn.query(`
        INSERT INTO exchange_trades
        (
          pair,
          buy_order_id,
          sell_order_id,
          buyer_user_id,
          seller_user_id,
          price,
          amount,
          buyer_fee,
          seller_fee
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        order.pair,
        buyOrder.id,
        sellOrder.id,
        buyOrder.user_id,
        sellOrder.user_id,
        tradePrice,
        tradeAmount,
        buyerFee,
        sellerFee
      ]);

      const tradeId =
        tradeResult.insertId;

      await updateMarketSnapshot(
        conn,
        order.pair,
        tradePrice
      );

      // BUYER
      await balanceService.decreaseLockedBalance(
        conn,
        buyOrder.user_id,
        quoteAsset,
        quoteAmount
      );

      await balanceService.increaseBalance(
        conn,
        buyOrder.user_id,
        baseAsset,
        buyerNet
      );

      // SELLER
      await balanceService.decreaseLockedBalance(
        conn,
        sellOrder.user_id,
        baseAsset,
        tradeAmount
      );

      await balanceService.increaseBalance(
        conn,
        sellOrder.user_id,
        quoteAsset,
        sellerNet
      );

      // TRANSACTIONS
      await balanceService.createTransaction(
        conn,
        buyOrder.user_id,
        quoteAsset,
        "trade_out",
        quoteAmount,
        tradeId
      );

      await balanceService.createTransaction(
        conn,
        buyOrder.user_id,
        baseAsset,
        "trade_in",
        buyerNet,
        tradeId
      );

      await balanceService.createTransaction(
        conn,
        sellOrder.user_id,
        baseAsset,
        "trade_out",
        tradeAmount,
        tradeId
      );

      await balanceService.createTransaction(
        conn,
        sellOrder.user_id,
        quoteAsset,
        "trade_in",
        sellerNet,
        tradeId
      );

      // FEES
      await balanceService.createTransaction(
        conn,
        buyOrder.user_id,
        baseAsset,
        "fee",
        buyerFee,
        tradeId
      );

      await balanceService.createTransaction(
        conn,
        sellOrder.user_id,
        quoteAsset,
        "fee",
        sellerFee,
        tradeId
      );

      // LOOP UPDATE
      remaining -= tradeAmount;
    }

    // MARKET ORDER CLEANUP
    if (order.type === "market" && remaining > 0) {

      // SELL MARKET
      if (order.side === "sell") {

        await balanceService.unlockBalance(
          conn,
          order.user_id,
          baseAsset,
          remaining
        );

      // BUY MARKET
      } else {

        const lockedUnused =
          (Number(order.amount) * Number(order.price || 0))
          - totalSpent;

        if (lockedUnused > 0) {

          await balanceService.unlockBalance(
            conn,
            order.user_id,
            quoteAsset,
            lockedUnused
          );
        }
      }

      await conn.query(`
        UPDATE exchange_orders
        SET status = 'cancelled'
        WHERE id = ?
      `, [order.id]);
    }
  }

  return {
    tryMatch
  };
};