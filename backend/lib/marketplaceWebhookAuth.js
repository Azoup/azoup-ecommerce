export function verifyMarketplaceWebhookSecret(headerValue) {
  const expected = process.env.MARKETPLACE_WEBHOOK_SECRET?.trim();
  if (!expected) return { ok: false, reason: 'secret_not_configured' };
  if (!headerValue || String(headerValue).trim() !== expected) {
    return { ok: false, reason: 'unauthorized' };
  }
  return { ok: true };
}
