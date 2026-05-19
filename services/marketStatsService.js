
module.exports = (pool) => {

  async function compute24hStats(pair) {

    const [trades] = await pool.query(`
      SELECT price, amount, created_at
      FROM exchange_trades
      WHERE pair = ?
        AND created_at >= NOW() - INTERVAL 24 HOUR
      ORDER BY created_at ASC
    `, [pair]);

    if (!trades.length) {
      return null;
    }

    let volume24h = 0;
    let high24h = Number(trades[0].price);
    let low24h = Number(trades[0].price);

    const firstPrice = Number(trades[0].price);
    const lastPrice = Number(trades[trades.length - 1].price);

    for (const t of trades) {

      const price = Number(t.price);
      const amount = Number(t.amount);

      volume24h += amount;

      if (price > high24h) high24h = price;
      if (price < low24h) low24h = price;
    }

    const variation24h =
      firstPrice === 0
        ? 0
        : ((lastPrice - firstPrice) / firstPrice) * 100;

    return {
      volume24h,
      high24h,
      low24h,
      variation24h,
      lastPrice
    };
  }

  return {
    compute24hStats
  };
};