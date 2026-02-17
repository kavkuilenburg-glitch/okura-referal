const crypto = require('crypto');

/**
 * Generates a unique, URL-safe referral code
 * Format: OKURA-XXXXXX (6 alphanumeric chars)
 */
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `OKURA-${code}`;
}

/**
 * Generates a unique discount code for rewards
 */
function generateDiscountCode(prefix = 'OKREF') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${prefix}-${code}`;
}

module.exports = { generateReferralCode, generateDiscountCode };
