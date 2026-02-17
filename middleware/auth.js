const crypto = require('crypto');

/**
 * Verify Shopify webhook HMAC signature
 */
function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  if (!hmacHeader) {
    return res.status(401).json({ error: 'Missing HMAC header' });
  }

  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(req.rawBody || '', 'utf8')
    .digest('base64');

  if (hash !== hmacHeader) {
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  next();
}

/**
 * Simple API key auth for admin portal routes
 */
function verifyApiKey(req, res, next) {
  const key = req.get('X-API-Key') || req.query.api_key;
  if (!key || key !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { verifyShopifyWebhook, verifyApiKey };
