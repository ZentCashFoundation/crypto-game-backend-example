module.exports = () => {

  const timeframes = [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h",
    "1d"
  ];

  function getOpenTime(timeframe) {

    const now = Math.floor(Date.now() / 1000);

    switch (timeframe) {

      case "1m":
        return Math.floor(now / 60) * 60;

      case "5m":
        return Math.floor(now / 300) * 300;

      case "15m":
        return Math.floor(now / 900) * 900;

      case "1h":
        return Math.floor(now / 3600) * 3600;

      case "4h":
        return Math.floor(now / 14400) * 14400;

      case "1d":
        return Math.floor(now / 86400) * 86400;

      default:
        throw new Error("Invalid timeframe");
    }
  }

  async function fillCandles(conn) {

    // 1. GET ALL PAIRS
    const [pairs] = await conn.query(`
      SELECT DISTINCT pair
      FROM exchange_markets
    `);

    for (const row of pairs) {

      const pair = row.pair;

      // 2. GET LAST PRICE (fallback market snapshot)
      const [[market]] = await conn.query(`
        SELECT last_price
        FROM exchange_markets
        WHERE pair = ?
        LIMIT 1
      `, [pair]);

      const lastPrice = Number(market?.last_price || 0);

      if (lastPrice <= 0) continue;

      for (const timeframe of timeframes) {

        const openTime = getOpenTime(timeframe);

        // 3. CHECK CANDLE EXISTS
        const [rows] = await conn.query(`
          SELECT *
          FROM exchange_candles
          WHERE pair = ?
            AND timeframe = ?
            AND open_time = ?
          LIMIT 1
        `, [
          pair,
          timeframe,
          openTime
        ]);

        // 4. CREATE FLAT CANDLE IF NOT EXISTS
        if (!rows.length) {

          await conn.query(`
            INSERT INTO exchange_candles
            (
              pair,
              timeframe,
              open_price,
              high_price,
              low_price,
              close_price,
              volume,
              open_time
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            pair,
            timeframe,
            lastPrice,
            lastPrice,
            lastPrice,
            lastPrice,
            0,
            openTime
          ]);
        }
      }
    }
  }

  return {
    fillCandles
  };
};