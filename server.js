require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const referralRoutes = require('./routes/referral');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== Middleware =====

// Security headers
app.use(helmet());

// CORS: allow your Shopify store and admin portal
app.use(cors({
  origin: [
    process.env.STOREFRONT_URL,
    'https://okuracookware.com',
    'http://localhost:3000', // local dev
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Shopify-Hmac-Sha256'],
}));

// Raw body for webhook signature verification (must be before json parser for webhook routes)
app.use('/api/webhooks', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body.toString('utf8');
  req.body = JSON.parse(req.rawBody);
  next();
});

// JSON body parser for all other routes
app.use(express.json());

// Rate limiting for public endpoints
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests' },
});

// ===== Routes =====

// Public: storefront referral actions (enroll, track click, get stats)
app.use('/api/referral', publicLimiter, referralRoutes);

// Shopify webhooks (verified by HMAC)
app.use('/api/webhooks', webhookRoutes);

// Admin portal API (verified by API key)
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== Start =====

app.listen(PORT, () => {
  const initDatabase = require('./utils/db-init');

app.listen(PORT, async () => {
  console.log(`Okura Referral API running on port ${PORT}`);
  await initDatabase();
});
