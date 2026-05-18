module.exports = () => {

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

  async function processTrade(
    conn,
    pair,
    price,
    amount
  ) {

    const timeframes = [
      "1m",
      "5m",
      "15m",
      "1h",
      "4h",
      "1d"
    ];

    for (const timeframe of timeframes) {

      const openTime =
        getOpenTime(timeframe);

      // -----------------------------------
      // LOAD CANDLE
      // -----------------------------------

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

      // -----------------------------------
      // CREATE
      // -----------------------------------

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
          price,
          price,
          price,
          price,
          amount,
          openTime
        ]);

      } else {

        const candle = rows[0];

        const highPrice = Math.max(
          Number(candle.high_price),
          Number(price)
        );

        const lowPrice = Math.min(
          Number(candle.low_price),
          Number(price)
        );

        const volume =
          Number(candle.volume) +
          Number(amount);

        // -----------------------------------
        // UPDATE
        // -----------------------------------

        await conn.query(`
          UPDATE exchange_candles
          SET
            high_price = ?,
            low_price = ?,
            close_price = ?,
            volume = ?
          WHERE id = ?
        `, [
          highPrice,
          lowPrice,
          price,
          volume,
          candle.id
        ]);
      }
    }
  }

  return {
    processTrade
  };
};
