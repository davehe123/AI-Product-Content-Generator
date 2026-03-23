-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  google_id TEXT UNIQUE NOT NULL,
  subscription_tier TEXT DEFAULT 'free',          -- free | starter | pro | business
  subscription_status TEXT DEFAULT 'active',       -- active | cancelled | expired
  subscription_renews_at INTEGER,                  -- Unix timestamp，下次续费时间
  created_at INTEGER DEFAULT (unixepoch()),
  last_login INTEGER
);

-- 积分交易记录（订阅购买/积分包购买/扣减）
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                             -- subscription | package | usage | bonus
  description TEXT,
  credits_added INTEGER DEFAULT 0,
  credits_deducted INTEGER DEFAULT 0,
  plan_tier TEXT,                                 -- starter | pro | business（订阅时填）
  amount_paid REAL DEFAULT 0,                     -- 实际支付金额（美元）
  paypal_order_id TEXT,                           -- PayPal 订单ID
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 生成历史
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_name TEXT,
  brand_name TEXT,
  features TEXT,
  audience TEXT,
  keywords TEXT,
  tone TEXT,
  platform TEXT,
  generated_title TEXT,
  generated_bullets TEXT,                         -- JSON 数组
  generated_description TEXT,
  tokens_used INTEGER DEFAULT 0,
  credits_used INTEGER DEFAULT 1,                  -- 消耗积分数量
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
