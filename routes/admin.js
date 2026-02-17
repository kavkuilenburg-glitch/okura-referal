const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { verifyApiKey } = require('../middleware/auth');
const { issueRewards, processRewardQueue } = require('../services/rewards');

// All admin routes require API key
router.use(verifyApiKey);

/**
 * GET /api/admin/dashboard
 * Summary stats for the management portal
 */
router.get('/dashboard', async (req, res) => {
  try {
    const [totals, revenue, topReferrers, recentActivity] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM referrals) as total_referrals,
          (SELECT COUNT(*) FROM referrals WHERE status IN ('converted','rewarded')) as conversions,
          (SELECT COALESCE(SUM(order_total),0) FROM referrals WHERE status IN ('converted','rewarded')) as revenue,
          (SELECT COUNT(*) FROM referrals WHERE status = 'pending') as pending,
          (SELECT COUNT(*) FROM fraud_flags WHERE resolved = FALSE) as open_flags
      `),
      db.query(`
        SELECT DATE_TRUNC('month', created_at) as month,
          COUNT(*) as referrals,
          COUNT(*) FILTER (WHERE status IN ('converted','rewarded')) as conversions,
          COALESCE(SUM(order_total) FILTER (WHERE status IN ('converted','rewarded')), 0) as revenue
        FROM referrals
        WHERE created_at > NOW() - INTERVAL '6 months'
        GROUP BY month ORDER BY month
      `),
      db.query(`
        SELECT rc.name, rc.email, rc.referral_code, rc.total_referrals, rc.total_earned,
          COUNT(r.id) FILTER (WHERE r.status IN ('converted','rewarded')) as conversions
        FROM referral_customers rc
        LEFT JOIN referrals r ON r.referrer_id = rc.id
        GROUP BY rc.id
        ORDER BY rc.total_referrals DESC
        LIMIT 10
      `),
      db.query(`
        SELECT r.*, rc.name as referrer_name, rc.email as referrer_email
        FROM referrals r
        JOIN referral_customers rc ON rc.id = r.referrer_id
        ORDER BY r.created_at DESC LIMIT 20
      `),
    ]);

    res.json({
      stats: totals.rows[0],
      monthly_trends: revenue.rows,
      top_referrers: topReferrers.rows,
      recent_activity: recentActivity.rows,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * GET /api/admin/referrals
 * Paginated list of all referrals with filters
 */
router.get('/referrals', async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (rc.name ILIKE $${params.length} OR rc.email ILIKE $${params.length} OR r.referee_email ILIKE $${params.length})`;
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM referrals r JOIN referral_customers rc ON rc.id = r.referrer_id ${where}`,
      params
    );

    params.push(limit, offset);
    const result = await db.query(
      `SELECT r.*, rc.name as referrer_name, rc.email as referrer_email, rc.referral_code,
        rc2.name as referee_name
       FROM referrals r
       JOIN referral_customers rc ON rc.id = r.referrer_id
       LEFT JOIN referral_customers rc2 ON rc2.id = r.referee_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      referrals: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(countResult.rows[0].count / limit),
    });
  } catch (err) {
    console.error('List referrals error:', err);
    res.status(500).json({ error: 'Failed to list referrals' });
  }
});

/**
 * PATCH /api/admin/referrals/:id/status
 * Update a referral's status (approve, reject, etc.)
 */
router.patch('/referrals/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'converted', 'rewarded', 'rejected', 'expired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(
      `UPDATE referrals SET status = $1, updated_at = NOW(),
        converted_at = CASE WHEN $1 = 'converted' THEN NOW() ELSE converted_at END
       WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Referral not found' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

/**
 * POST /api/admin/referrals/:id/reward
 * Manually trigger reward issuance for a referral
 */
router.post('/referrals/:id/reward', async (req, res) => {
  try {
    const rewards = await issueRewards(parseInt(req.params.id));
    if (!rewards) return res.status(400).json({ error: 'Referral not eligible for rewards' });
    res.json({ rewards });
  } catch (err) {
    console.error('Issue reward error:', err);
    res.status(500).json({ error: 'Failed to issue rewards' });
  }
});

/**
 * POST /api/admin/rewards/process-queue
 * Process all pending rewards past cooldown. Use as a manual trigger or cron endpoint.
 */
router.post('/rewards/process-queue', async (req, res) => {
  try {
    const result = await processRewardQueue();
    res.json(result);
  } catch (err) {
    console.error('Process queue error:', err);
    res.status(500).json({ error: 'Failed to process queue' });
  }
});

/**
 * GET /api/admin/settings
 */
router.get('/settings', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM referral_settings WHERE id = 1');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * PUT /api/admin/settings
 */
router.put('/settings', async (req, res) => {
  try {
    const { reward_type, reward_amount, min_order_value, cooldown_days, double_sided,
            referee_reward_amount, max_referrals_per_day, code_expiry_days,
            block_self_referral, flag_same_ip, require_verified_email } = req.body;

    const result = await db.query(
      `UPDATE referral_settings SET
        reward_type = COALESCE($1, reward_type),
        reward_amount = COALESCE($2, reward_amount),
        min_order_value = COALESCE($3, min_order_value),
        cooldown_days = COALESCE($4, cooldown_days),
        double_sided = COALESCE($5, double_sided),
        referee_reward_amount = COALESCE($6, referee_reward_amount),
        max_referrals_per_day = COALESCE($7, max_referrals_per_day),
        code_expiry_days = COALESCE($8, code_expiry_days),
        block_self_referral = COALESCE($9, block_self_referral),
        flag_same_ip = COALESCE($10, flag_same_ip),
        require_verified_email = COALESCE($11, require_verified_email),
        updated_at = NOW()
       WHERE id = 1 RETURNING *`,
      [reward_type, reward_amount, min_order_value, cooldown_days, double_sided,
       referee_reward_amount, max_referrals_per_day, code_expiry_days,
       block_self_referral, flag_same_ip, require_verified_email]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /api/admin/fraud-flags
 */
router.get('/fraud-flags', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ff.*, rc.name as customer_name, rc.email as customer_email
       FROM fraud_flags ff
       LEFT JOIN referral_customers rc ON rc.id = ff.customer_id
       WHERE ff.resolved = FALSE
       ORDER BY ff.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch flags' });
  }
});

module.exports = router;
