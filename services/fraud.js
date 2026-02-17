const db = require('../utils/db');

/**
 * Run fraud checks before processing a referral conversion.
 * Returns { passed: boolean, flags: string[] }
 */
async function checkFraud({ referrerCode, refereeEmail, refereeIp, orderTotal }) {
  const flags = [];
  const settings = await getSettings();

  // 1. Self-referral check (same email)
  if (settings.block_self_referral) {
    const referrer = await db.query(
      'SELECT email FROM referral_customers WHERE referral_code = $1',
      [referrerCode]
    );
    if (referrer.rows[0]?.email?.toLowerCase() === refereeEmail?.toLowerCase()) {
      flags.push('self_referral');
    }
  }

  // 2. Same IP check
  if (settings.flag_same_ip && refereeIp) {
    const recentFromIp = await db.query(
      `SELECT COUNT(*) as cnt FROM referral_clicks
       WHERE referral_code = $1 AND ip_address = $2
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [referrerCode, refereeIp]
    );
    if (parseInt(recentFromIp.rows[0].cnt) > 3) {
      flags.push('same_ip');
    }
  }

  // 3. Minimum order value check
  if (orderTotal && orderTotal < settings.min_order_value) {
    flags.push('low_order');
  }

  // 4. Rate limit check (too many referrals from one person today)
  const referrer = await db.query(
    'SELECT id FROM referral_customers WHERE referral_code = $1',
    [referrerCode]
  );
  if (referrer.rows[0]) {
    const todayCount = await db.query(
      `SELECT COUNT(*) as cnt FROM referrals
       WHERE referrer_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [referrer.rows[0].id]
    );
    if (parseInt(todayCount.rows[0].cnt) >= settings.max_referrals_per_day) {
      flags.push('rate_limit');
    }
  }

  return {
    passed: flags.length === 0,
    flags,
  };
}

/**
 * Record fraud flags in the database for manual review
 */
async function recordFlags(referralId, customerId, flags) {
  for (const reason of flags) {
    await db.query(
      `INSERT INTO fraud_flags (referral_id, customer_id, reason, details)
       VALUES ($1, $2, $3, $4)`,
      [referralId, customerId, reason, `Auto-flagged: ${reason}`]
    );
  }
}

async function getSettings() {
  const res = await db.query('SELECT * FROM referral_settings WHERE id = 1');
  return res.rows[0];
}

module.exports = { checkFraud, recordFlags };
