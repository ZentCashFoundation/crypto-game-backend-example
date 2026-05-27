module.exports = (pool, marketStatsService) => {

  async function updateMarketTable() {

    const [pairs] = await pool.query(`
      SELECT DISTINCT pair
      FROM exchange_trades
    `);

    for (const p of pairs) {

      const pair = p.pair;

      const stats =
        await marketStatsService.compute24hStats(pair);

      if (!stats) continue;

      await pool.query(`
        UPDATE exchange_markets
        SET
          volume_24h = ?,
          high_24h = ?,
          low_24h = ?,
          variation_24h = ?,
          last_price = ?
        WHERE pair = ?
      `, [
        stats.volume24h,
        stats.high24h,
        stats.low24h,
        stats.variation24h,
        stats.lastPrice,
        pair
      ]);
    }
  }

  return {
    updateMarketTable
  };
};