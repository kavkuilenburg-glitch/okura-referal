const db = require('../utils/db');
const { generateDiscountCode } = require('../utils/codes');
const shopify = require('./shopify');

/**
 * Issue rewards for a converted referral.
 * Waits for the cooldown period before actually creating discount codes.
 * Called by a scheduled job or directly after cooldown check.
 */
async function issueRewards(referralId) {
  const settings = await db.query('SELECT * FROM referral_settings WHERE id = 1');
  const config = settings.rows[0];

  const referral = await db.query(
    `SELECT r.*, rc.id as referrer_cust_id, rc.email as referrer_email, rc.name as referrer_name
     FROM referrals r
     JOIN referral_customers rc ON rc.id = r.referrer_id
     WHERE r.id = $1 AND r.status = 'converted'`,
    [referralId]
  );

  if (!referral.rows[0]) return null;
  const ref = referral.rows[0];

  const rewards = [];

  // Reward the referrer
  const referrerCode = generateDiscountCode('OKREF');
  try {
    const shopifyDiscount = await shopify.createDiscountCode({
      code: referrerCode,
      amount: config.reward_amount,
      type: config.reward_type === 'percentage' ? 'percentage' : 'fixed_amount',
      minOrderValue: config.min_order_value,
      expiryDays: config.code_expiry_days,
    });

    const reward = await db.query(
      `INSERT INTO rewards (referral_id, recipient_type, customer_id, reward_type, amount, shopify_discount_id, discount_code, status, sent_at, expires_at)
       VALUES ($1, 'referrer', $2, $3, $4, $5, $6, 'sent', NOW(), $7)
       RETURNING *`,
      [referralId, ref.referrer_cust_id, config.reward_type, config.reward_amount,
       shopifyDiscount.discountId, referrerCode, shopifyDiscount.expiresAt]
    );
    rewards.push(reward.rows[0]);
  } catch (err) {
    console.error('Failed to create referrer reward:', err.message);
  }

  // Reward the referee (if double-sided)
  if (config.double_sided && ref.referee_id) {
    const refereeCode = generateDiscountCode('OKNEW');
    try {
      const shopifyDiscount = await shopify.createDiscountCode({
        code: refereeCode,
        amount: config.referee_reward_amount,
        type: config.reward_type === 'percentage' ? 'percentage' : 'fixed_amount',
        minOrderValue: config.min_order_value,
        expiryDays: config.code_expiry_days,
      });

      const reward = await db.query(
        `INSERT INTO rewards (referral_id, recipient_type, customer_id, reward_type, amount, shopify_discount_id, discount_code, status, sent_at, expires_at)
         VALUES ($1, 'referee', $2, $3, $4, $5, $6, 'sent', NOW(), $7)
         RETURNING *`,
        [referralId, ref.referee_id, config.reward_type, config.referee_reward_amount,
         shopifyDiscount.discountId, refereeCode, shopifyDiscount.expiresAt]
      );
      rewards.push(reward.rows[0]);
    } catch (err) {
      console.error('Failed to create referee reward:', err.message);
    }
  }

  // Update referral status to rewarded
  await db.query(
    `UPDATE referrals SET status = 'rewarded', rewarded_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [referralId]
  );

  // Update referrer stats
  await db.query(
    `UPDATE referral_customers SET total_earned = total_earned + $1, updated_at = NOW() WHERE id = $2`,
    [config.reward_amount, ref.referrer_cust_id]
  );

  return rewards;
}

/**
 * Check for converted referrals past the cooldown period and issue rewards.
 * Run this as a cron job (e.g., every hour).
 */
async function processRewardQueue() {
  const config = (await db.query('SELECT * FROM referral_settings WHERE id = 1')).rows[0];

  const eligible = await db.query(
    `SELECT id FROM referrals
     WHERE status = 'converted'
     AND converted_at < NOW() - INTERVAL '${config.cooldown_days} days'`
  );

  let processed = 0;
  for (const row of eligible.rows) {
    try {
      await issueRewards(row.id);
      processed++;
    } catch (err) {
      console.error(`Failed to process reward for referral ${row.id}:`, err.message);
    }
  }

  return { processed, total: eligible.rows.length };
}

module.exports = { issueRewards, processRewardQueue };
