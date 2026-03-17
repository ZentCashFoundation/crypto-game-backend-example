# 🎮 Crypto Game Backend Example

A simple educational Node.js backend demonstrating how to build a crypto-powered gaming backend.

This project shows how to:

- Register users
- Generate secure 64-character hex Payment IDs
- Verify incoming blockchain payments
- Maintain an internal balance system
- Prevent double-spending
- Track game sessions
- Log transaction history

⚠️ This is an educational example, not production-ready code.

---

# 🚀 Purpose

This repository is meant to inspire developers to build their own crypto-based games and payment systems.

It provides a minimal but structured backend architecture that you can expand into:

- Full gaming platforms
- Play-to-earn systems
- Crypto deposit/withdraw systems
- Microservices architectures

---

# 🏗 Tech Stack

- Node.js
- Express
- MySQL
- JWT Authentication
- bcrypt password hashing
- Axios (wallet API integration)

---

# 📂 Project Structure

```bash
crypto-games-backend-example/
│
├── server.js
├── db.js
├── package.json
├── .env
│
├── middleware/
│   └── auth.js
│
└── routes/
    ├── auth.js
    ├── payment.js
    └── game.js

```

---

# 🔐 Features

## 1️⃣ User Registration

- Secure password hashing
- Automatic Payment ID generation (64 hex characters)
- Internal balance initialization

## 2️⃣ Payment Verification

- Checks blockchain wallet API
- Matches Payment ID
- Prevents double processing
- Updates internal balance
- Stores transaction history

## 3️⃣ Game Session System

- Deducts balance safely
- Prevents negative balance
- Records session cost
- Logs transaction history

---

# 🗄 Database Tables

- users
- payment_requests
- processed_payments
- transaction_history
- game_sessions

---

# ⚙️ Installation

## 1️⃣ Clone repository

```bash
git clone https://github.com/ZentCashFoundation/crypto-game-backend-example.git
cd crypto-game-backend-example

```

## 2️⃣ Install dependencies
```bash
npm install
```

## 3️⃣ Configure environment

Create a .env file:

```bash
PORT=3001
PORT_SSL=3000

SSL_PRIVATEKEY=../privkey.pem
SSL_FULLCHAIN=../fullchain.pem

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=crypto_game

JWT_SECRET=super_secret_key

WALLET_API_URL=http://127.0.0.1:21699
WALLET_RPC_PASSWORD=your_wallet_api_password
ADDRESS=ADDRESS
```


## 4️⃣ Run server

```bash
npm run dev
```

# 🔄 Example Flow

- User registers

- Backend generates unique Payment ID

- User sends crypto payment

- Backend verifies transaction

- Internal balance increases

- User starts game session

- Balance decreases

# 🛡 Security Notes

This example includes:

- Password hashing

- JWT authentication

- Double-payment protection

- Atomic balance deduction

- Transaction logging

However, for real production use you should:

- Add database transactions (BEGIN / COMMIT)

- Add rate limiting

- Add input validation (Joi/Zod)

- Add request logging

- Add monitoring

- Add proper wallet confirmation checks

- Add withdrawal validation logic

# 📈 Ideas to Expand This Project

- Add withdrawals

- Add leaderboard system

- Add admin dashboard

- Add multiple games

- Add WebSocket real-time balance updates

- Convert into microservices

- Add Docker support

- Add CI/CD pipeline

# 🎯 Goal

This project is not meant to be finished.

It is meant to be built upon.

 Take it.
 Break it.
 Improve it.
 Scale it.

# 📜 License

MIT License

You are free to use, modify, and distribute this project.

# 🤝 Contributing

Pull requests are welcome.

If you build something cool on top of this, share it!
