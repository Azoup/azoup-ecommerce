import { fetchSubscription } from '../services/billingService';

export async function evaluateClienteBillingAccess(clienteId) {
  try {
    const data = await fetchSubscription(clienteId);
    if (data.allowed) return { allowed: true };
    return { allowed: false, reason: data.reason || 'Assinatura inativa ou trial expirado' };
  } catch {
    return { allowed: true };
  }
}
