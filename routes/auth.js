const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const crypto = require('crypto');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SCOPES = 'write_price_rules,read_price_rules,read_orders,read_customers,write_customers';

router.get('/install', (req, res) => {
  const redirectUri = `https://${req.get('host')}/api/auth/callback`;
  const nonce = crypto.randomBytes(16).toString('hex');
  const installUrl = `https://${SHOPIFY_STORE}/admin/oauth/authorize?` +
    `client_id=${CLIENT_ID}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${nonce}`;
  res.cookie('shopify_nonce', nonce, { httpOnly: true, maxAge: 600000 });
  res.redirect(installUrl);
});

router.get('/callback', async (req, res) => {
  try {
    const { code, shop } = req.query;
    if (!code || !shop) {
      return res.status(400).send('Missing code or shop parameter');
    }
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
      }),
    });
    const tokenData = await tokenResponse.json();
    if (tokenData.access_token) {
      console.log('===========================================');
      console.log('SHOPIFY ACCESS TOKEN: ' + tokenData.access_token);
      console.log('===========================================');
      res.send(`
        <html>
        <body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center;background:#1a1714;color:#e8dcc8;">
          <h1 style="color:#c4945a;">Connected!</h1>
          <p>Your Shopify access token:</p>
          <p style="background:#2a2520;padding:16px;border-radius:8px;font-family:monospace;word-break:break-all;font-size:14px;">
            ${tokenData.access_token}
          </p>
          <p style="color:#c4945a;font-weight:bold;">Copy this token and add it as SHOPIFY_ACCESS_TOKEN in Railway.</p>
        </body>
        </html>
      `);
    } else {
      res.status(500).send('Failed: ' + JSON.stringify(tokenData));
    }
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

module.exports = router;
```

**Steps:**

**1.** Go to GitHub → your repo → **`routes`** folder → **"Add file" → "Create new file"**

**2.** Name it **`auth.js`**, paste the code above, click **"Commit changes"**

**3.** Then go back and edit **`server.js`** — add these two lines:

Near the top with the other requires, add:
```
const authRoutes = require('./routes/auth');
```

Before the line `// Public:`, add:
```
app.use('/api/auth', authRoutes);
