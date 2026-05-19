
module.exports = (pool, marketStatsService) => {

  async function updateMarketTable() {

    const [pairs] = await pool.query(`
      SELECT DISTINCT pair FROM exchange_trades
    `);

    for (const p of pairs) {

      const pair = p.pair;

      const stats =
        await marketStatsService.compute24hStats(pair);

      if (!stats) continue;

      await pool.query(`
        INSERT INTO exchange_markets (
          pair,
          volume_24h,
          high_24h,
          low_24h,
          variation_24h,
          last_price
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          volume_24h = VALUES(volume_24h),
          high_24h = VALUES(high_24h),
          low_24h = VALUES(low_24h),
          variation_24h = VALUES(variation_24h),
          last_price = VALUES(last_price)
      `, [
        pair,
        stats.volume24h,
        stats.high24h,
        stats.low24h,
        stats.variation24h,
        stats.lastPrice
      ]);
    }
  }

  return {
    updateMarketTable
  };
};