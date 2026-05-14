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
  requires_memo BOOLEAN DEFAULT 0,
  confirmations_required INT DEFAULT 3,
  explorer_url VARCHAR(255) DEFAULT NULL,
  explorer_tx_url VARCHAR(255) DEFAULT NULL,
  explorer_address_url VARCHAR(255) DEFAULT NULL,
  deposit_enabled TINYINT(1) DEFAULT 1,
  withdraw_enabled TINYINT(1) DEFAULT 1,
  trade_enabled TINYINT(1) DEFAULT 1,
  maintenance_mode TINYINT(1) DEFAULT 0,
  min_deposit DECIMAL(36,18) DEFAULT 0,
  min_withdraw DECIMAL(36,18) DEFAULT 0,
  withdraw_fee DECIMAL(36,18) DEFAULT 0;
  usd_value VARCHAR(255) DEFAULT 0,
  icon_url VARCHAR(255) DEFAULT NULL,
  website VARCHAR(255) DEFAULT NULL,
  coinmarketcap VARCHAR(255) DEFAULT NULL,
  coingecko VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

/* This table store users balances */
CREATE TABLE IF NOT EXISTS exchange_balances (
  user_id INT NOT NULL,
  asset_ticker VARCHAR(20) NOT NULL,
  available DECIMAL(32,16) DEFAULT 0,
  locked DECIMAL(32,16) DEFAULT 0,
  PRIMARY KEY (user_id, asset_ticker),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (asset_ticker) REFERENCES exchange_assets(ticker)
);

/* This table stores the exchange wallet addresses for each user and asset. */
CREATE TABLE IF NOT EXISTS exchange_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  asset_ticker VARCHAR(20) NOT NULL,
  network VARCHAR(20) NOT NULL DEFAULT 'mainnet',
  account VARCHAR(255) DEFAULT NULL,
  address VARCHAR(255) NOT NULL,
  payment_id VARCHAR(64) DEFAULT NULL,
  integrated_address VARCHAR(255) DEFAULT NULL,
  memo VARCHAR(128) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, asset_ticker, network),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_ticker) REFERENCES exchange_assets(ticker)
);

/* Tracks user cryptocurrency deposits from blockchain transactions,
 including multi-network and multi-format address support, and records 
 their confirmation and settlement status.  */
CREATE TABLE IF NOT EXISTS exchange_deposits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  asset_ticker VARCHAR(20) NOT NULL,
  network VARCHAR(20) NOT NULL DEFAULT 'mainnet',
  address VARCHAR(255) NOT NULL,
  payment_id VARCHAR(64) DEFAULT NULL,
  integrated_address VARCHAR(255) DEFAULT NULL,
  memo VARCHAR(128) DEFAULT NULL,
  tag VARCHAR(64) DEFAULT NULL,
  tx_hash VARCHAR(255) DEFAULT NULL,
  block_number BIGINT DEFAULT NULL,
  amount DECIMAL(36,18) DEFAULT 0,
  confirmations INT DEFAULT 0,
  status ENUM('pending','confirmed','failed','rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uniq_deposit (tx_hash, address),
  KEY idx_user_asset (user_id, asset_ticker),
  KEY idx_status (status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_ticker) REFERENCES exchange_assets(ticker)
);

/* Stores user cryptocurrency withdrawals, blockchain 
transaction data, processing status, confirmations,
and network-specific metadata. */
CREATE TABLE IF NOT EXISTS exchange_withdrawals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  asset_ticker VARCHAR(20) NOT NULL,
  network VARCHAR(20) NOT NULL DEFAULT 'mainnet',
  address VARCHAR(255) NOT NULL,
  payment_id VARCHAR(128) DEFAULT NULL,
  integrated_address VARCHAR(255) DEFAULT NULL,
  memo VARCHAR(255) DEFAULT NULL,
  tag VARCHAR(128) DEFAULT NULL,
  account_index INT DEFAULT NULL,
  tx_hash VARCHAR(255) DEFAULT NULL,
  block_number BIGINT DEFAULT NULL,
  amount DECIMAL(36,18) NOT NULL,
  fee DECIMAL(36,18) DEFAULT 0,
  confirmations INT DEFAULT 0,
  status ENUM('pending', 'processing', 'broadcasted','confirmed','failed','cancelled') DEFAULT 'pending',
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL DEFAULT NULL,
  confirmed_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uniq_tx_hash (tx_hash),
  KEY idx_user (user_id),
  KEY idx_asset (asset_ticker),
  KEY idx_status (status),
  KEY idx_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_ticker) REFERENCES exchange_assets(ticker)
);

/* This table stores the available trading pairs on 
the exchange, including their base and quote assets, 
fees, and precision. */
CREATE TABLE exchange_markets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pair VARCHAR(20) UNIQUE,
  base_asset VARCHAR(10),
  quote_asset VARCHAR(10),
  is_active BOOLEAN DEFAULT 1,
  maker_fee DECIMAL(10,6) DEFAULT 0.001,
  taker_fee DECIMAL(10,6) DEFAULT 0.002,
  min_order_size DECIMAL(30,14) DEFAULT 0,
  price_precision INT DEFAULT 8,
  amount_precision INT DEFAULT 8,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
CREATE TABLE IF NOT EXISTS exchange_orders (
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

/*This table store trades*/
CREATE TABLE IF NOT EXISTS exchange_trades (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pair VARCHAR(20) NOT NULL,
  buy_order_id BIGINT NOT NULL,
  sell_order_id BIGINT NOT NULL,
  buyer_user_id INT NOT NULL,
  seller_user_id INT NOT NULL,
  price DECIMAL(32,16) NOT NULL,
  amount DECIMAL(32,16) NOT NULL,
  fee DECIMAL(32,16) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pair (pair),
  INDEX idx_buy_order (buy_order_id),
  INDEX idx_sell_order (sell_order_id),
  FOREIGN KEY (buy_order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (sell_order_id) REFERENCES exchange_orders(id)
);

/* This table store transactions */
CREATE TABLE IF NOT EXISTS exchange_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  asset_ticker VARCHAR(20) NOT NULL,
  type ENUM('deposit', 'withdraw', 'trade_in', 'trade_out', 'lock', 'unlock', 'fee') NOT NULL,
  amount DECIMAL(32,16) NOT NULL,
  balance_before DECIMAL(32,16) DEFAULT NULL,
  balance_after DECIMAL(32,16) DEFAULT NULL,
  reference_id VARCHAR(255) DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_asset (asset_ticker),
  INDEX idx_type (type),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (asset_ticker) REFERENCES exchange_assets(ticker)
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

INSERT INTO exchange_markets (pair, base_asset, quote_asset, is_active, maker_fee, taker_fee) 
VALUES ('ZTC_BTC', 'ZTC', 'BTC', 1, 0.001, 0.002), ('ZTC_LTC', 'ZTC', 'LTC', 1, 0.001, 0.002), ('ZTC_XMR', 'ZTC', 'XMR', 1, 0.001, 0.002);
