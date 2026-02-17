const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { generateReferralCode } = require('../utils/codes');

/**
 * POST /api/referral/enroll
 * Enroll a logged-in customer into the referral program.
 * Called from the Shopify storefront when customer clicks "Get my referral link".
 *
 * Body: { shopify_id, email, name }
 */
router.post('/enroll', async (req, res) => {
  try {
    const { shopify_id, email, name } = req.body;

    if (!shopify_id || !email) {
      return res.status(400).json({ error: 'shopify_id and email are required' });
    }

    // Check if already enrolled
    const existing = await db.query(
      'SELECT referral_code FROM referral_customers WHERE shopify_id = $1',
      [shopify_id]
    );

    if (existing.rows[0]) {
      return res.json({
        referral_code: existing.rows[0].referral_code,
        referral_url: `${process.env.STOREFRONT_URL}?ref=${existing.rows[0].referral_code}`,
        already_enrolled: true,
      });
    }

    // Generate unique code (retry if collision)
    let code;
    let attempts = 0;
    while (attempts < 5) {
      code = generateReferralCode();
      const collision = await db.query(
        'SELECT id FROM referral_customers WHERE referral_code = $1', [code]
      );
      if (collision.rows.length === 0) break;
      attempts++;
    }

    const result = await db.query(
      `INSERT INTO referral_customers (shopify_id, email, name, referral_code)
       VALUES ($1, $2, $3, $4) RETURNING referral_code`,
      [shopify_id, email.toLowerCase(), name, code]
    );

    res.json({
      referral_code: result.rows[0].referral_code,
      referral_url: `${process.env.STOREFRONT_URL}?ref=${result.rows[0].referral_code}`,
      already_enrolled: false,
    });
  } catch (err) {
    console.error('Enroll error:', err);
    res.status(500).json({ error: 'Failed to enroll' });
  }
});

/**
 * GET /api/referral/stats/:shopify_id
 * Get referral stats for a logged-in customer (their dashboard).
 */
router.get('/stats/:shopify_id', async (req, res) => {
  try {
    const customer = await db.query(
      'SELECT * FROM referral_customers WHERE shopify_id = $1',
      [req.params.shopify_id]
    );

    if (!customer.rows[0]) {
      return res.status(404).json({ error: 'Not enrolled' });
    }

    const c = customer.rows[0];

    const referrals = await db.query(
      `SELECT status, COUNT(*) as count FROM referrals
       WHERE referrer_id = $1 GROUP BY status`,
      [c.id]
    );

    const rewards = await db.query(
      `SELECT discount_code, amount, status, expires_at FROM rewards
       WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [c.id]
    );

    const statusCounts = {};
    referrals.rows.forEach(r => { statusCounts[r.status] = parseInt(r.count); });

    res.json({
      referral_code: c.referral_code,
      referral_url: `${process.env.STOREFRONT_URL}?ref=${c.referral_code}`,
      total_referrals: c.total_referrals,
      total_earned: c.total_earned,
      breakdown: statusCounts,
      recent_rewards: rewards.rows,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * POST /api/referral/track-click
 * Track a referral link click. Called when someone visits the store via ?ref=CODE.
 *
 * Body: { referral_code, ip, user_agent, referrer_url }
 */
router.post('/track-click', async (req, res) => {
  try {
    const { referral_code, ip, user_agent, referrer_url } = req.body;

    if (!referral_code) {
      return res.status(400).json({ error: 'referral_code required' });
    }

    // Verify the code exists
    const codeExists = await db.query(
      'SELECT id FROM referral_customers WHERE referral_code = $1',
      [referral_code]
    );

    if (!codeExists.rows[0]) {
      return res.status(404).json({ error: 'Invalid referral code' });
    }

    await db.query(
      `INSERT INTO referral_clicks (referral_code, ip_address, user_agent, referrer_url)
       VALUES ($1, $2, $3, $4)`,
      [referral_code, ip || null, user_agent || null, referrer_url || null]
    );

    res.json({ tracked: true });
  } catch (err) {
    console.error('Track click error:', err);
    res.status(500).json({ error: 'Failed to track' });
  }
});

module.exports = router;
