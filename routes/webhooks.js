const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { generateReferralCode, generateDiscountCode } = require('../utils/codes');
const { verifyShopifyWebhook } = require('../middleware/auth');

router.post('/orders-create', verifyShopifyWebhook, async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const order = req.body;
    const customerEmail = order.email?.toLowerCase();
    const orderId = order.id;
    const orderTotal = parseFloat(order.total_price || 0);

    if (!customerEmail) return;

    const refCode = extractReferralCode(order);
    if (!refCode) return;

    const referrer = await db.query('SELECT * FROM referral_customers WHERE referral_code = $1', [refCode]);
    if (!referrer.rows[0]) return;

    const existingRef = await db.query('SELECT id FROM referrals WHERE shopify_order_id = $1', [orderId]);
    if (existingRef.rows[0]) return;

    if (referrer.rows[0].email.toLowerCase() === customerEmail) {
      console.log('Blocked self-referral: ' + customerEmail);
      return;
    }

    var refereeId = null;
    const referee = await db.query('SELECT id FROM referral_customers WHERE email = $1', [customerEmail]);
    if (referee.rows[0]) {
      refereeId = referee.rows[0].id;
    } else if (order.customer?.id) {
      const newCode = generateReferralCode();
      const newCust = await db.query(
        'INSERT INTO referral_customers (shopify_id, email, name, referral_code, referred_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [order.customer.id, customerEmail, order.customer.first_name || '', newCode, referrer.rows[0].id]
      );
      refereeId = newCust.rows[0].id;
    }

    const referral = await db.query(
      'INSERT INTO referrals (referrer_id, referee_id, referee_email, shopify_order_id, order_total, status, converted_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id',
      [referrer.rows[0].id, refereeId, customerEmail, orderId, orderTotal, 'converted']
    );

    await db.query(
      'UPDATE referral_customers SET total_referrals = total_referrals + 1, updated_at = NOW() WHERE id = $1',
      [referrer.rows[0].id]
    );

    try {
      var shopify = require('../services/shopify');
      var settings = (await db.query('SELECT * FROM referral_settings WHERE id = 1')).rows[0];
      var rewardCode = generateDiscountCode('OKTHX');

      await shopify.createDiscountCode({
        code: rewardCode,
        amount: settings.reward_amount || 15,
        type: settings.reward_type === 'percentage' ? 'percentage' : 'fixed_amount',
        minOrderValue: settings.min_order_value || 0,
        expiryDays: settings.code_expiry_days || 90,
      });

      await db.query(
        "INSERT INTO rewards (referral_id, recipient_type, customer_id, reward_type, amount, discount_code, status, sent_at, expires_at) VALUES ($1, 'referrer', $2, $3, $4, $5, 'sent', NOW(), NOW() + INTERVAL '90 days')",
        [referral.rows[0].id, referrer.rows[0].id, settings.reward_type || 'discount', settings.reward_amount || 15, rewardCode]
      );

      await db.query(
        'UPDATE referral_customers SET total_earned = total_earned + $1, updated_at = NOW() WHERE id = $2',
        [settings.reward_amount || 15, referrer.rows[0].id]
      );

      await db.query("UPDATE referrals SET status = 'rewarded', rewarded_at = NOW() WHERE id = $1", [referral.rows[0].id]);

      console.log('Referral rewarded! ' + refCode + ' -> ' + customerEmail + ' | Referrer gets: ' + rewardCode);
    } catch (err) {
      console.error('Failed to create referrer reward:', err.message);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

router.post('/orders-paid', verifyShopifyWebhook, async (req, res) => {
  res.status(200).json({ received: true });
});

function extractReferralCode(order) {
  if (order.note_attributes) {
    var refAttr = order.note_attributes.find(function(a) { return a.name === 'referral_code' || a.name === 'ref'; });
    if (refAttr && refAttr.value) return refAttr.value;
  }
  if (order.note) {
    var match = order.note.match(/ref[:\s]*(OKURA-[A-Z0-9]+)/i);
    if (match) return match[1];
  }
  if (order.customer && order.customer.tags) {
    var match2 = order.customer.tags.match(/ref:(OKURA-[A-Z0-9]+)/i);
    if (match2) return match2[1];
  }
  return null;
}

module.exports = router;
