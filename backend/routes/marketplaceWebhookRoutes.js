/**
 * Rotas mínimas para apiconfec: estoque (Supabase) + pedidos (Nuvemshop).
 * Monte em /api/marketplace sem OAuth nem painel.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyMarketplaceWebhookSecret } from '../lib/marketplaceWebhookAuth.js';
import {
  handleAzoupStockChangedWebhook,
  handleNuvemshopWebhookEvent,
  verifyNuvemshopWebhookHmac,
} from '../lib/marketplaceStockSync.js';
import { requireNuvemshopCredentials } from '../lib/marketplaceConfig.js';
import { registerAllNuvemshopWebhooks } from '../lib/marketplaceWebhooks.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Limite de webhooks atingido. Tente novamente em 15 minutos.' },
});

function requireWebhookSecret(req, res) {
  const auth = verifyMarketplaceWebhookSecret(req.headers['x-marketplace-webhook-secret']);
  if (!auth.ok) {
    res.status(auth.reason === 'secret_not_configured' ? 503 : 401).json({
      error: auth.reason === 'secret_not_configured'
        ? 'MARKETPLACE_WEBHOOK_SECRET não configurado no servidor.'
        : 'Unauthorized',
    });
    return false;
  }
  return true;
}

router.get('/webhooks/ping', (_req, res) => {
  let nuvemshopConfigured = false;
  try {
    requireNuvemshopCredentials();
    nuvemshopConfigured = true;
  } catch {
    nuvemshopConfigured = false;
  }

  res.json({
    ok: true,
    service: 'marketplace-webhooks',
    stockSync: Boolean(process.env.MARKETPLACE_WEBHOOK_SECRET?.trim()),
    orderWebhooks: nuvemshopConfigured,
    backendUrl: process.env.BACKEND_URL || null,
    timestamp: new Date().toISOString(),
  });
});

router.post('/webhooks/stock-changed', webhookLimiter, async (req, res) => {
  if (!requireWebhookSecret(req, res)) return;

  try {
    const clienteId = String(req.body?.clienteId || req.body?.cliente_id || '').trim();
    const variacaoId = String(req.body?.variacaoId || req.body?.variacao_id || '').trim();
    if (!clienteId || !variacaoId) {
      return res.status(400).json({ error: 'clienteId e variacaoId são obrigatórios' });
    }

    const result = await handleAzoupStockChangedWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error('[webhooks/stock-changed]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhooks/nuvemshop', webhookLimiter, async (req, res) => {
  try {
    const creds = requireNuvemshopCredentials();
    const hmacHeader = req.headers['x-linkedstore-hmac-sha256']
      || req.headers['http_x_linkedstore_hmac_sha256'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    if (!verifyNuvemshopWebhookHmac(rawBody, hmacHeader, creds.clientSecret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await handleNuvemshopWebhookEvent(req.body || {});
    const event = String(req.body?.event || '');
    if (event.includes('order') && result?.action === 'imported') {
      console.info(`[webhooks/nuvemshop] Pedido ${req.body?.id} → Pedido Aprovado`);
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[webhooks/nuvemshop]', err.message);
    res.status(200).json({ error: err.message });
  }
});

/** Rode uma vez após deploy para apontar webhooks Nuvemshop ao apiconfec. */
router.post('/webhooks/nuvemshop/register', webhookLimiter, async (req, res) => {
  if (!requireWebhookSecret(req, res)) return;

  try {
    const result = await registerAllNuvemshopWebhooks();
    res.json(result);
  } catch (err) {
    console.error('[webhooks/nuvemshop/register]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
