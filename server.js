const express = require("express");
const cors = require("cors");
const chalk = require("chalk");
const http = require('http');
const https = require("https");
const fs = require("fs");

require("dotenv").config();

const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const gameRoutes = require("./routes/game");
const exchangeRoutes = require("./routes/exchange");

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/exchange", exchangeRoutes);


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
