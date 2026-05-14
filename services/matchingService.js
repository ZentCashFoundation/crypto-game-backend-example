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

    // -----------------------------------------
    // LOAD MARKET (FEES)
    // -----------------------------------------
    const [marketRows] = await conn.query(
      `
      SELECT *
      FROM exchange_markets
      WHERE pair = ?
      LIMIT 1
      `,
      [order.pair]
    );

    if (!marketRows.length) {
      throw new Error("Market not found");
    }

    const market = marketRows[0];
    const feeRate = Number(market.taker_fee || 0.002);

    // remaining amount
    let remaining =
      Number(order.amount) - Number(order.filled);

    if (remaining <= 0) return;

    const [baseAsset, quoteAsset] =
      order.pair.split("_");

    // -----------------------------------------
    // 2. MATCH LOOP
    // -----------------------------------------
    while (remaining > 0) {

      let matchQuery = "";
      let params = [];

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

      if (!matches.length) break;

      const matched = matches[0];

      // -----------------------------------------
      // 3. TRADE CALC
      // -----------------------------------------
      const matchedRemaining =
        Number(matched.amount) - Number(matched.filled);

      const tradeAmount = Math.min(
        remaining,
        matchedRemaining
      );

      const tradePrice = Number(matched.price);
      const quoteAmount = tradeAmount * tradePrice;

      // -----------------------------------------
      // FEES
      // -----------------------------------------
      const buyerFee = tradeAmount * feeRate;
      const sellerFee = quoteAmount * feeRate;

      const buyerNet = tradeAmount - buyerFee;
      const sellerNet = quoteAmount - sellerFee;

      // -----------------------------------------
      // 4. UPDATE ORDERS
      // -----------------------------------------
      const newOrderFilled =
        Number(order.filled) + tradeAmount;

      const newMatchedFilled =
        Number(matched.filled) + tradeAmount;

      await conn.query(
        `
        UPDATE exchange_orders
        SET filled = ?,
            status = IF(filled + ? >= amount, 'filled', 'partial')
        WHERE id = ?
        `,
        [newOrderFilled, tradeAmount, order.id]
      );

      await conn.query(
        `
        UPDATE exchange_orders
        SET filled = ?,
            status = IF(filled + ? >= amount, 'filled', 'partial')
        WHERE id = ?
        `,
        [newMatchedFilled, tradeAmount, matched.id]
      );

      // -----------------------------------------
      // 5. INSERT TRADE
      // -----------------------------------------
      const buyOrder =
        order.side === "buy" ? order : matched;

      const sellOrder =
        order.side === "sell" ? order : matched;

      const [tradeResult] = await conn.query(
        `
        INSERT INTO exchange_trades
        (
          pair,
          buy_order_id,
          sell_order_id,
          buyer_user_id,
          seller_user_id,
          price,
          amount,
          fee
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          order.pair,
          buyOrder.id,
          sellOrder.id,
          buyOrder.user_id,
          sellOrder.user_id,
          tradePrice,
          tradeAmount,
          buyerFee + sellerFee
        ]
      );

      const tradeId = tradeResult.insertId;

      // -----------------------------------------
      // 6. MOVE BALANCES + TRANSACTIONS
      // -----------------------------------------

      // BUYER (TAKER)
      await balanceService.decreaseLockedBalance(
        conn,
        buyOrder.user_id,
        quoteAsset,
        quoteAmount
      );

      await balanceService.createTransaction(
        conn,
        buyOrder.user_id,
        quoteAsset,
        "trade_out",
        quoteAmount,
        tradeId,
        `buy trade ${order.pair}`
      );

      await balanceService.increaseBalance(
        conn,
        buyOrder.user_id,
        baseAsset,
        buyerNet
      );

      await balanceService.createTransaction(
        conn,
        buyOrder.user_id,
        baseAsset,
        "trade_in",
        buyerNet,
        tradeId,
        `buy trade ${order.pair}`
      );

      await balanceService.createTransaction(
        conn,
        buyOrder.user_id,
        baseAsset,
        "fee",
        buyerFee,
        tradeId,
        `taker fee ${order.pair}`
      );

      // SELLER (MAKER)
      await balanceService.decreaseLockedBalance(
        conn,
        sellOrder.user_id,
        baseAsset,
        tradeAmount
      );

      await balanceService.createTransaction(
        conn,
        sellOrder.user_id,
        baseAsset,
        "trade_out",
        tradeAmount,
        tradeId,
        `sell trade ${order.pair}`
      );

      await balanceService.increaseBalance(
        conn,
        sellOrder.user_id,
        quoteAsset,
        sellerNet
      );

      await balanceService.createTransaction(
        conn,
        sellOrder.user_id,
        quoteAsset,
        "trade_in",
        sellerNet,
        tradeId,
        `sell trade ${order.pair}`
      );

      await balanceService.createTransaction(
        conn,
        sellOrder.user_id,
        quoteAsset,
        "fee",
        sellerFee,
        tradeId,
        `maker fee ${order.pair}`
      );

      // -----------------------------------------
      // 7. LOOP UPDATE
      // -----------------------------------------
      remaining -= tradeAmount;
      order.filled = newOrderFilled;
    }
  }

  return {
    tryMatch
  };
};