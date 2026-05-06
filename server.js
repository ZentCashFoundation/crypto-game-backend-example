const express = require("express");
const cors = require("cors");
const chalk = require("chalk");
const http = require('http');
const https = require("https");
const fs = require("fs");

require("dotenv").config();

const authRoutes = require("./routes/auth");
const gameswalletRoutes = require("./routes/games/wallet");
const gamesgameRoutes = require("./routes/games/game");
const exchangemarketRoutes = require("./routes/exchange/market");
const exchangewalletRoutes = require("./routes/exchange/wallet");
const orderRoutes = require("./routes/exchange/order");

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/games/wallet", gameswalletRoutes);
app.use("/api/games/game", gamesgameRoutes);
app.use("/api/exchange/market", exchangemarketRoutes);
app.use("/api/exchange/wallet", exchangewalletRoutes);
app.use("/api/exchange/order", orderRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Crypto Game Backend Example API Running" });
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
