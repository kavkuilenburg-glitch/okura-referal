const pool = require('./db');

const schema = `
CREATE TABLE IF NOT EXISTS referral_customers (
  id              SERIAL PRIMARY KEY,
  shopify_id      BIGINT UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255),
  referral_code   VARCHAR(20) UNIQUE NOT NULL,
  referred_by     INTEGER REFERENCES referral_customers(id),
  total_referrals INTEGER DEFAULT 0,
  total_earned    DECIMAL(10,2) DEFAULT 0.00,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_clicks (
  id              SERIAL PRIMARY KEY,
  referral_code   VARCHAR(20) NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  referrer_url    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id              SERIAL PRIMARY KEY,
  referrer_id     INTEGER NOT NULL REFERENCES referral_customers(id),
  referee_id      INTEGER REFERENCES referral_customers(id),
  referee_email   VARCHAR(255),
  shopify_order_id BIGINT,
  order_total     DECIMAL(10,2),
  status          VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','converted','rewarded','rejected','expired')),
  converted_at    TIMESTAMPTZ,
  rewarded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rewards (
  id                  SERIAL PRIMARY KEY,
  referral_id         INTEGER NOT NULL REFERENCES referrals(id),
  recipient_type      VARCHAR(10) CHECK (recipient_type IN ('referrer','referee')),
  customer_id         INTEGER NOT NULL REFERENCES referral_customers(id),
  reward_type         VARCHAR(20) DEFAULT 'discount'
                      CHECK (reward_type IN ('discount','percentage','credit')),
  amount              DECIMAL(10,2) NOT NULL,
  shopify_discount_id BIGINT,
  discount_code       VARCHAR(50),
  status              VARCHAR(20) DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','used','expired')),
  sent_at             TIMESTAMPTZ,
  used_at             TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reward_type         VARCHAR(20) DEFAULT 'discount',
  reward_amount       DECIMAL(10,2) DEFAULT 15.00,
  min_order_value     DECIMAL(10,2) DEFAULT 50.00,
  cooldown_days       INTEGER DEFAULT 14,
  double_sided        BOOLEAN DEFAULT TRUE,
  referee_reward_amount DECIMAL(10,2) DEFAULT 15.00,
  max_referrals_per_day INTEGER DEFAULT 5,
  code_expiry_days    INTEGER DEFAULT 90,
  block_self_referral BOOLEAN DEFAULT TRUE,
  flag_same_ip        BOOLEAN DEFAULT TRUE,
  require_verified_email BOOLEAN DEFAULT FALSE,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id              SERIAL PRIMARY KEY,
  referral_id     INTEGER REFERENCES referrals(id),
  customer_id     INTEGER REFERENCES referral_customers(id),
  reason          VARCHAR(50) CHECK (reason IN ('self_referral','same_ip','rate_limit','low_order','suspicious_pattern')),
  details         TEXT,
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_customers_code ON referral_customers(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_customers_shopify ON referral_customers(shopify_id);
CREATE INDEX IF NOT EXISTS idx_referral_customers_email ON referral_customers(email);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_order ON referrals(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_code ON referral_clicks(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_ip ON referral_clicks(ip_address);
CREATE INDEX IF NOT EXISTS idx_rewards_customer ON rewards(customer_id);
CREATE INDEX IF NOT EXISTS idx_rewards_code ON rewards(discount_code);

INSERT INTO referral_settings (reward_type, reward_amount, min_order_value, cooldown_days, double_sided)
VALUES ('discount', 15.00, 50.00, 14, TRUE)
ON CONFLICT (id) DO NOTHING;
`;

async function initDatabase() {
  try {
    console.log('Initializing database tables...');
    await pool.query(schema);
    console.log('Database tables ready!');
  } catch (err) {
    console.error('Database initialization error:', err.message);
    // Don't crash the server - tables might already exist
  }
}

module.exports = initDatabase;
