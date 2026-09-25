import crypto from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

function getSecret() {
  return process.env.TOKEN_ENCRYPTION_KEY || process.env.NUVEMSHOP_CLIENT_SECRET || 'oauth-state-dev-secret';
}

export function createOAuthState(clienteId, extra = {}) {
  const payload = {
    clienteId,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
    nome: extra.nome ? String(extra.nome).trim() : null,
    tabelaPrecoId: extra.tabelaPrecoId ? String(extra.tabelaPrecoId) : null,
    pontaEstoqueId: extra.pontaEstoqueId ? String(extra.pontaEstoqueId) : null,
    storeUrl: extra.storeUrl ? String(extra.storeUrl).trim() : null,
    marketplace: extra.marketplace ? String(extra.marketplace) : null,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyOAuthState(state) {
  if (!state || !state.includes('.')) throw new Error('State inválido');
  const [data, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  if (sig !== expected) throw new Error('Assinatura do state inválida');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (Date.now() > payload.exp) throw new Error('State expirado');
  return payload;
}
