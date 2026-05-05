CREATE DATABASE IF NOT EXISTS crypto_game;
USE crypto_game;

/* This table stores the user information, including email, username, password, role, and account status. */
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(255) UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL
);

/**
*
* Tables for game ecosystem
*
**/

/* This table stores the game wallets for each user, including the balance and payment ID. */
CREATE TABLE IF NOT EXISTS game_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  balance DECIMAL(30,14) DEFAULT 0,
  payment_id CHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

/* This table stores the processed payments to prevent double processing. */
CREATE TABLE IF NOT EXISTS game_processed_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  payment_id CHAR(64) NOT NULL,
  amount DECIMAL(30,14) NOT NULL,
  tx_hash VARCHAR(128) NOT NULL UNIQUE,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

/* This table stores the transaction history for deposits, withdrawals, and game plays. */
CREATE TABLE IF NOT EXISTS game_transaction_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('deposit','withdraw','play') NOT NULL,
  amount DECIMAL(30,14) NOT NULL,
  reference_id VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

/* This table stores the available games and their costs. */
CREATE TABLE IF NOT EXISTS games (
  name VARCHAR(50) NOT NULL UNIQUE,
  cost DECIMAL(30,14) NOT NULL
);

/* This table stores the game sessions for each user, including the game played, cost, and score. */
CREATE TABLE IF NOT EXISTS game_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  game VARCHAR(50),
  cost DECIMAL(30,14) NOT NULL,
  score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

/* Insert initial game data with upsert to avoid duplicates */
INSERT INTO games (name, cost) VALUES
('tetris', 20.00),
('pacman', 20.00),
('snake', 3.00),
('lamboraider', 3.00)
ON DUPLICATE KEY UPDATE
cost = VALUES(cost);


/** 
*
*   Tables for exchange 
*
**/

/* This table store the exchange assets */ 
CREATE TABLE IF NOT EXISTS exchange_assets (
  ticker VARCHAR(20) PRIMARY KEY,
  name VARCHAR(50),
  type ENUM('UTXO','ACCOUNT','CRYPTONOTE','FORKNOTE','TURTLENOTE') NOT NULL,
  network_default VARCHAR(20) DEFAULT 'mainnet',
  rpc_url VARCHAR(255),
  decimals INT DEFAULT 8,
  contract_address VARCHAR(255),
  requires_memo BOOLEAN DEFAULT 0
);

/* This table stores the exchange wallet addresses for each user and asset. */
CREATE TABLE IF NOT EXISTS exchange_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  asset_ticker VARCHAR(20) NOT NULL,
  network VARCHAR(20) NOT NULL DEFAULT 'mainnet',
  address VARCHAR(255) NOT NULL,
  payment_id VARCHAR(64) DEFAULT NULL,
  integrated_address VARCHAR(255) DEFAULT NULL,
  memo VARCHAR(128) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, asset_ticker, network),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_ticker) REFERENCES exchange_assets(ticker)
);

/* This table stores the current market prices for each trading pair. */
CREATE TABLE IF NOT EXISTS exchange_market_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pair VARCHAR(20) NOT NULL UNIQUE,
  last_price DECIMAL(30,14) NOT NULL,
  bid_price DECIMAL(30,14) DEFAULT NULL,
  ask_price DECIMAL(30,14) DEFAULT NULL,
  spread DECIMAL(30,14) GENERATED ALWAYS AS (ask_price - bid_price) STORED,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

/* This table store orders book */
CREATE TABLE exchange_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  pair VARCHAR(20) NOT NULL,
  side ENUM('buy','sell') NOT NULL,
  type ENUM('limit','market') NOT NULL,
  price DECIMAL(32,16) DEFAULT NULL,
  amount DECIMAL(32,16) NOT NULL,
  filled DECIMAL(32,16) DEFAULT 0,
  status ENUM('open','partial','filled','cancelled') DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_book (pair, side, price, status),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

/* Insert assets */
INSERT INTO exchange_assets (ticker, name, type) VALUES
('BTC', 'Bitcoin', 'UTXO'),
('LTC', 'Litecoin', 'UTXO'),
('ZTC', 'ZentCash', 'TURTLENOTE'),
('XMR', 'Monero', 'CRYPTONOTE'),
('ETH', 'Ethereum', 'ACCOUNT'),
('USDT', 'Tether', 'ACCOUNT');

/* Insert initial market price for ZTC_LTC pair */
INSERT INTO exchange_market_prices (pair, last_price, bid_price, ask_price)
VALUES (
  'ZTC_LTC',
  0.000000000005,
  0.000000000004,
  0.000000000006
);
