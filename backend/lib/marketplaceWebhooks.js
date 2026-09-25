import { ensureMarketplaceWebhooks } from './nuvemshopClient.js';
import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { decryptToken } from './tokenCrypto.js';
import { requireNuvemshopCredentials } from './marketplaceConfig.js';

export function getMarketplaceWebhookPublicUrl() {
  const backendUrl = process.env.BACKEND_URL
    || process.env.MARKETPLACE_WEBHOOK_PUBLIC_URL
    || `http://localhost:${process.env.PORT || 3001}`;
  return `${backendUrl.replace(/\/$/, '')}/api/marketplace/webhooks/nuvemshop`;
}

export async function registerNuvemshopStockWebhooks(storeId, accessToken, creds = null) {
  const webhookUrl = getMarketplaceWebhookPublicUrl();
  if (!webhookUrl.startsWith('https://')) {
    console.warn(
      '[marketplace] Webhooks Nuvemshop não registrados: BACKEND_URL precisa ser HTTPS público.',
    );
    return { registered: [], skipped: true, reason: 'https_required' };
  }

  try {
    return await ensureMarketplaceWebhooks(storeId, accessToken, webhookUrl, creds);
  } catch (err) {
    console.warn('[marketplace] Falha ao registrar webhooks Nuvemshop:', err.message);
    return { registered: [], error: err.message };
  }
}

/** Registra webhooks Nuvemshop (pedidos + produtos) em todas as lojas conectadas. */
export async function registerAllNuvemshopWebhooks() {
  const webhookUrl = getMarketplaceWebhookPublicUrl();
  if (!webhookUrl.startsWith('https://')) {
    return {
      skipped: true,
      reason: 'https_required',
      webhookUrl,
      results: [],
    };
  }

  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_integracao')
    .select('id, cliente_id, store_id, nome, store_name, access_token')
    .eq('marketplace', 'nuvemshop')
    .eq('status', 'connected');

  if (error) throw error;

  const creds = requireNuvemshopCredentials();
  const results = [];

  for (const row of data || []) {
    try {
      const accessToken = decryptToken(row.access_token);
      const registered = await registerNuvemshopStockWebhooks(row.store_id, accessToken, creds);
      results.push({
        integracaoId: row.id,
        clienteId: row.cliente_id,
        storeId: row.store_id,
        lojaNome: row.nome || row.store_name,
        webhookUrl,
        ...registered,
      });
    } catch (err) {
      results.push({
        integracaoId: row.id,
        clienteId: row.cliente_id,
        storeId: row.store_id,
        error: err.message,
      });
    }
  }

  return { webhookUrl, processed: results.length, results };
}
