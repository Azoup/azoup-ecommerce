/**
 * Cliente HTTP para billing de lojas no apiconfec (Confec).
 * Usa CONFEC_BILLING_URL + CONFEC_BILLING_API_KEY (opcional).
 */
const CONFEC_BILLING_URL = (
  process.env.CONFEC_BILLING_URL
  || process.env.APICONFEC_URL
  || process.env.EXPO_PUBLIC_BACKEND_URL
  || ''
).replace(/\/$/, '');

const CONFEC_BILLING_API_KEY = (
  process.env.CONFEC_BILLING_API_KEY
  || process.env.ECOMMERCE_BILLING_API_KEY
  || ''
).trim();

function confecBillingConfigured() {
  return Boolean(CONFEC_BILLING_URL);
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (CONFEC_BILLING_API_KEY) {
    headers.Authorization = `Bearer ${CONFEC_BILLING_API_KEY}`;
  }
  return headers;
}

async function confecFetch(path, options = {}) {
  if (!CONFEC_BILLING_URL) {
    const err = new Error(
      'CONFEC_BILLING_URL não configurada. Defina a URL do apiconfec no backend/.env.',
    );
    err.code = 'confec_billing_url_missing';
    throw err;
  }

  const res = await fetch(`${CONFEC_BILLING_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || res.statusText };
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Confec billing HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function fetchEcommerceBillingStatus(clienteId) {
  if (!confecBillingConfigured()) {
    return {
      skipped: true,
      reason: 'confec_billing_url_missing',
      ativoConfec: true,
      podeAdicionar: true,
      lojasContratadas: 0,
      unitPriceBrl: 97,
    };
  }
  return confecFetch(`/api/billing/ecommerce-status?clienteId=${encodeURIComponent(clienteId)}`);
}

export async function activateEcommerceStoreBilling(clienteId, payload = {}) {
  if (!confecBillingConfigured()) {
    console.warn('[ecommerce-billing] CONFEC_BILLING_URL ausente — skip activate');
    return { skipped: true, reason: 'confec_billing_url_missing' };
  }
  return confecFetch('/api/billing/ecommerce-seat', {
    method: 'POST',
    body: JSON.stringify({
      clienteId,
      action: 'activate',
      ...payload,
    }),
  });
}

export async function deactivateEcommerceStoreBilling(clienteId, payload = {}) {
  if (!confecBillingConfigured()) {
    console.warn('[ecommerce-billing] CONFEC_BILLING_URL ausente — skip deactivate');
    return { skipped: true, reason: 'confec_billing_url_missing' };
  }
  return confecFetch('/api/billing/ecommerce-seat', {
    method: 'POST',
    body: JSON.stringify({
      clienteId,
      action: 'deactivate',
      ...payload,
    }),
  });
}

export { confecBillingConfigured };
