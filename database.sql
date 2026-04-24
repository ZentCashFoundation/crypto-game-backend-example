CREATE DATABASE IF NOT EXISTS crypto_game;
USE crypto_game;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(255) UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  payment_id CHAR(64) UNIQUE NOT NULL,
  balance DECIMAL(18,8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  payment_id CHAR(64) NOT NULL,
  amount DECIMAL(18,8) NOT NULL,
  tx_hash VARCHAR(128) NOT NULL UNIQUE,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  game VARCHAR(50),
  cost DECIMAL(18,8) NOT NULL,
  score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transaction_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('deposit','withdraw','play','admin') NOT NULL,
  amount DECIMAL(18,8) NOT NULL,
  reference_id VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS games (
  name VARCHAR(50) NOT NULL UNIQUE,
  cost DECIMAL(10,2) NOT NULL
);

INSERT INTO games (name, cost) VALUES
('tetris', 20.00),
('pacman', 20.00),
('snake', 3.00),
('lamboraider', 3.00)
ON DUPLICATE KEY UPDATE
cost = VALUES(cost);
