module.exports = (pool) => {

  // -----------------------------------------
  // ENSURE BALANCE EXISTS
  // -----------------------------------------
  async function ensureBalance(conn, userId, asset) {
    await conn.query(
      `
      INSERT IGNORE INTO exchange_balances (user_id, asset_ticker)
      VALUES (?, ?)
      `,
      [userId, asset]
    );
  }

  // -----------------------------------------
  // ADD BALANCE (DEPOSIT)
  // -----------------------------------------
  async function addBalance(conn, userId, asset, amount) {
    await ensureBalance(conn, userId, asset);

    await conn.query(
      `
      INSERT INTO exchange_balances (user_id, asset_ticker, available)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        available = available + VALUES(available)
      `,
      [userId, asset, amount]
    );
  }

  // -----------------------------------------
  // LOCK BALANCE (FOR ORDERS)
  // -----------------------------------------
  async function lockBalance(conn, userId, asset, amount) {
    await ensureBalance(conn, userId, asset);

    const [rows] = await conn.query(
      `
      SELECT available 
      FROM exchange_balances
      WHERE user_id = ? AND asset_ticker = ?
      FOR UPDATE
      `,
      [userId, asset]
    );

    if (!rows.length || Number(rows[0].available) < amount) {
      throw new Error("Insufficient balance");
    }

    await conn.query(
      `
      UPDATE exchange_balances
      SET 
        available = available - ?,
        locked = locked + ?
      WHERE user_id = ? AND asset_ticker = ?
      `,
      [amount, amount, userId, asset]
    );

    await createTransaction(conn, userId, asset, "lock", amount, "Lock Balance For Order", "Lock Balance For Order");

  }

  // -----------------------------------------
  // UNLOCK BALANCE (CANCEL ORDER)
  // -----------------------------------------
  async function unlockBalance(conn, userId, asset, amount) {

  const [rows] = await conn.query(
    `
    SELECT locked
    FROM exchange_balances
    WHERE user_id = ?
      AND asset_ticker = ?
    FOR UPDATE
    `,
    [userId, asset]
  );

  if (!rows.length) {
    throw new Error("Balance not found");
  }

  const locked = Number(rows[0].locked);

  if (locked < amount) {
    throw new Error("Insufficient locked balance");
  }

  await conn.query(
    `
    UPDATE exchange_balances
    SET
      available = available + ?,
      locked = locked - ?
    WHERE user_id = ?
      AND asset_ticker = ?
    `,
    [amount, amount, userId, asset]
  );

  await createTransaction(conn, userId, asset, "unlock", amount, "Unlock Balance For Cancel Order", "Unlock Balance For Cancel Order");
}

async function increaseBalance(conn, userId, asset, amount) {
  await conn.query(
    `
    INSERT INTO exchange_balances
    (user_id, asset_ticker, available, locked)
    VALUES (?, ?, ?, 0)
    ON DUPLICATE KEY UPDATE
      available = available + VALUES(available)
    `,
    [
      userId,
      asset,
      amount
    ]
  );

  await createTransaction(conn, userId, asset, "deposit", amount, "Deposit Internal", "Deposit Internal");
}

async function decreaseLockedBalance(
  conn,
  userId,
  asset,
  amount
) {

  const [rows] = await conn.query(
    `
    SELECT locked
      FROM exchange_balances
      WHERE user_id = ?
      AND asset_ticker = ?
      FOR UPDATE
    `,
    [userId, asset]
  );

  if (!rows.length) {
    throw new Error("Balance not found");
  }

  const locked = Number(rows[0].locked);

  if (locked < amount) {
    throw new Error("Insufficient locked balance");
  }

  await conn.query(
    `
    UPDATE exchange_balances
    SET locked = locked - ?
    WHERE user_id = ?
      AND asset_ticker = ?
    `,
    [amount, userId, asset]
  );
}

async function createTransaction(
  conn,
  userId,
  asset,
  type,
  amount,
  referenceId = null,
  description = null
) {

  await conn.query(
    `
    INSERT INTO exchange_transactions
    (
      user_id,
      asset_ticker,
      type,
      amount,
      reference_id,
      description
    )
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      asset,
      type,
      amount,
      referenceId,
      description
    ]
  );
}

  return {
    ensureBalance,
    addBalance,
    lockBalance,
    unlockBalance,
    increaseBalance,
    decreaseLockedBalance,
    createTransaction
  };
};