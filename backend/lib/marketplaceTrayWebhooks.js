import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { importMarketplaceOrderFromWebhook } from './marketplaceOrderSync.js';
import { isIntegrationStockSyncEnabled } from './marketplaceIntegration.js';
import { isTrayIntegrationEnabled } from './trayConfig.js';
import { resolveTrayIntegration, getTrayProduct, updateTrayVariant, updateTrayProduct } from './trayClient.js';
import { logIntegracaoEvent } from './integracaoEventLog.js';

async function listTrayIntegrationsByStoreId(storeId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_integracao')
    .select('*')
    .eq('marketplace', 'tray')
    .eq('store_id', String(storeId))
    .eq('status', 'connected');

  if (error) throw error;
  return data || [];
}

async function processTrayOrderWebhook(integration, orderId) {
  const resolved = await resolveTrayIntegration(integration);
  return importMarketplaceOrderFromWebhook(integration.cliente_id, String(orderId), {
    integration: resolved,
  });
}

async function processTrayStockWebhook(integration, scope, scopeId) {
  if (!isIntegrationStockSyncEnabled(integration)) {
    return { skipped: true, reason: 'sync_estoque_disabled' };
  }

  const resolved = await resolveTrayIntegration(integration);
  const supabase = requireSupabaseAdmin();

  if (scope === 'variant' || scope === 'variant_stock') {
    const { data: maps } = await supabase
      .from('marketplace_produto_map')
      .select('*')
      .eq('integracao_id', integration.id)
      .eq('external_variant_id', String(scopeId))
      .limit(1);

    const map = maps?.[0];
    if (!map) return { skipped: true, reason: 'map_not_found' };

    const variant = await getTrayVariant(resolved.api_address, resolved.access_token, scopeId);
    const stock = Number(variant?.stock) || 0;

    const { pullProductStockFromTray } = await import('./marketplaceTrayStockSync.js');
    return pullProductStockFromTray({
      clienteId: integration.cliente_id,
      integration: resolved,
      map,
      targetStock: stock,
    });
  }

  if (scope === 'product' || scope === 'product_stock') {
    const product = await getTrayProduct(resolved.api_address, resolved.access_token, scopeId);
    const stock = Number(product?.stock) || 0;
    const { data: maps } = await supabase
      .from('marketplace_produto_map')
      .select('*')
      .eq('integracao_id', integration.id)
      .eq('external_product_id', String(scopeId));

    const results = [];
    for (const map of maps || []) {
      if (String(map.external_variant_id) !== String(scopeId)) continue;
      const { pullProductStockFromTray } = await import('./marketplaceTrayStockSync.js');
      results.push(await pullProductStockFromTray({
        clienteId: integration.cliente_id,
        integration: resolved,
        map,
        targetStock: stock,
      }));
    }
    return { processed: results.length, results };
  }

  return { skipped: true, reason: 'unsupported_scope' };
}

export async function handleTrayWebhookEvent(body) {
  if (!isTrayIntegrationEnabled()) {
    return { skipped: true, reason: 'tray_integration_disabled' };
  }

  const sellerId = String(body?.seller_id || body?.store || '');
  const scope = String(body?.scope_name || body?.scope || '').toLowerCase();
  const scopeId = body?.scope_id != null ? String(body.scope_id) : '';
  const action = String(body?.act || body?.action || 'update').toLowerCase();

  if (!sellerId || !scope || !scopeId) {
    return { skipped: true, reason: 'invalid_payload' };
  }

  const integrations = await listTrayIntegrationsByStoreId(sellerId);
  if (!integrations.length) {
    return { skipped: true, reason: 'store_not_connected' };
  }

  const results = [];
  for (const integration of integrations) {
    try {
      let result;
      if (scope === 'order' && action !== 'delete') {
        result = await processTrayOrderWebhook(integration, scopeId);
      } else if (scope.includes('stock') || scope === 'product' || scope === 'variant') {
        result = await processTrayStockWebhook(integration, scope, scopeId);
      } else {
        result = { skipped: true, reason: 'unsupported_scope', scope };
      }

      results.push({
        clienteId: integration.cliente_id,
        integracaoId: integration.id,
        ...result,
      });
    } catch (err) {
      await logIntegracaoEvent(integration.cliente_id, {
        categoria: 'webhook',
        nivel: 'error',
        acao: 'tray_webhook_failed',
        titulo: `Webhook Tray — ${integration.nome}`,
        integracaoId: integration.id,
        lojaNome: integration.nome,
        mensagem: err.message,
        payload: body,
      });
      results.push({
        clienteId: integration.cliente_id,
        integracaoId: integration.id,
        error: err.message,
      });
    }
  }

  return integrations.length === 1 ? results[0] : { processed: results.length, results };
}

export async function pushTrayStockFromAzoup({ integration, map, stock }) {
  const resolved = await resolveTrayIntegration(integration);
  if (String(map.external_variant_id) === String(map.external_product_id)) {
    await updateTrayProduct(resolved.api_address, resolved.access_token, map.external_product_id, {
      stock: String(stock),
    });
  } else {
    await updateTrayVariant(resolved.api_address, resolved.access_token, map.external_variant_id, {
      stock: String(stock),
    });
  }
  return { success: true };
}
