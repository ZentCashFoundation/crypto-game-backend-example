module.exports = (pool, balanceService) => {

  async function tryMatch(conn, orderId) {

    // -----------------------------------------
    // 1. LOAD ORDER
    // -----------------------------------------
    const [orders] = await conn.query(
      `
      SELECT *
      FROM exchange_orders
      WHERE id = ?
      LIMIT 1
      `,
      [orderId]
    );

    if (!orders.length) {
      throw new Error("Order not found");
    }

    const order = orders[0];

    // remaining amount
    let remaining =
      Number(order.amount) - Number(order.filled);

    if (remaining <= 0) {
      return;
    }

    const [baseAsset, quoteAsset] =
      order.pair.split("_");

    // -----------------------------------------
    // 2. MATCH LOOP
    // -----------------------------------------
    while (remaining > 0) {

      let matchQuery = "";
      let params = [];

      // BUY ORDER
      if (order.side === "buy") {

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

      } else {

        // SELL ORDER
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

      const [matches] = await conn.query(matchQuery, params);

      if (!matches.length) {
        break;
      }

      const matched = matches[0];

      // -----------------------------------------
      // 3. CALCULATE TRADE
      // -----------------------------------------
      const matchedRemaining =
        Number(matched.amount) - Number(matched.filled);

      const tradeAmount = Math.min(
        remaining,
        matchedRemaining
      );

      const tradePrice = Number(matched.price);

      // -----------------------------------------
      // 4. UPDATE FILLED
      // -----------------------------------------
      const newOrderFilled =
        Number(order.filled) + tradeAmount;

      const newMatchedFilled =
        Number(matched.filled) + tradeAmount;

      const orderStatus =
        newOrderFilled >= Number(order.amount)
          ? "filled"
          : "partial";

      const matchedStatus =
        newMatchedFilled >= Number(matched.amount)
          ? "filled"
          : "partial";

      await conn.query(
        `
        UPDATE exchange_orders
        SET filled = ?, status = ?
        WHERE id = ?
        `,
        [newOrderFilled, orderStatus, order.id]
      );

      await conn.query(
        `
        UPDATE exchange_orders
        SET filled = ?, status = ?
        WHERE id = ?
        `,
        [newMatchedFilled, matchedStatus, matched.id]
      );

      // -----------------------------------------
      // 5. INSERT TRADE
      // -----------------------------------------
      const buyOrder =
        order.side === "buy" ? order : matched;

      const sellOrder =
        order.side === "sell" ? order : matched;

      await conn.query(
        `
        INSERT INTO exchange_trades
        (
          pair,
          buy_order_id,
          sell_order_id,
          buyer_user_id,
          seller_user_id,
          price,
          amount
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          order.pair,
          buyOrder.id,
          sellOrder.id,
          buyOrder.user_id,
          sellOrder.user_id,
          tradePrice,
          tradeAmount
        ]
      );

      // -----------------------------------------
      // 6. MOVE BALANCES
      // -----------------------------------------
      const quoteAmount =
        tradeAmount * tradePrice;

      // buyer
      await balanceService.decreaseLockedBalance(
        conn,
        buyOrder.user_id,
        quoteAsset,
        quoteAmount
      );

      await balanceService.createTransaction( conn, buyOrder.user_id, quoteAsset, "trade_out", quoteAmount );

      await balanceService.increaseBalance(
        conn,
        buyOrder.user_id,
        baseAsset,
        tradeAmount
      );

      await balanceService.createTransaction( conn, buyOrder.user_id, baseAsset, "trade_in", tradeAmount );

      // seller
      await balanceService.decreaseLockedBalance(
        conn,
        sellOrder.user_id,
        baseAsset,
        tradeAmount
      );

      await balanceService.createTransaction( conn, sellOrder.user_id, baseAsset, "trade_out", tradeAmount );

      await balanceService.increaseBalance(
        conn,
        sellOrder.user_id,
        quoteAsset,
        quoteAmount
      );

      await balanceService.createTransaction( conn, sellOrder.user_id, quoteAsset, "trade_in", quoteAmount );

      // -----------------------------------------
      // 7. UPDATE LOOP STATE
      // -----------------------------------------
      remaining -= tradeAmount;

      // IMPORTANT: refresh order filled in memory
      order.filled = newOrderFilled;
    }
  }

  return {
    tryMatch
  };
};