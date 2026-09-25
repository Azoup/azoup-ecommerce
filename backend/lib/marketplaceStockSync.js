import crypto from 'crypto';
import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { unlinkMarketplaceMapsByExternalProduct } from './marketplaceProductMap.js';
import { decryptToken } from './tokenCrypto.js';
import { requireNuvemshopCredentials } from './marketplaceConfig.js';
import {
  getProduct,
  getProductVariant,
  normalizeNuvemshopStock,
  resolveNuvemshopVariantStock,
  replaceNuvemshopVariantStock,
  updateVariantStock,
} from './nuvemshopClient.js';
import {
  applyStockTarget,
  createEstoqueLedgerContext,
  getVariacaoSaldo,
} from './estoqueLedger.js';
import { logIntegracaoEvent } from './integracaoEventLog.js';
import { isIntegrationStockSyncEnabled } from './marketplaceIntegration.js';

const MARKETPLACE = 'nuvemshop';
const STOCK_PULL_OBSERVACAO = 'Nuvemshop — sincronização de estoque do e-commerce';
const STOCK_IMPORT_OBSERVACAO = 'Nuvemshop — estoque importado do e-commerce';

function nuvemVariantsFromProduct(product) {
  if (product?.variants?.length) return product.variants;
  return [{ id: product.id, stock: product.stock }];
}

async function listConnectedIntegrationsByStoreId(storeId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_integracao')
    .select('*')
    .eq('marketplace', MARKETPLACE)
    .eq('store_id', String(storeId))
    .eq('status', 'connected');

  if (error) throw error;
  if (!data?.length) return [];

  return data.map((row) => ({
    ...row,
    access_token: decryptToken(row.access_token),
  }));
}

async function processNuvemshopWebhookForIntegration(integration, event, resourceId, storeId) {
  const clienteId = integration.cliente_id;

  await logIntegracaoEvent(clienteId, {
    categoria: 'webhook',
    nivel: 'info',
    acao: 'webhook_received',
    titulo: `Webhook Nuvemshop: ${event}`,
    integracaoId: integration.id,
    lojaNome: integration.nome || integration.store_name,
    referenciaTipo: event.includes('order') ? 'pedido' : 'produto',
    referenciaId: resourceId || null,
    payload: { event, store_id: storeId },
  });

  if (event === 'product/updated' || event === 'product/created') {
    if (!resourceId) return { skipped: true, reason: 'missing_product_id' };
    if (!isIntegrationStockSyncEnabled(integration)) {
      return { skipped: true, reason: 'stock_sync_disabled' };
    }
    const result = await pullStockFromNuvemshopForExternalProduct(clienteId, resourceId, {
      integration,
    });
    if (result.updated > 0) {
      await logIntegracaoEvent(clienteId, {
        categoria: 'estoque',
        nivel: 'success',
        acao: 'stock_webhook_pull',
        titulo: 'Estoque puxado da loja após webhook de produto',
        integracaoId: integration.id,
        lojaNome: integration.nome || integration.store_name,
        referenciaTipo: 'produto',
        referenciaId: resourceId,
        payload: result,
      });
    }
    return result;
  }

  if (event === 'product/deleted') {
    if (!resourceId) return { skipped: true, reason: 'missing_product_id' };
    return unlinkMarketplaceMapsByExternalProduct({
      clienteId,
      integracaoId: integration.id,
      externalProductId: resourceId,
      integracaoNome: integration.nome || integration.store_name,
      reason: 'Produto excluído na Nuvemshop; vínculo removido para permitir novo envio/importação.',
    });
  }

  if (event === 'order/created' || event === 'order/updated' || event === 'order/paid') {
    if (!resourceId) return { skipped: true, reason: 'missing_order_id' };
    const { importMarketplaceOrderFromWebhook } = await import('./marketplaceOrderSync.js');
    return importMarketplaceOrderFromWebhook(clienteId, resourceId, { integration });
  }

  await logIntegracaoEvent(clienteId, {
    categoria: 'webhook',
    nivel: 'info',
    acao: 'webhook_ignored',
    titulo: `Webhook ignorado: ${event}`,
    integracaoId: integration.id,
    lojaNome: integration.nome || integration.store_name,
    payload: { event },
  });

  return { skipped: true, reason: 'ignored_event', event };
}

export function isMarketplaceOriginatedObservation(observacao) {
  const text = String(observacao || '').toLowerCase();
  return text.includes('nuvemshop')
    || text.includes('e-commerce sync')
    || text.includes('ecommerce sync')
    || text.includes('marketplace sync');
}

export function verifyNuvemshopWebhookHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader || !rawBody) return false;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(hmacHeader), 'utf8'),
      Buffer.from(digest, 'utf8'),
    );
  } catch {
    return false;
  }
}

async function loadMapsForProduct(clienteId, produtoId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('produto_id', produtoId);

  if (error) throw error;
  return data || [];
}

async function loadMapsForVariacao(clienteId, variacaoId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('produto_cor_tamanho_id', variacaoId);

  if (error) throw error;
  return data || [];
}

async function resolveEstoqueCtxForPonta(clienteId, pontaEstoqueId, cache, preferredCtx = null) {
  const pontaKey = pontaEstoqueId || '__default__';
  if (
    preferredCtx
    && (!pontaEstoqueId || preferredCtx.pontaEstoqueId === pontaEstoqueId)
  ) {
    return preferredCtx;
  }
  if (!cache.has(pontaKey)) {
    cache.set(
      pontaKey,
      await createEstoqueLedgerContext(clienteId, null, { pontaEstoqueId: pontaEstoqueId || undefined }),
    );
  }
  return cache.get(pontaKey);
}

export async function pushProductStockToNuvemshop({
  clienteId,
  produtoId,
  integration,
  creds,
  supabase,
  estoqueCtx,
}) {
  if (!isIntegrationStockSyncEnabled(integration)) {
    return { updated: 0, skipped: 0, reason: 'stock_sync_disabled' };
  }

  const { data: maps } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integration.id)
    .eq('produto_id', produtoId);

  if (!maps?.length) return { updated: 0, skipped: 0 };

  let updated = 0;
  let skipped = 0;

  for (const map of maps) {
    if (!map.produto_cor_tamanho_id || !map.external_variant_id) {
      skipped += 1;
      continue;
    }

    const stock = getVariacaoSaldo(
      estoqueCtx,
      map.produto_cor_tamanho_id,
      map.produto_id,
    ) ?? 0;

    await replaceNuvemshopVariantStock(
      integration.store_id,
      integration.access_token,
      map.external_product_id,
      map.external_variant_id,
      stock,
      creds,
    );
    updated += 1;
  }

  if (updated > 0) {
    await supabase.from('marketplace_produto_map')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_direction: 'stock_azoup',
      })
      .eq('cliente_id', clienteId)
      .eq('marketplace', MARKETPLACE)
      .eq('integracao_id', integration.id)
      .eq('produto_id', produtoId);
  }

  return { updated, skipped };
}

async function pullStockForMaps({
  clienteId,
  maps,
  integration,
  creds,
  estoqueCtx,
  supabase,
  nuvemVariantsByProductId = null,
  productByExternalId = null,
  stockByVariantId = null,
  observacao = STOCK_PULL_OBSERVACAO,
  fetchProductIfMissing = true,
}) {
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;

  const byProduct = new Map();
  for (const map of maps) {
    if (!map.produto_cor_tamanho_id || !map.external_variant_id) {
      skipped += 1;
      continue;
    }
    const productKey = String(map.external_product_id);
    if (!byProduct.has(productKey)) byProduct.set(productKey, []);
    byProduct.get(productKey).push(map);
  }

  const apiCreds = creds || requireNuvemshopCredentials();

  async function resolveTargetStock(nv, product, externalVariantId) {
    const fromCatalog = stockByVariantId?.get?.(String(externalVariantId));
    if (fromCatalog != null && Number.isFinite(Number(fromCatalog))) {
      return normalizeNuvemshopStock(fromCatalog);
    }

    const hasInlineStock = (variant) => (
      (variant?.stock !== undefined && variant?.stock !== null && variant?.stock !== '')
      || (Array.isArray(variant?.inventory_levels) && variant.inventory_levels.length > 0)
    );

    if (hasInlineStock(nv)) {
      return resolveNuvemshopVariantStock(nv, product);
    }

    if (fetchProductIfMissing && product?.id && nv?.id) {
      try {
        const fresh = await getProductVariant(
          integration.store_id,
          integration.access_token,
          product.id,
          nv.id,
          apiCreds,
        );
        if (hasInlineStock(fresh)) {
          return resolveNuvemshopVariantStock(fresh, product);
        }
      } catch (err) {
        console.warn('[stock pull] Falha ao buscar variação na Nuvemshop:', err.message);
      }
    }

    return resolveNuvemshopVariantStock(nv, product);
  }

  for (const [externalProductId, productMaps] of byProduct) {
    let variants = nuvemVariantsByProductId?.get?.(externalProductId);
    let product = productByExternalId?.get?.(externalProductId) || null;

    if (!variants?.length && fetchProductIfMissing) {
      product = await getProduct(
        integration.store_id,
        integration.access_token,
        externalProductId,
        apiCreds,
      );
      variants = nuvemVariantsFromProduct(product);
    }

    variants = variants || [];

    for (const map of productMaps) {
      const nv = variants.find((v) => String(v.id) === String(map.external_variant_id));
      if (!nv) {
        skipped += 1;
        continue;
      }

      const target = await resolveTargetStock(nv, product, map.external_variant_id);
      const result = await applyStockTarget(clienteId, estoqueCtx, {
        produtoId: map.produto_id,
        variacaoId: map.produto_cor_tamanho_id,
        targetStock: target,
        observacao,
      });

      if (result.changed) {
        updated += 1;
        await supabase.from('marketplace_produto_map')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_direction: 'stock_nuvemshop',
          })
          .eq('id', map.id);
      } else {
        unchanged += 1;
      }
    }
  }

  return { updated, skipped, unchanged };
}

export async function pullProductStockFromNuvemshop({
  clienteId,
  produtoId,
  integration,
  creds,
  supabase,
  estoqueCtx,
  nuvemVariants = null,
  externalProductId = null,
  nuvemProduct = null,
  stockByVariantId = null,
  observacao = STOCK_IMPORT_OBSERVACAO,
}) {
  if (!isIntegrationStockSyncEnabled(integration)) {
    return { updated: 0, skipped: 0, unchanged: 0, reason: 'stock_sync_disabled' };
  }

  const { data: maps } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integration.id)
    .eq('produto_id', produtoId);

  if (!maps?.length) return { updated: 0, skipped: 0, unchanged: 0 };

  const nuvemVariantsByProductId = new Map();
  const productByExternalId = new Map();
  if (nuvemVariants?.length && externalProductId) {
    nuvemVariantsByProductId.set(String(externalProductId), nuvemVariants);
  }
  if (nuvemProduct && externalProductId) {
    productByExternalId.set(String(externalProductId), nuvemProduct);
  }

  return pullStockForMaps({
    clienteId,
    maps,
    integration,
    creds,
    estoqueCtx,
    supabase,
    nuvemVariantsByProductId,
    productByExternalId,
    stockByVariantId,
    observacao,
    fetchProductIfMissing: !nuvemVariantsByProductId.has(String(externalProductId)),
  });
}

export async function pullStockFromNuvemshopForExternalProduct(clienteId, externalProductId, {
  integration,
  creds,
  usuarioId,
}) {
  if (!integration) return { skipped: true, reason: 'not_connected' };
  if (!isIntegrationStockSyncEnabled(integration)) {
    return { skipped: true, reason: 'stock_sync_disabled' };
  }

  const apiCreds = creds || requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id,
  });

  const product = await getProduct(
    integration.store_id,
    integration.access_token,
    externalProductId,
    apiCreds,
  );

  const { data: maps, error } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integration.id)
    .eq('external_product_id', String(externalProductId));

  if (error) throw error;
  if (!maps?.length) return { updated: 0, skipped: 0, unchanged: 0 };

  const nuvemVariantsByProductId = new Map([
    [String(externalProductId), nuvemVariantsFromProduct(product)],
  ]);

  return pullStockForMaps({
    clienteId,
    maps,
    integration,
    creds: apiCreds,
    estoqueCtx,
    supabase,
    nuvemVariantsByProductId,
    fetchProductIfMissing: false,
  });
}

export async function syncStockFromAzoupVariacao(clienteId, {
  variacaoId,
  produtoId,
  observacao,
  pontaEstoqueId,
  integration,
  creds,
  estoqueCtx,
}) {
  if (isMarketplaceOriginatedObservation(observacao)) {
    return { skipped: true, reason: 'marketplace_origin' };
  }

  if (integration && !isIntegrationStockSyncEnabled(integration)) {
    return { skipped: true, reason: 'stock_sync_disabled' };
  }

  const maps = integration?.id
    ? (await loadMapsForVariacao(clienteId, variacaoId)).filter((m) => m.integracao_id === integration.id)
    : await loadMapsForVariacao(clienteId, variacaoId);

  if (!maps.length) return { skipped: true, reason: 'not_mapped' };

  const movementPontaId = String(pontaEstoqueId || '').trim() || null;
  const apiCreds = creds || requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const ctxCache = new Map();
  let updated = 0;
  let lastStock = null;

  for (const map of maps) {
    const integ = integration?.id === map.integracao_id
      ? integration
      : await getIntegrationById(clienteId, map.integracao_id);
    if (!integ || !isIntegrationStockSyncEnabled(integ)) continue;

    if (
      movementPontaId
      && integ.ponta_estoque_id
      && String(integ.ponta_estoque_id) !== movementPontaId
    ) {
      continue;
    }

    const ctx = await resolveEstoqueCtxForPonta(
      clienteId,
      integ.ponta_estoque_id || null,
      ctxCache,
      estoqueCtx,
    );
    const stock = getVariacaoSaldo(ctx, variacaoId, produtoId || map.produto_id) ?? 0;
    lastStock = stock;

    await replaceNuvemshopVariantStock(
      integ.store_id,
      integ.access_token,
      map.external_product_id,
      map.external_variant_id,
      stock,
      apiCreds,
    );

    await supabase.from('marketplace_produto_map')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_direction: 'stock_azoup',
      })
      .eq('id', map.id);
    updated += 1;
  }

  if (updated > 0) {
    const primaryIntegration = integration || await getIntegrationById(clienteId, maps[0]?.integracao_id);
    await logStockAutoPush(clienteId, {
      integration: primaryIntegration,
      variacaoId,
      produtoId: produtoId || maps[0]?.produto_id,
      stock: lastStock,
      count: updated,
      source: 'azoup_change',
    });
  }

  return updated > 0
    ? { updated: true, stock: lastStock, count: updated }
    : {
      skipped: true,
      reason: movementPontaId ? 'stock_sync_disabled_unmapped_or_wrong_ponta' : 'stock_sync_disabled_or_unmapped',
    };
}

/** Dispara push Azoup → Nuvemshop após alteração de estoque (ledger). */
export async function propagateStockChangeToMarketplaces(clienteId, {
  variacaoId,
  produtoId,
  observacao,
} = {}) {
  if (!clienteId || !variacaoId) {
    return { skipped: true, reason: 'missing_fields' };
  }
  return syncStockFromAzoupVariacao(clienteId, {
    variacaoId,
    produtoId,
    observacao,
  });
}

async function logStockAutoPush(clienteId, {
  integration,
  variacaoId,
  produtoId,
  stock,
  count,
  source,
}) {
  await logIntegracaoEvent(clienteId, {
    categoria: 'estoque',
    nivel: 'success',
    acao: 'stock_auto_push',
    titulo: `Estoque enviado automaticamente para a loja (${stock} un.)`,
    integracaoId: integration?.id || null,
    lojaNome: integration?.nome || integration?.store_name || null,
    mensagem: source === 'webhook'
      ? 'Atualização disparada por webhook da Nuvemshop.'
      : 'Atualização disparada por alteração de estoque no Azoup.',
    referenciaTipo: 'variacao',
    referenciaId: variacaoId,
    payload: { stock, count, produto_id: produtoId, source },
  });
}

async function getIntegrationById(clienteId, integracaoId) {
  const { getIntegrationById: load } = await import('./marketplaceIntegrationRead.js');
  return load(clienteId, integracaoId);
}

export async function pushStockToNuvemshopForExternalProduct(clienteId, externalProductId, {
  integration,
  creds,
  usuarioId,
}) {
  if (!integration) return { skipped: true, reason: 'not_connected' };

  const apiCreds = creds || requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id,
  });

  const { data: maps, error } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integration.id)
    .eq('external_product_id', String(externalProductId));

  if (error) throw error;
  if (!maps?.length) return { updated: 0, skipped: 0 };

  let updated = 0;
  let skipped = 0;

  for (const map of maps) {
    if (!map.produto_cor_tamanho_id || !map.external_variant_id) {
      skipped += 1;
      continue;
    }

    const stock = getVariacaoSaldo(
      estoqueCtx,
      map.produto_cor_tamanho_id,
      map.produto_id,
    ) ?? 0;

    await updateVariantStock(
      integration.store_id,
      integration.access_token,
      map.external_product_id,
      {
        id: map.external_variant_id,
        action: 'replace',
        value: normalizeNuvemshopStock(stock),
      },
      apiCreds,
    );

    await supabase.from('marketplace_produto_map')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_direction: 'stock_azoup',
      })
      .eq('id', map.id);

    updated += 1;
  }

  return { updated, skipped };
}

export async function syncStockFromNuvemshopProduct(clienteId, externalProductId, options = {}) {
  return pullStockFromNuvemshopForExternalProduct(clienteId, externalProductId, options);
}

export async function syncProductStockFromAzoup(clienteId, { produtoIds = [] } = {}, options = {}) {
  const { resolveIntegration } = await import('./marketplaceSync.js');
  const integration = await resolveIntegration(clienteId, options.integracaoId);
  if (!isIntegrationStockSyncEnabled(integration)) {
    return { skipped: true, reason: 'stock_sync_disabled', results: [] };
  }

  const creds = requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id || options.pontaEstoqueId,
  });

  const ids = [...new Set(produtoIds.map(String).filter(Boolean))];
  const results = [];

  for (const produtoId of ids) {
    try {
      const pushResult = await pushProductStockToNuvemshop({
        clienteId,
        produtoId,
        integration,
        creds,
        supabase,
        estoqueCtx,
      });
      results.push({ produtoId, success: true, ...pushResult });
    } catch (err) {
      results.push({ produtoId, success: false, error: err.message });
    }
  }

  return { results };
}

export async function handleAzoupStockChangedWebhook(payload) {
  const clienteId = String(payload?.clienteId || payload?.cliente_id || '').trim();
  const variacaoId = String(payload?.variacaoId || payload?.variacao_id || '').trim();
  const produtoId = String(payload?.produtoId || payload?.produto_id || '').trim() || undefined;
  const pontaEstoqueId = String(
    payload?.pontaEstoqueId || payload?.ponta_estoque_id || '',
  ).trim() || undefined;
  const observacao = payload?.observacao || null;

  if (!clienteId || !variacaoId) {
    return { skipped: true, reason: 'missing_fields' };
  }

  const creds = requireNuvemshopCredentials();

  const result = await syncStockFromAzoupVariacao(clienteId, {
    variacaoId,
    produtoId,
    pontaEstoqueId,
    observacao,
    integration: null,
    creds,
  });

  if (result.updated) {
    console.info(
      `[stock-changed] cliente=${clienteId} variação=${variacaoId} `
      + `ponta=${pontaEstoqueId || '—'} → ${result.count} loja(s), saldo ${result.stock}`,
    );
  }

  return result;
}

export async function handleNuvemshopWebhookEvent(body) {
  const storeId = String(body?.store_id || '');
  const event = String(body?.event || '');
  const resourceId = body?.id != null ? String(body.id) : '';

  if (!storeId || !event) {
    return { skipped: true, reason: 'invalid_payload' };
  }

  const integrations = await listConnectedIntegrationsByStoreId(storeId);
  if (!integrations.length) {
    return { skipped: true, reason: 'store_not_connected' };
  }

  if (integrations.length > 1) {
    console.warn(
      `[webhook] Loja ${storeId} vinculada a ${integrations.length} clientes Azoup; processando todas.`,
    );
  }

  const results = [];
  for (const integration of integrations) {
    try {
      const result = await processNuvemshopWebhookForIntegration(
        integration,
        event,
        resourceId,
        storeId,
      );
      results.push({
        clienteId: integration.cliente_id,
        integracaoId: integration.id,
        ...result,
      });
    } catch (err) {
      console.error(`[webhook] Falha cliente ${integration.cliente_id}:`, err.message);
      results.push({
        clienteId: integration.cliente_id,
        integracaoId: integration.id,
        error: err.message,
      });
    }
  }

  return integrations.length === 1 ? results[0] : { processed: results.length, results };
}
