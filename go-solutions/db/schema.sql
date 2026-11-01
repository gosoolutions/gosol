CREATE TABLE IF NOT EXISTS stock (
  product_id VARCHAR(64) NOT NULL PRIMARY KEY,
  quantity INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ref VARCHAR(16) NOT NULL UNIQUE,
  access_token CHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL,
  payment_method VARCHAR(16) NOT NULL,
  payment_provider VARCHAR(24) NULL,
  payment_ref VARCHAR(128) NULL,
  currency CHAR(3) NOT NULL,
  total DECIMAL(14,2) NOT NULL,
  base_total DECIMAL(14,2) NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(190) NOT NULL,
  customer_phone VARCHAR(40) NOT NULL,
  company VARCHAR(160) NULL,
  country VARCHAR(80) NOT NULL,
  address_line VARCHAR(200) NOT NULL,
  city VARCHAR(100) NOT NULL,
  postcode VARCHAR(20) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  paid_at DATETIME NULL,
  INDEX idx_orders_status (status),
  INDEX idx_orders_email (customer_email)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  type VARCHAR(20) NOT NULL,
  unit_price DECIMAL(14,2) NOT NULL,
  qty INT NOT NULL,
  line_total DECIMAL(14,2) NOT NULL,
  billing_interval VARCHAR(10) NULL,
  booking_date DATE NULL,
  booking_time CHAR(5) NULL,
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL,
  note TEXT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookings (
  product_id VARCHAR(64) NOT NULL,
  slot_date DATE NOT NULL,
  slot_time CHAR(5) NOT NULL,
  order_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (product_id, slot_date, slot_time),
  CONSTRAINT fk_bookings_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL
);
