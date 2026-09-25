import { Router } from 'express';
import { requireSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { evaluateAssinaturaAccess } from '../lib/billingAccess.js';

const router = Router();

function isMissingColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703'
    || message.includes('does not exist')
    || message.includes('could not find');
}

async function fetchLatestAssinatura(supabase, clienteId) {
  const selects = ['*, planos_assinatura(*)', '*'];
  const orderColumns = ['created_at', 'criado_em', 'data_criacao', 'inicio_em', 'id', null];

  let lastError = null;

  for (const select of selects) {
    for (const orderColumn of orderColumns) {
      let query = supabase
        .from('assinaturas_clientes')
        .select(select)
        .eq('cliente_id', clienteId)
        .limit(1);

      if (orderColumn) {
        query = query.order(orderColumn, { ascending: false });
      }

      const { data, error } = await query.maybeSingle();
      if (!error) {
        return { assinatura: data, error: null };
      }

      lastError = error;
      if (!isMissingColumnError(error)) {
        return { assinatura: null, error };
      }
    }
  }

  return { assinatura: null, error: lastError };
}

async function fetchClienteBillingHint(supabase, clienteId) {
  const attempts = [
    'id, stripe_customer_id',
    'id',
  ];

  for (const select of attempts) {
    const { data, error } = await supabase
      .from('clientes_azoup')
      .select(select)
      .eq('id', clienteId)
      .maybeSingle();

    if (!error) return data;
    if (!isMissingColumnError(error)) throw error;
  }

  return null;
}

router.get('/subscription/:clienteId', async (req, res) => {
  const { clienteId } = req.params;

  if (!clienteId) {
    return res.status(400).json({ allowed: false, reason: 'clienteId obrigatório' });
  }

  let supabase;
  try {
    supabase = requireSupabaseAdmin();
  } catch {
    return res.json({ allowed: true, reason: 'backend_not_configured' });
  }

  try {
    const { assinatura, error } = await fetchLatestAssinatura(supabase, clienteId);

    if (error) {
      console.warn('Billing check error (fail-open):', error.message);
      return res.json({ allowed: true, reason: 'legacy', canAddStore: false });
    }

    if (!assinatura) {
      return res.json({ allowed: true, reason: 'legacy_no_subscription', canAddStore: false });
    }

    const cliente = await fetchClienteBillingHint(supabase, clienteId);
    const access = evaluateAssinaturaAccess(assinatura, cliente);
    return res.json(access);
  } catch (err) {
    console.warn('Billing check exception (fail-open):', err.message);
    return res.json({ allowed: true, reason: 'error_fail_open', canAddStore: false });
  }
});

router.get('/ecommerce-store-status/:clienteId', async (req, res) => {
  try {
    const { fetchEcommerceBillingStatus } = await import('../lib/ecommerceBillingClient.js');
    const data = await fetchEcommerceBillingStatus(req.params.clienteId);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
