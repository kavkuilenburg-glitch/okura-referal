const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { checkFraud, recordFlags } = require('../services/fraud');
const { verifyShopifyWebhook } = require('../middleware/auth');

/**
 * POST /api/webhooks/orders-create
 * Shopify fires this when a new order is placed.
 * We check if the customer was referred and create a referral conversion.
 */
router.post('/orders-create', verifyShopifyWebhook, async (req, res) => {
  // Respond immediately (Shopify expects 200 within 5s)
  res.status(200).json({ received: true });

  try {
    const order = req.body;
    const customerEmail = order.email?.toLowerCase();
    const orderId = order.id;
    const orderTotal = parseFloat(order.total_price || 0);

    if (!customerEmail) return;

    // Check if this customer has a referral cookie/note
    // The referral code is stored as an order note attribute or customer note
    const refCode = extractReferralCode(order);
    if (!refCode) return;

    // Find the referrer
    const referrer = await db.query(
      'SELECT * FROM referral_customers WHERE referral_code = $1',
      [refCode]
    );
    if (!referrer.rows[0]) return;

    // Check if this order was already processed
    const existingRef = await db.query(
      'SELECT id FROM referrals WHERE shopify_order_id = $1',
      [orderId]
    );
    if (existingRef.rows[0]) return;

    // Find or create the referee customer record
    let referee = await db.query(
      'SELECT * FROM referral_customers WHERE email = $1',
      [customerEmail]
    );

    let refereeId = referee.rows[0]?.id;
    if (!refereeId && order.customer?.id) {
      // Auto-enroll the referred customer
      const { generateReferralCode } = require('../utils/codes');
      const newCode = generateReferralCode();
      const newCustomer = await db.query(
        `INSERT INTO referral_customers (shopify_id, email, name, referral_code, referred_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [order.customer.id, customerEmail, order.customer.first_name || '', newCode, referrer.rows[0].id]
      );
      refereeId = newCustomer.rows[0].id;
    }

    // Run fraud checks
    const fraudResult = await checkFraud({
      referrerCode: refCode,
      refereeEmail: customerEmail,
      refereeIp: order.browser_ip,
      orderTotal,
    });

    // Create the referral record
    const status = fraudResult.passed ? 'converted' : 'pending';
    const referral = await db.query(
      `INSERT INTO referrals (referrer_id, referee_id, referee_email, shopify_order_id, order_total, status, converted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [referrer.rows[0].id, refereeId, customerEmail, orderId, orderTotal,
       status, fraudResult.passed ? new Date() : null]
    );

    // Update referrer total_referrals count
    await db.query(
      `UPDATE referral_customers SET total_referrals = total_referrals + 1, updated_at = NOW() WHERE id = $1`,
      [referrer.rows[0].id]
    );

    // Record fraud flags if any
    if (!fraudResult.passed) {
      await recordFlags(referral.rows[0].id, referrer.rows[0].id, fraudResult.flags);
    }

    console.log(`Referral ${referral.rows[0].id} created: ${refCode} -> ${customerEmail} (${status})`);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

/**
 * POST /api/webhooks/orders-paid
 * Optional: fired when payment is confirmed. Can be used to upgrade pending -> converted.
 */
router.post('/orders-paid', verifyShopifyWebhook, async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const order = req.body;
    // If we have a pending referral for this order, upgrade to converted
    await db.query(
      `UPDATE referrals SET status = 'converted', converted_at = NOW(), updated_at = NOW()
       WHERE shopify_order_id = $1 AND status = 'pending'`,
      [order.id]
    );
  } catch (err) {
    console.error('Orders-paid webhook error:', err);
  }
});

/**
 * Extract referral code from order note attributes or discount codes.
 * Shopify stores note attributes as [{ name, value }] arrays.
 */
function extractReferralCode(order) {
  // Check note_attributes (set by our storefront JS)
  if (order.note_attributes) {
    const refAttr = order.note_attributes.find(
      a => a.name === 'referral_code' || a.name === 'ref'
    );
    if (refAttr?.value) return refAttr.value;
  }

  // Check order note
  if (order.note) {
    const match = order.note.match(/ref[:\s]*(OKURA-[A-Z0-9]+)/i);
    if (match) return match[1];
  }

  // Check customer tags
  if (order.customer?.tags) {
    const match = order.customer.tags.match(/ref:(OKURA-[A-Z0-9]+)/i);
    if (match) return match[1];
  }

  return null;
}

module.exports = router;
