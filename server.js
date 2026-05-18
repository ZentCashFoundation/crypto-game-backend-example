const express = require("express");
const cors = require("cors");
const chalk = require("chalk");
const http = require('http');
const https = require("https");
const fs = require("fs");

require("dotenv").config();
const pool = require("./db");
const balanceService = require("./services/balanceService")(pool);
const depositWatcher = require("./services/depositWatcher")(pool , balanceService);
const withdrawalProcessor = require("./services/withdrawalProcessor")(pool, balanceService);
const withdrawalWatcher =  require("./services/withdrawalWatcher")(pool);
const authRoutes = require("./routes/auth");
const gameswalletRoutes = require("./routes/games/wallet");
const gamesgameRoutes = require("./routes/games/game");
const assetRoutes = require("./routes/exchange/asset")
const exchangemarketRoutes = require("./routes/exchange/market");
const exchangewalletRoutes = require("./routes/exchange/wallet");
const orderRoutes = require("./routes/exchange/order");
const tradeRoutes = require("./routes/exchange/trade");
const auditRoutes = require("./routes/exchange/audit");
const candleFillerService = require("./services/candleFillerService")();

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/games/wallet", gameswalletRoutes);
app.use("/api/games/game", gamesgameRoutes);
app.use("/api/exchange/asset", assetRoutes);
app.use("/api/exchange/market", exchangemarketRoutes);
app.use("/api/exchange/wallet", exchangewalletRoutes);
app.use("/api/exchange/order", orderRoutes);
app.use("/api/exchange/trade", tradeRoutes);
app.use("/api/exchange/audit", auditRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Crypto Game Backend Example API Running" });
});

app.get("/api/exchange", (req, res) => {
  res.json({ message: "Crypto Exchange Backend" });
});

if (process.env.SSL_PRIVATEKEY && process.env.SSL_FULLCHAIN) {
  var sslOptions = {
    key: fs.readFileSync(process.env.SSL_PRIVATEKEY),
    cert: fs.readFileSync(process.env.SSL_FULLCHAIN)
  };
}  

const PORT_SSL = process.env.PORT_SSL || 3000;
const PORT = process.env.PORT || 3001;

http.createServer(app).listen(PORT, () => {
  console.log(chalk.green.bold(`🚀 HTTP Server running on port ${PORT}`));
});

if (process.env.SSL_PRIVATEKEY && process.env.SSL_FULLCHAIN) {
  https.createServer(sslOptions, app).listen(PORT_SSL, () => {
    console.log(chalk.green.bold(`🔒 HTTPS Server running on port ${PORT_SSL}`));
  });
}

setInterval(async () => {

  try {

    await depositWatcher.scanDeposits();

  } catch (err) {

    console.error(err);
  }

}, 15000);

setInterval(async () => {

  try {

    await withdrawalProcessor.processWithdrawals();

  } catch (err) {

    console.error(err);
  }

}, 15000);

setInterval(async () => {

  try {

    await withdrawalWatcher.scanWithdrawalConfirmations();

  } catch (err) {

    console.error(
      "[WITHDRAW WATCHER FATAL ERROR]",
      err
    );
  }

}, 30000);

setInterval(async () => {

  try {
    await candleFillerService.fillCandles(pool);

  } catch (err) {
    console.error("candle filler error:", err);
  }

}, 60 * 1000);
