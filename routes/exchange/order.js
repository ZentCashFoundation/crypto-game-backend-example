const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const pool = require("../../db");
const balanceService = require("../../services/balanceService")(pool);

router.post("/", auth, async (req, res) => {
  const userId = req.user.id;
  const {
    pair,
    side,
    type,
    price,
    amount
  } = req.body;

  if (!pair || !side || !type || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (type === "limit" && !price) {
    return res.status(400).json({ error: "Price required for limit order" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // -------------------------------------------------
    // 1. LOCK BALANCE
    // -------------------------------------------------
    if (side === "sell") {
      // vendes base asset (BTC en BTC_USDT)
      const baseAsset = pair.split("_")[0];
      await balanceService.lockBalance(conn, userId, baseAsset, amount);
    }

    if (side === "buy") {
      // compras quote asset (USDT en BTC_USDT)
      const quoteAsset = pair.split("_")[1];
      const cost = price * amount;

      await balanceService.lockBalance(conn, userId, quoteAsset, cost);
    }

    // -------------------------------------------------
    // 2. CREATE ORDER
    // -------------------------------------------------
    const [result] = await conn.query(
      `
      INSERT INTO exchange_orders
      (user_id, pair, side, type, price, amount, filled, status)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'open')
      `,
      [userId, pair, side, type, price || null, amount]
    );

    await conn.commit();

    return res.json({
      success: true,
      order_id: result.insertId
    });

  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ error: err.message });

  } finally {
    conn.release();
  }
});

router.delete("/:id", auth, async (req, res) => {
  const userId = req.user.id;
  const orderId = req.params.id;

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // -----------------------------------------
    // 1. OBTENER ORDEN
    // -----------------------------------------
    const [rows] = await conn.query(
      `
      SELECT * FROM exchange_orders
      WHERE id = ? AND user_id = ?
      FOR UPDATE
      `,
      [orderId, userId]
    );

    if (!rows.length) {
      throw new Error("Order not found");
    }

    const order = rows[0];

    // -----------------------------------------
    // 2. VALIDAR ESTADO
    // -----------------------------------------
    if (!["open", "partial"].includes(order.status)) {
      throw new Error("Order cannot be cancelled");
    }

    const [baseAsset, quoteAsset] = order.pair.split("_");

    // -----------------------------------------
    // 3. CALCULAR REMAINING
    // -----------------------------------------
    const remaining = Number(order.amount) - Number(order.filled);

    if (remaining <= 0) {
      throw new Error("Nothing to unlock");
    }

    // -----------------------------------------
    // 4. UNLOCK BALANCE
    // -----------------------------------------
    if (order.side === "sell") {
      // devuelve base asset
      await balanceService.unlockBalance(conn, userId, baseAsset, remaining);
    } else {
      // devuelve quote asset
      const refund = remaining * Number(order.price);
      await balanceService.unlockBalance(conn, userId, quoteAsset, refund);
    }

    // -----------------------------------------
    // 5. ACTUALIZAR ORDEN
    // -----------------------------------------
    await conn.query(
      `
      UPDATE exchange_orders
      SET status = 'cancelled'
      WHERE id = ?
      `,
      [orderId]
    );

    await conn.commit();

    return res.json({ success: true });

  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(400).json({ error: err.message });

  } finally {
    conn.release();
  }
});

router.get("/", auth, async (req, res) => {
  const userId = req.user.id;
  const { status, pair, limit = 50 } = req.query;

  try {

    let query = `
      SELECT 
        id,
        pair,
        side,
        type,
        price,
        amount,
        filled,
        status,
        created_at
      FROM exchange_orders
      WHERE user_id = ?
    `;

    const params = [userId];

    // filtro por estado
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    // filtro por pair
    if (pair) {
      query += " AND pair = ?";
      params.push(pair);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(Number(limit));

    const [rows] = await pool.query(query, params);

    return res.json({ result: rows });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error fetching orders" });
  }
});

module.exports = router;