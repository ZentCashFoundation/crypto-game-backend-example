const express = require("express");
const cors = require("cors");
const chalk = require("chalk");
const https = require("https");
const fs = require("fs");

require("dotenv").config();

const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const gameRoutes = require("./routes/game");

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/game", gameRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Zent Backend Running" });
});

const sslOptions = {
  key: fs.readFileSync("/etc/letsencrypt/live/api.games.zent.cash/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/api.games.zent.cash/fullchain.pem")
};

const PORT = process.env.PORT || 3000;

https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(chalk.green.bold(`🔒 HTTPS Server running on port ${PORT}`));
});
