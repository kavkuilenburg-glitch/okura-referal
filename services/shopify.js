const fetch = require('node-fetch');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

const shopifyFetch = async (endpoint, options = {}) => {
  const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ACCESS_TOKEN,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${body}`);
  }

  return res.json();
};

/**
 * Create a single-use discount code on Shopify
 * Used to reward referrers and referees
 */
async function createDiscountCode({ code, amount, type = 'fixed_amount', minOrderValue = 0, expiryDays = 90 }) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  // Step 1: Create a Price Rule
  const priceRulePayload = {
    price_rule: {
      title: code,
      target_type: 'line_item',
      target_selection: 'all',
      allocation_method: 'across',
      value_type: type, // 'fixed_amount' or 'percentage'
      value: `-${amount}`, // negative for discount
      customer_selection: 'all',
      once_per_customer: true,
      usage_limit: 1,
      starts_at: new Date().toISOString(),
      ends_at: expiresAt.toISOString(),
      prerequisite_subtotal_range: minOrderValue > 0 ? { greater_than_or_equal_to: String(minOrderValue) } : undefined,
    },
  };

  const priceRuleRes = await shopifyFetch('/price_rules.json', {
    method: 'POST',
    body: JSON.stringify(priceRulePayload),
  });

  const priceRuleId = priceRuleRes.price_rule.id;

  // Step 2: Create a Discount Code under that Price Rule
  const discountRes = await shopifyFetch(`/price_rules/${priceRuleId}/discount_codes.json`, {
    method: 'POST',
    body: JSON.stringify({ discount_code: { code } }),
  });

  return {
    priceRuleId,
    discountId: discountRes.discount_code.id,
    code: discountRes.discount_code.code,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Look up a Shopify customer by email
 */
async function getCustomerByEmail(email) {
  const res = await shopifyFetch(`/customers/search.json?query=email:${encodeURIComponent(email)}`);
  return res.customers?.[0] || null;
}

/**
 * Get order details by Shopify order ID
 */
async function getOrder(orderId) {
  const res = await shopifyFetch(`/orders/${orderId}.json`);
  return res.order;
}

module.exports = {
  createDiscountCode,
  getCustomerByEmail,
  getOrder,
  shopifyFetch,
};
