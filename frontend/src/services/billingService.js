const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

function resolveBillingBase() {
  if (import.meta.env.DEV && typeof window !== 'undefined') return '';
  return BACKEND_URL;
}

export async function fetchSubscription(clienteId) {
  const res = await fetch(`${resolveBillingBase()}/api/billing/subscription/${clienteId}`);
  if (!res.ok) throw new Error('Erro ao verificar assinatura');
  return res.json();
}

export async function fetchEcommerceStoreBillingStatus(clienteId) {
  const res = await fetch(
    `${resolveBillingBase()}/api/billing/ecommerce-store-status/${clienteId}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Erro ao consultar cobrança de lojas');
  }
  return res.json();
}
