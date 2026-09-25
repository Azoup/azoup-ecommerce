/** Guarda body bruto para validar HMAC do webhook Nuvemshop. Use no verify do express.json. */
export function captureNuvemshopWebhookRawBody(req, _res, buf) {
  const path = String(req.originalUrl || req.url || '');
  if (path.includes('/api/marketplace/webhooks/nuvemshop')) {
    req.rawBody = buf;
  }
}
