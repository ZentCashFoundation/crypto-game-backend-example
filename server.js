const express = require("express");
const cors = require("cors");
const chalk = require("chalk");
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.green.bold(`🚀 Server running on port ${PORT}`));
});
