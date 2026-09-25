import crypto from 'crypto';
import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { assertPontaEstoqueForTenant } from './estoqueLedger.js';
import { assertTabelaPrecoForTenant } from './productPrices.js';
import { decryptToken, encryptToken } from './tokenCrypto.js';
import {
  getNuvemshopImportStatusDefinitions,
  normalizeImportStatusConfig,
  validateImportStatusPayload,
} from './nuvemshopOrderStatuses.js';
import { logIntegracaoEvent, logLegacyMarketplaceSync } from './integracaoEventLog.js';
import { requireNuvemshopCredentials } from './marketplaceConfig.js';
import { getIntegrationById } from './marketplaceIntegrationRead.js';
import {
  createProduct,
  createProductImage,
  createProductVariant,
  flattenNuvemProducts,
  getProduct,
  listAllProductsWithVariants,
  parseVariantAttributes,
  updateProduct,
  updateVariant,
  updateVariantStock,
  replaceNuvemshopVariantStock,
  buildNuvemshopProductPayload,
  buildNuvemshopVariantCreatePayload,
  buildNuvemshopVariantDimensions,
  buildNuvemshopDescription,
  findNuvemVariantForAzoup,
  resolveNuvemshopAttributeSchema,
  normalizeNuvemshopStock,
  resolveNuvemshopVariantStock,
} from './nuvemshopClient.js';
import {
  applyStockTarget,
  createEstoqueLedgerContext,
  getPontaEstoqueInfo,
  getVariacaoSaldo,
  stocksAreDifferent,
  stockConflictRequiresSync,
  skusAreDifferent,
} from './estoqueLedger.js';
import {
  fetchAllProductImageUrls,
  importNuvemshopProductImages,
  exportProductImagesToNuvemshop,
  linkCreatedNuvemImagesToAzoup,
} from './productImages.js';
import { resolveNuvemshopCategoryIdsForProduct } from './marketplaceCategories.js';
import {
  formatNuvemshopPrice,
  getDefaultPriceTableId,
  getSalePriceFromMap,
  loadSalePricesForProducts,
  loadSalePricesForVariations,
  pricesAreDifferent,
} from './productPrices.js';
import {
  pullProductStockFromNuvemshop,
  pushProductStockToNuvemshop,
} from './marketplaceStockSync.js';
import { registerNuvemshopStockWebhooks } from './marketplaceWebhooks.js';
import { pruneStaleMarketplaceProductMaps } from './marketplaceProductMap.js';
import {
  isIntegrationStockSyncEnabled,
  normalizeIntegrationStockSyncFlag,
  listConnectedIntegrationsRows,
  selectIntegrationSettingsRow,
  updateIntegrationRow,
} from './marketplaceIntegration.js';

const MARKETPLACE = 'nuvemshop';

function normalizeProductName(name) {
  return String(name || '').trim().toLowerCase();
}

function resolveExternalProductIdFromMaps(existingMaps = []) {
  const counts = new Map();
  for (const map of existingMaps) {
    const id = map.external_product_id ? String(map.external_product_id) : null;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function loadExportExistingMaps(supabase, clienteId, integrationId, produtoId) {
  const base = () => supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('produto_id', produtoId);

  const { data: mapped, error } = await base().eq('integracao_id', integrationId);
  if (error) throw error;
  if (mapped?.length) return mapped;

  const { data: legacy, error: legacyError } = await base().is('integracao_id', null);
  if (legacyError) throw legacyError;
  return legacy || [];
}

const PRODUTO_EXPORT_SELECT_BASE = `
  id, nome, sku, cliente_id, categoria_id, subcategoria_id,
  categorias ( nome ),
  subcategorias ( nome ),
  produto_cor_tamanho (id, cor, tamanho, sku_variacao, ean13, ordem)
`;

const PRODUTO_EXPORT_SELECT_EXTENDED = `
  id, nome, sku, cliente_id, categoria_id, subcategoria_id,
  descricao, peso, altura, largura, comprimento,
  categorias ( nome ),
  subcategorias ( nome ),
  produto_cor_tamanho (id, cor, tamanho, sku_variacao, ean13, ordem)
`;

function isMissingColumnError(error) {
  const message = String(error?.message || '');
  return error?.code === '42703'
    || /column .* does not exist/i.test(message)
    || /Could not find the .* column/i.test(message);
}

async function loadProdutoForExport(supabase, clienteId, produtoId) {
  const { data, error } = await supabase
    .from('produtos')
    .select(PRODUTO_EXPORT_SELECT_EXTENDED)
    .eq('id', produtoId)
    .eq('cliente_id', clienteId)
    .single();

  if (!error && data) return data;

  if (isMissingColumnError(error)) {
    const fallback = await supabase
      .from('produtos')
      .select(PRODUTO_EXPORT_SELECT_BASE)
      .eq('id', produtoId)
      .eq('cliente_id', clienteId)
      .single();

    if (fallback.error || !fallback.data) {
      throw fallback.error || new Error('Produto não encontrado');
    }

    return {
      ...fallback.data,
      descricao: null,
      peso: null,
      altura: null,
      largura: null,
      comprimento: null,
    };
  }

  throw error || new Error('Produto não encontrado');
}

function collectAzoupSkus(produto, variations) {
  const skus = new Set();
  if (produto?.sku) skus.add(String(produto.sku));
  for (const variation of variations) {
    if (variation.sku_variacao) skus.add(String(variation.sku_variacao));
  }
  return skus;
}

function nuvemProductSharesSku(nuvemProduct, azoupSkus) {
  if (nuvemProduct?.sku && azoupSkus.has(String(nuvemProduct.sku))) return true;
  for (const variant of nuvemProduct?.variants || []) {
    if (variant.sku && azoupSkus.has(String(variant.sku))) return true;
  }
  return false;
}

async function findNuvemProductForAzoupExport({
  supabase,
  clienteId,
  integration,
  creds,
  produto,
  variationsWithPrice,
  existingMaps,
}) {
  const fromMaps = resolveExternalProductIdFromMaps(existingMaps);
  if (fromMaps) return fromMaps;

  const normalizedName = normalizeProductName(produto.nome);
  if (!normalizedName) return null;

  const azoupSkus = collectAzoupSkus(produto, variationsWithPrice);
  const nuvemProducts = await listAllProductsWithVariants(
    integration.store_id,
    integration.access_token,
    creds,
  );

  const nameMatches = nuvemProducts.filter((p) => (
    normalizeProductName(p.name?.pt || p.name?.es || p.name) === normalizedName
  ));
  if (!nameMatches.length) return null;

  const candidates = [];

  for (const product of nameMatches) {
    const externalId = String(product.id);
    const { data: foreignMaps } = await supabase
      .from('marketplace_produto_map')
      .select('produto_id')
      .eq('cliente_id', clienteId)
      .eq('marketplace', MARKETPLACE)
      .eq('integracao_id', integration.id)
      .eq('external_product_id', externalId)
      .limit(1);

    if (foreignMaps?.length && foreignMaps[0].produto_id !== produto.id) {
      continue;
    }

    if (nuvemProductSharesSku(product, azoupSkus)) {
      candidates.unshift(product);
      continue;
    }

    candidates.push(product);
  }

  if (!candidates.length) return null;
  if (candidates.length === 1) return String(candidates[0].id);

  const skuMatched = candidates.find((p) => nuvemProductSharesSku(p, azoupSkus));
  return skuMatched ? String(skuMatched.id) : null;
}

function resolveExportTargetAttributes(variationsWithPrice, nuvemExisting) {
  const catalogSchema = resolveNuvemshopAttributeSchema(variationsWithPrice, null);
  if (!nuvemExisting?.attributes?.length) {
    return catalogSchema.attributes;
  }

  const existingSchema = resolveNuvemshopAttributeSchema(
    variationsWithPrice,
    nuvemExisting.attributes,
  );

  if (catalogSchema.mode !== existingSchema.mode
    || catalogSchema.attributes.length !== existingSchema.attributes.length) {
    return catalogSchema.attributes;
  }

  return nuvemExisting.attributes;
}

async function pushProductVariantDimensionsToNuvemshop({
  integration,
  creds,
  produto,
  externalProductId,
  externalVariantIds = [],
}) {
  const dimensions = buildNuvemshopVariantDimensions(produto);
  if (!Object.keys(dimensions).length || !externalProductId) {
    return { updated: 0, skipped: true };
  }

  const uniqueIds = [...new Set(
    externalVariantIds.map(String).filter(Boolean),
  )];
  if (!uniqueIds.length) return { updated: 0, skipped: true };

  let updated = 0;
  const errors = [];

  for (const variantId of uniqueIds) {
    try {
      await updateVariant(
        integration.store_id,
        integration.access_token,
        externalProductId,
        variantId,
        dimensions,
        creds,
      );
      updated += 1;
    } catch (err) {
      errors.push({ variantId, message: err.message });
      console.warn('[export] Falha ao gravar peso/dimensões na Nuvemshop:', variantId, err.message);
    }
  }

  return { updated, errors };
}

async function pushProductDescriptionToNuvemshop({
  integration,
  creds,
  externalProductId,
  descricao,
}) {
  const description = buildNuvemshopDescription(descricao);
  if (!description || !externalProductId) return { updated: false };

  try {
    await updateProduct(
      integration.store_id,
      integration.access_token,
      externalProductId,
      { description },
      creds,
    );
    return { updated: true };
  } catch (err) {
    console.warn('[export] Falha ao gravar descrição na Nuvemshop:', err.message);
    return { updated: false, error: err.message };
  }
}

export { isIntegrationStockSyncEnabled } from './marketplaceIntegration.js';
export { getIntegrationById };

export async function getIntegration(clienteId, integracaoId = null) {
  if (integracaoId) return getIntegrationById(clienteId, integracaoId);

  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_integracao')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('status', 'connected')
    .order('connected_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    access_token: decryptToken(data.access_token),
  };
}

export async function resolveIntegration(clienteId, integracaoId) {
  const id = String(integracaoId || '').trim();
  if (!id) throw new Error('Selecione uma loja vinculada.');
  const integration = await getIntegrationById(clienteId, id);
  if (!integration) throw new Error('Loja vinculada não encontrada ou desconectada.');
  return integration;
}

export async function listIntegrations(clienteId) {
  const supabase = requireSupabaseAdmin();
  const data = await listConnectedIntegrationsRows(supabase, clienteId);

  return data.map((row) => ({
    ...row,
    import_order_statuses: row.import_order_statuses ?? null,
    sync_estoque: normalizeIntegrationStockSyncFlag(row.sync_estoque),
  }));
}

export async function updateIntegrationSettings(clienteId, integracaoId, settings) {
  const supabase = requireSupabaseAdmin();
  const patch = { updated_at: new Date().toISOString() };

  if (settings.nome != null) {
    const nome = String(settings.nome).trim();
    if (!nome) throw new Error('Nome da loja é obrigatório.');
    patch.nome = nome;
  }
  if (settings.tabela_preco_id !== undefined) {
    if (!settings.tabela_preco_id) throw new Error('Tabela de preço é obrigatória.');
    patch.tabela_preco_id = await assertTabelaPrecoForTenant(clienteId, settings.tabela_preco_id);
  }
  if (settings.ponta_estoque_id !== undefined) {
    if (!settings.ponta_estoque_id) throw new Error('Ponto de estoque é obrigatório.');
    patch.ponta_estoque_id = await assertPontaEstoqueForTenant(clienteId, settings.ponta_estoque_id);
  }

  const beforeRow = await selectIntegrationSettingsRow(supabase, clienteId, integracaoId);

  if (settings.import_order_statuses !== undefined || settings.importOrderStatuses !== undefined) {
    const rawPayload = settings.import_order_statuses ?? settings.importOrderStatuses;
    if (beforeRow?.marketplace === 'tray') {
      const { validateImportStatusPayload: validateTray } = await import('./trayOrderStatuses.js');
      patch.import_order_statuses = validateTray(rawPayload);
    } else {
      patch.import_order_statuses = validateImportStatusPayload(rawPayload);
    }
  }
  if ('sync_estoque' in settings || 'syncEstoque' in settings) {
    patch.sync_estoque = normalizeIntegrationStockSyncFlag(
      settings.sync_estoque ?? settings.syncEstoque,
    );
  }

  const data = await updateIntegrationRow(supabase, clienteId, integracaoId, patch);
  if (!data) throw new Error('Loja vinculada não encontrada.');

  if (patch.import_order_statuses) {
    await logIntegracaoEvent(clienteId, {
      categoria: 'configuracao',
      nivel: 'info',
      acao: 'order_import_rules',
      titulo: `Regras de importação de pedidos atualizadas — ${data.nome}`,
      integracaoId,
      lojaNome: data.nome,
      mensagem: 'Status de pedido/pagamento configurados para virar Pedido Aprovado.',
      payload: {
        anterior: beforeRow?.import_order_statuses || null,
        atual: patch.import_order_statuses,
      },
      usuarioId: settings.usuarioId || null,
    });
  }

  if (patch.nome && beforeRow?.nome && patch.nome !== beforeRow.nome) {
    await logIntegracaoEvent(clienteId, {
      categoria: 'configuracao',
      nivel: 'info',
      acao: 'store_rename',
      titulo: `Loja renomeada para "${data.nome}"`,
      integracaoId,
      lojaNome: data.nome,
      payload: { nome_anterior: beforeRow.nome, nome_novo: data.nome },
      usuarioId: settings.usuarioId || null,
    });
  }

  if (patch.sync_estoque !== undefined
    && normalizeIntegrationStockSyncFlag(beforeRow?.sync_estoque) !== patch.sync_estoque) {
    await logIntegracaoEvent(clienteId, {
      categoria: 'configuracao',
      nivel: 'info',
      acao: 'stock_sync_toggle',
      titulo: patch.sync_estoque
        ? `Sincronização de estoque ativada — ${data.nome}`
        : `Sincronização de estoque desativada — ${data.nome}`,
      integracaoId,
      lojaNome: data.nome,
      payload: { sync_estoque: patch.sync_estoque },
      usuarioId: settings.usuarioId || null,
    });
  }

  return {
    ...data,
    sync_estoque: normalizeIntegrationStockSyncFlag(
      data?.sync_estoque ?? patch.sync_estoque ?? beforeRow?.sync_estoque,
    ),
    importOrderStatuses: normalizeImportStatusConfig(data.import_order_statuses),
  };
}

export function getOrderImportStatusDefinitions() {
  return getNuvemshopImportStatusDefinitions();
}

async function logSync(clienteId, action, status, extra = {}) {
  await logLegacyMarketplaceSync(clienteId, action, status, extra);
}

async function loadAzoupCatalog(clienteId, integracaoId, estoqueCtx = null, tabelaPrecoId = null) {
  const supabase = requireSupabaseAdmin();
  const ctx = estoqueCtx || await createEstoqueLedgerContext(clienteId);

  const { data: produtos, error } = await supabase
    .from('produtos')
    .select(`
      id, nome, sku, inativo, ncm, unidade, grupo_fiscal_id, origem_id,
      produto_cor_tamanho (
        id, cor, tamanho, sku_variacao, ean13
      )
    `)
    .eq('cliente_id', clienteId)
    .order('nome');

  if (error) throw error;

  const { data: maps } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integracaoId);

  const mapByExternal = new Map(
    (maps || []).map((m) => [String(m.external_variant_id), m]),
  );
  const mapByVariacao = new Map((maps || []).map((m) => [m.produto_cor_tamanho_id, m]));

  const produtoIds = [...new Set((produtos || []).map((p) => p.id))];
  const priceByKey = await loadSalePricesForProducts(clienteId, produtoIds, tabelaPrecoId);

  const rows = [];
  for (const p of produtos || []) {
    const variations = p.produto_cor_tamanho || [];
    if (variations.length === 0) {
      rows.push({
        produto_id: p.id,
        produto_cor_tamanho_id: null,
        nome: p.nome,
        sku: p.sku,
        cor: 'Único',
        tamanho: 'Único',
        estoque: null,
        ean13: '',
        map: null,
      });
      continue;
    }
    for (const v of variations) {
      const map = mapByVariacao.get(v.id) || null;
      rows.push({
        produto_id: p.id,
        produto_cor_tamanho_id: v.id,
        nome: p.nome,
        sku: v.sku_variacao || p.sku,
        cor: v.cor,
        tamanho: v.tamanho,
        estoque: getVariacaoSaldo(ctx, v.id, p.id, variations.length),
        preco: getSalePriceFromMap(priceByKey, p.id, v.cor, v.tamanho),
        ean13: v.ean13 || '',
        map,
      });
    }
  }

  return { rows, mapByExternal, mapByVariacao, produtos: produtos || [], estoqueCtx: ctx };
}

function matchKey(row) {
  return `${(row.sku || '').trim().toLowerCase()}|${(row.ean13 || row.barcode || '').trim()}`;
}

function buildCompareItemDates(map, nv) {
  const last_sync_at = map?.last_sync_at || null;
  const last_sync_direction = map?.last_sync_direction || null;
  const product_updated_at = nv?.product_updated_at || null;
  const timestamps = [last_sync_at, product_updated_at]
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter(Number.isFinite);
  const last_updated_at = timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : null;

  return {
    last_sync_at,
    last_sync_direction,
    product_updated_at,
    last_updated_at,
  };
}

function shouldCompareSkuForConflict(az, azoupRows) {
  const sku = String(az?.sku || '').trim();
  if (!sku || !az?.produto_id || !azoupRows?.length) return true;

  const sameSkuCount = azoupRows.filter(
    (row) => row.produto_id === az.produto_id && String(row.sku || '').trim() === sku,
  ).length;

  return sameSkuCount <= 1;
}

function resolveCompareConflict(az, nv, azoupRows, { stockSyncEnabled = true } = {}) {
  if (!az || !nv) {
    return { status: 'linked', conflict_reasons: [] };
  }

  const reasons = [];
  const stockAzoup = az.estoque ?? 0;
  const stockNuvem = nv.stock ?? 0;

  if (stockSyncEnabled && stockConflictRequiresSync(stockAzoup, stockNuvem)) {
    reasons.push('estoque');
  }
  if (shouldCompareSkuForConflict(az, azoupRows) && skusAreDifferent(az.sku, nv.sku)) {
    reasons.push('sku');
  }
  if (pricesAreDifferent(az.preco, nv.price)) reasons.push('preco');

  return {
    status: reasons.length ? 'conflict' : 'linked',
    conflict_reasons: reasons,
  };
}

function buildCompareSummary(results, { stockSyncEnabled = true } = {}) {
  return {
    total: results.length,
    linked: results.filter((r) => r.status === 'linked').length,
    conflict: results.filter((r) => r.status === 'conflict').length,
    only_azoup: results.filter((r) => r.status === 'only_azoup').length,
    only_nuvemshop: results.filter((r) => r.status === 'only_nuvemshop').length,
    stock_diff: stockSyncEnabled
      ? results.filter((r) =>
        r.azoup && r.nuvemshop
        && stockConflictRequiresSync(r.azoup.estoque, r.nuvemshop.estoque),
      ).length
      : 0,
    price_diff: results.filter((r) =>
      r.azoup && r.nuvemshop && pricesAreDifferent(r.azoup.preco, r.nuvemshop.price),
    ).length,
  };
}

function applyStockConflictResolutionToCompareItem(item) {
  if (!item?.nuvemshop || !item?.azoup) return item;

  item.nuvemshop.estoque = item.azoup.estoque;
  item.conflict_reasons = (item.conflict_reasons || []).filter((reason) => reason !== 'estoque');
  item.status = item.conflict_reasons.length ? 'conflict' : 'linked';
  return item;
}

async function autoResolveStockConflicts(clienteId, compareItems, options = {}) {
  const stockConflicts = (compareItems || []).filter(
    (item) => item.map_id
      && item.conflict_reasons?.includes('estoque')
      && item.azoup != null
      && item.nuvemshop != null
      && stockConflictRequiresSync(item.azoup.estoque, item.nuvemshop.estoque),
  );

  if (!stockConflicts.length) {
    return { resolved: 0, attempted: 0, results: [] };
  }

  const syncResult = await syncStock(
    clienteId,
    stockConflicts.map((item) => ({
      mapId: item.map_id,
      direction: 'azoup_to_nuvemshop',
    })),
    options,
  );

  let resolved = 0;
  for (const item of stockConflicts) {
    const ok = syncResult.results.some(
      (row) => row.mapId === item.map_id && row.success,
    );
    if (ok) {
      applyStockConflictResolutionToCompareItem(item);
      resolved += 1;
    }
  }

  return {
    resolved,
    attempted: stockConflicts.length,
    results: syncResult.results,
  };
}

export async function compareCatalog(clienteId, options = {}) {
  const integration = await resolveIntegration(clienteId, options.integracaoId);
  const stockSyncEnabled = isIntegrationStockSyncEnabled(integration);

  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id || options.pontaEstoqueId,
  });
  const pontaEstoque = await getPontaEstoqueInfo(clienteId, estoqueCtx.pontaEstoqueId);

  const creds = requireNuvemshopCredentials();
  let nuvemProducts;
  try {
    nuvemProducts = await listAllProductsWithVariants(
      integration.store_id,
      integration.access_token,
      creds,
    );
  } catch (err) {
    throw new Error(`Não foi possível listar produtos da Nuvemshop: ${err.message}`);
  }
  const nuvemRows = flattenNuvemProducts(nuvemProducts);
  const catalog = await loadAzoupCatalog(
    clienteId,
    integration.id,
    estoqueCtx,
    integration.tabela_preco_id,
  );

  await pruneStaleMarketplaceProductMaps({
    clienteId,
    integracaoId: integration.id,
    azoupRows: catalog.rows,
    nuvemRows,
    integracaoNome: integration.nome || integration.store_name,
    usuarioId: options.usuarioId,
  });

  const { rows: azoupRows, mapByExternal, mapByVariacao } = await loadAzoupCatalog(
    clienteId,
    integration.id,
    estoqueCtx,
    integration.tabela_preco_id,
  );

  const usedAzoup = new Set();
  const usedNuvem = new Set();
  const results = [];

  const allMaps = [...mapByExternal.values()];

  for (const map of allMaps) {
    const az = azoupRows.find(
      (r) => r.produto_cor_tamanho_id === map.produto_cor_tamanho_id,
    );
    const nv = nuvemRows.find(
      (r) => String(r.external_variant_id) === String(map.external_variant_id),
    );
    if (az) usedAzoup.add(az.produto_cor_tamanho_id || az.produto_id);
    if (nv) usedNuvem.add(String(nv.external_variant_id));

    const stockAzoup = az?.estoque ?? 0;
    const stockNuvem = nv?.stock ?? 0;
    const { status, conflict_reasons } = resolveCompareConflict(
      az ? { ...az, estoque: stockAzoup } : null,
      nv ? { ...nv, stock: stockNuvem } : null,
      azoupRows,
      { stockSyncEnabled },
    );

    results.push({
      status,
      conflict_reasons,
      map_id: map.id,
      produto_id: map.produto_id,
      produto_cor_tamanho_id: map.produto_cor_tamanho_id,
      external_product_id: map.external_product_id,
      external_variant_id: map.external_variant_id,
      ...buildCompareItemDates(map, nv),
      azoup: az ? {
        nome: az.nome,
        sku: az.sku,
        cor: az.cor,
        tamanho: az.tamanho,
        estoque: stockAzoup,
        preco: az.preco,
      } : null,
      nuvemshop: nv ? {
        nome: nv.product_name,
        sku: nv.sku,
        cor: nv.cor,
        tamanho: nv.tamanho,
        estoque: stockNuvem,
        price: nv.price,
      } : null,
    });
  }

  for (const nv of nuvemRows) {
    const nvVariantId = String(nv.external_variant_id);
    if (usedNuvem.has(nvVariantId)) continue;
    if (mapByExternal.has(nvVariantId)) {
      usedNuvem.add(nvVariantId);
      continue;
    }

    const skuMatch = azoupRows.find(
      (a) => !usedAzoup.has(a.produto_cor_tamanho_id || a.produto_id)
        && a.sku && nv.sku && String(a.sku) === String(nv.sku),
    );
    if (skuMatch) {
      usedAzoup.add(skuMatch.produto_cor_tamanho_id || skuMatch.produto_id);
      usedNuvem.add(nvVariantId);
      const { status, conflict_reasons } = resolveCompareConflict(
        skuMatch,
        nv,
        azoupRows,
        { stockSyncEnabled },
      );
      results.push({
        status,
        conflict_reasons,
        map_id: null,
        produto_id: skuMatch.produto_id,
        produto_cor_tamanho_id: skuMatch.produto_cor_tamanho_id,
        external_product_id: nv.external_product_id,
        external_variant_id: nv.external_variant_id,
        ...buildCompareItemDates(null, nv),
        azoup: {
          nome: skuMatch.nome,
          sku: skuMatch.sku,
          cor: skuMatch.cor,
          tamanho: skuMatch.tamanho,
          estoque: skuMatch.estoque,
          preco: skuMatch.preco,
        },
        nuvemshop: {
          nome: nv.product_name,
          sku: nv.sku,
          cor: nv.cor,
          tamanho: nv.tamanho,
          estoque: nv.stock,
          price: nv.price,
        },
      });
      continue;
    }

    results.push({
      status: 'only_nuvemshop',
      map_id: null,
      external_product_id: nv.external_product_id,
      external_variant_id: nv.external_variant_id,
      ...buildCompareItemDates(null, nv),
      nuvemshop: {
        nome: nv.product_name,
        sku: nv.sku,
        cor: nv.cor,
        tamanho: nv.tamanho,
        estoque: nv.stock,
        price: nv.price,
      },
    });
    usedNuvem.add(nvVariantId);
  }

  for (const az of azoupRows) {
    const key = az.produto_cor_tamanho_id || az.produto_id;
    if (usedAzoup.has(key)) continue;
    if (az.produto_cor_tamanho_id && mapByVariacao.has(az.produto_cor_tamanho_id)) continue;
    results.push({
      status: 'only_azoup',
      map_id: null,
      produto_id: az.produto_id,
      produto_cor_tamanho_id: az.produto_cor_tamanho_id,
      ...buildCompareItemDates(null, null),
      azoup: {
        nome: az.nome,
        sku: az.sku,
        cor: az.cor,
        tamanho: az.tamanho,
        estoque: az.estoque,
        preco: az.preco,
      },
    });
  }

  const autoResolveStock = stockSyncEnabled && options.autoResolveStock !== false;
  let stockAutoResolve = null;
  if (autoResolveStock) {
    try {
      stockAutoResolve = await autoResolveStockConflicts(clienteId, results, {
        integracaoId: integration.id,
        usuarioId: options.usuarioId,
        pontaEstoqueId: integration.ponta_estoque_id || options.pontaEstoqueId,
      });
    } catch (err) {
      console.error('[compare] Falha ao alinhar estoque automaticamente:', err.message);
      stockAutoResolve = {
        resolved: 0,
        attempted: 0,
        error: err.message,
        results: [],
      };
    }
  }

  return {
    integracao: {
      id: integration.id,
      nome: integration.nome,
      marketplace: integration.marketplace,
      store_name: integration.store_name,
      tabela_preco_id: integration.tabela_preco_id,
      ponta_estoque_id: integration.ponta_estoque_id,
      sync_estoque: stockSyncEnabled,
    },
    pontaEstoque,
    stockAutoResolve,
    summary: buildCompareSummary(results, { stockSyncEnabled }),
    items: results,
  };
}

async function getDefaultFiscal(clienteId) {
  const supabase = requireSupabaseAdmin();
  const [{ data: gf }, { data: orig }, tabelaPrecoId] = await Promise.all([
    supabase.from('grupos_fiscais').select('id').eq('cliente_id', clienteId).limit(1).maybeSingle(),
    supabase.from('origens_produtos').select('id').limit(1).maybeSingle(),
    getDefaultPriceTableId(clienteId),
  ]);
  return {
    grupo_fiscal_id: gf?.id || null,
    origem_id: orig?.id || null,
    tabela_preco_id: tabelaPrecoId || null,
  };
}

export async function importFromNuvemshop(clienteId, importRequests, options = {}) {
  const integration = await resolveIntegration(clienteId, options.integracaoId);
  const stockSyncEnabled = isIntegrationStockSyncEnabled(integration);

  const creds = requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const fiscal = await getDefaultFiscal(clienteId);
  const tabelaPrecoId = integration.tabela_preco_id || fiscal.tabela_preco_id;
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id || options.pontaEstoqueId,
  });
  const importedProductIds = new Set();

  const nuvemProductsForPrune = await listAllProductsWithVariants(
    integration.store_id,
    integration.access_token,
    creds,
  );
  const nuvemRowsForPrune = flattenNuvemProducts(nuvemProductsForPrune);
  const { rows: azoupRowsForPrune } = await loadAzoupCatalog(
    clienteId,
    integration.id,
    estoqueCtx,
    tabelaPrecoId,
  );
  await pruneStaleMarketplaceProductMaps({
    clienteId,
    integracaoId: integration.id,
    azoupRows: azoupRowsForPrune,
    nuvemRows: nuvemRowsForPrune,
    integracaoNome: integration.nome || integration.store_name,
    usuarioId: options.usuarioId,
  });

  const nuvemStockByVariantId = new Map(
    nuvemRowsForPrune.map((row) => [String(row.external_variant_id), row.stock]),
  );

  for (const request of importRequests) {
    const externalProductId = String(request.externalProductId);

    try {
      const nuvemProductFull = await getProduct(
        integration.store_id,
        integration.access_token,
        externalProductId,
        creds,
      );

      const allVariants = nuvemProductFull.variants?.length
        ? nuvemProductFull.variants
        : [{
          id: nuvemProductFull.id,
          sku: nuvemProductFull.sku,
          price: nuvemProductFull.price,
          stock: nuvemProductFull.stock,
          barcode: nuvemProductFull.barcode,
          values: [{ pt: 'Único' }, { pt: 'Único' }],
        }];

      const { data: existingMaps } = await supabase
        .from('marketplace_produto_map')
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('marketplace', MARKETPLACE)
        .eq('integracao_id', integration.id)
        .eq('external_product_id', externalProductId);

      const mappedExternalVariants = new Set(
        (existingMaps || []).map((m) => String(m.external_variant_id)),
      );

      let variantsToImport = allVariants.filter(
        (variant) => !mappedExternalVariants.has(String(variant.id)),
      );

      if (request.externalVariantIds?.length) {
        const allowed = new Set(request.externalVariantIds.map(String));
        variantsToImport = variantsToImport.filter((variant) => allowed.has(String(variant.id)));
      }

      if (variantsToImport.length === 0) continue;

      let produtoId = existingMaps?.[0]?.produto_id || null;
      const isNewProduct = !produtoId;
      let produtoSku = '';

      if (!produtoId) {
        const firstVariant = variantsToImport[0];
        produtoSku = firstVariant.sku || nuvemProductFull.sku || String(nuvemProductFull.id);

        const { data: produto, error: prodError } = await supabase
          .from('produtos')
          .insert({
            cliente_id: clienteId,
            nome: nuvemProductFull.name?.pt || nuvemProductFull.name?.es || nuvemProductFull.name || `Produto ${nuvemProductFull.id}`,
            sku: produtoSku,
            ncm: '00000000',
            unidade: 'UN',
            grupo_fiscal_id: fiscal.grupo_fiscal_id,
            origem_id: fiscal.origem_id,
            inativo: false,
          })
          .select('id, sku')
          .single();

        if (prodError) throw prodError;
        produtoId = produto.id;
        produtoSku = produto.sku || produtoSku;

        await importNuvemshopProductImages(clienteId, produtoId, nuvemProductFull);
      } else {
        const { data: produto } = await supabase
          .from('produtos')
          .select('id, sku')
          .eq('id', produtoId)
          .single();
        produtoSku = produto?.sku || '';

        await importNuvemshopProductImages(clienteId, produtoId, nuvemProductFull);
      }

      const { data: existingPct } = await supabase
        .from('produto_cor_tamanho')
        .select('id, cor, tamanho, ordem')
        .eq('produto_id', produtoId);

      let nextOrdem = (existingPct || []).reduce(
        (max, row) => Math.max(max, Number(row.ordem) || 0),
        -1,
      );

      for (const variant of variantsToImport) {
        const { cor, tamanho } = parseVariantAttributes(variant);
        const existingRow = (existingPct || []).find(
          (row) => row.cor === cor && row.tamanho === tamanho,
        );

        let pctId = existingRow?.id;
        if (!pctId) {
          nextOrdem += 1;
          const skuVariacao = variant.sku || produtoSku || String(variant.id);
          const { data: pct, error: pctError } = await supabase
            .from('produto_cor_tamanho')
            .insert({
              produto_id: produtoId,
              cor,
              tamanho,
              sku_variacao: skuVariacao,
              ean13: variant.barcode || null,
              ordem: nextOrdem,
            })
            .select('id')
            .single();

          if (pctError) throw pctError;
          pctId = pct.id;
        }

        if (tabelaPrecoId && variant.price) {
          await supabase.from('produto_cor_tamanho_tabela_preco').upsert({
            produto_id: produtoId,
            cor,
            tamanho,
            tabela_preco_id: tabelaPrecoId,
            preco: Number(variant.price),
          }, { onConflict: 'produto_id,cor,tamanho,tabela_preco_id' });
        }

        await supabase.from('marketplace_produto_map').upsert({
          cliente_id: clienteId,
          marketplace: MARKETPLACE,
          integracao_id: integration.id,
          produto_id: produtoId,
          produto_cor_tamanho_id: pctId,
          external_product_id: externalProductId,
          external_variant_id: String(variant.id),
          last_sync_at: new Date().toISOString(),
          last_sync_direction: 'import',
        }, { onConflict: 'integracao_id,external_variant_id' });

        const targetStock = nuvemStockByVariantId.get(String(variant.id))
          ?? resolveNuvemshopVariantStock(variant, nuvemProductFull);
        if (stockSyncEnabled) {
          await applyStockTarget(clienteId, estoqueCtx, {
            produtoId,
            variacaoId: pctId,
            targetStock,
            observacao: 'Nuvemshop — estoque importado do e-commerce',
          });
        }

        const skuVariacao = variant.sku || produtoSku;
        if (!String(variant.sku || '').trim() && skuVariacao) {
          try {
            await updateVariant(
              integration.store_id,
              integration.access_token,
              externalProductId,
              String(variant.id),
              { sku: String(skuVariacao) },
              creds,
            );
          } catch (skuErr) {
            console.warn('[import] Falha ao gravar SKU na Nuvemshop:', skuErr.message);
          }
        }
      }

      let stockSync = { updated: 0, skipped: 0, unchanged: 0 };
      if (stockSyncEnabled) {
        stockSync = await pullProductStockFromNuvemshop({
          clienteId,
          produtoId,
          integration,
          creds,
          supabase,
          estoqueCtx,
          nuvemVariants: allVariants,
          externalProductId,
          nuvemProduct: nuvemProductFull,
          stockByVariantId: nuvemStockByVariantId,
        });
      }

      await logSync(clienteId, 'import', 'success', {
        integracao_id: integration.id,
        produto_id: produtoId,
        external_product_id: externalProductId,
        payload: {
          pendente_fiscal: isNewProduct,
          variacoes_importadas: variantsToImport.length,
          estoque_sincronizado: stockSync,
        },
      });

      importedProductIds.add(produtoId);
    } catch (err) {
      await logSync(clienteId, 'import', 'error', {
        integracao_id: integration.id,
        loja_nome: integration.nome || integration.store_name,
        external_product_id: externalProductId,
        error_message: err.message,
      });
      throw err;
    }
  }

  return {
    imported: [...importedProductIds].map((produto_id) => ({ produto_id })),
    count: importedProductIds.size,
  };
}

export async function exportToNuvemshop(clienteId, exportRequests, options = {}) {
  const integration = await resolveIntegration(clienteId, options.integracaoId);
  const stockSyncEnabled = isIntegrationStockSyncEnabled(integration);

  const creds = requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id || options.pontaEstoqueId,
  });
  const tabelaPrecoId = integration.tabela_preco_id || null;
  const exportedProductIds = new Set();
  const categoryCache = {};

  const nuvemProductsForPrune = await listAllProductsWithVariants(
    integration.store_id,
    integration.access_token,
    creds,
  );
  const nuvemRowsForPrune = flattenNuvemProducts(nuvemProductsForPrune);
  const { rows: azoupRowsForPrune } = await loadAzoupCatalog(
    clienteId,
    integration.id,
    estoqueCtx,
    tabelaPrecoId,
  );
  await pruneStaleMarketplaceProductMaps({
    clienteId,
    integracaoId: integration.id,
    azoupRows: azoupRowsForPrune,
    nuvemRows: nuvemRowsForPrune,
    integracaoNome: integration.nome || integration.store_name,
    usuarioId: options.usuarioId,
  });

  for (const request of exportRequests) {
    const produtoId = String(request.produtoId);

    const produto = await loadProdutoForExport(supabase, clienteId, produtoId);

    const variations = (produto.produto_cor_tamanho || [])
      .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));

    const priceByVariacao = await loadSalePricesForVariations(
      clienteId,
      produtoId,
      variations,
      tabelaPrecoId,
    );
    const variationsWithPrice = variations.map((v) => ({
      ...v,
      preco_venda: priceByVariacao.get(v.id) ?? 0,
    }));

    const existingMaps = await loadExportExistingMaps(
      supabase,
      clienteId,
      integration.id,
      produtoId,
    );

    const mapByVariacao = new Map(
      (existingMaps || []).map((m) => [m.produto_cor_tamanho_id, m]),
    );

    const requestedIds = request.variationIds?.length
      ? request.variationIds.map(String)
      : variationsWithPrice
        .filter((v) => !mapByVariacao.has(v.id))
        .map((v) => String(v.id));

    const newOnes = variationsWithPrice.filter(
      (v) => requestedIds.includes(String(v.id)) && !mapByVariacao.has(v.id),
    );

    if (newOnes.length === 0) continue;

    const mappedOnNuvem = variationsWithPrice.filter((v) => mapByVariacao.has(v.id));
    const variationsForPayload = [...mappedOnNuvem, ...newOnes].map((v) => {
      const map = mapByVariacao.get(v.id);
      return map?.external_variant_id
        ? { ...v, external_variant_id: map.external_variant_id }
        : v;
    });

    const imageUrls = await fetchAllProductImageUrls(produtoId);
    let externalProductId = await findNuvemProductForAzoupExport({
      supabase,
      clienteId,
      integration,
      creds,
      produto,
      variationsWithPrice,
      existingMaps,
    });
    const isNewProduct = !externalProductId;

    const getStock = (variacaoId, produtoIdArg, variationCount) => (
      variacaoId
        ? (getVariacaoSaldo(estoqueCtx, variacaoId, produtoIdArg, variationCount) ?? 0)
        : 0
    );

    let nuvemExisting = null;
    if (externalProductId) {
      nuvemExisting = await getProduct(
        integration.store_id,
        integration.access_token,
        externalProductId,
        creds,
      );
    }

    const targetAttributes = resolveExportTargetAttributes(
      variationsWithPrice,
      nuvemExisting,
    );

    const categoryIds = await resolveNuvemshopCategoryIdsForProduct({
      storeId: integration.store_id,
      accessToken: integration.access_token,
      creds,
      categoriaNome: produto.categorias?.nome,
      subcategoriaNome: produto.subcategorias?.nome,
      cache: categoryCache,
    });

    const variantDimensions = buildNuvemshopVariantDimensions(produto);

    const payload = buildNuvemshopProductPayload({
      name: produto.nome,
      sku: produto.sku,
      produtoId: produto.id,
      variations: variationsForPayload,
      allVariations: variationsWithPrice,
      imageUrls: !externalProductId ? imageUrls : [],
      categoryIds,
      getStock,
      existingNuvemVariants: nuvemExisting?.variants || [],
      existingNuvemAttributes: targetAttributes,
      variantDimensions,
    });

    let imagensEnviadas = 0;
    let barcodeVariantIds = new Map();

    if (externalProductId) {
      await updateProduct(
        integration.store_id,
        integration.access_token,
        externalProductId,
        {
          name: payload.name,
          attributes: targetAttributes,
          ...(categoryIds.length ? { categories: categoryIds } : {}),
        },
        creds,
      );

      const imageSync = await exportProductImagesToNuvemshop({
        createProductImage,
        storeId: integration.store_id,
        accessToken: integration.access_token,
        externalProductId,
        produtoId,
        nuvemExistingImages: nuvemExisting?.images || [],
        creds,
      });
      imagensEnviadas = imageSync.uploaded;

      for (const v of newOnes) {
        const idx = variationsForPayload.findIndex((row) => row.id === v.id);
        const variantPayload = payload.variants[idx];
        if (!variantPayload) continue;

        const created = await createProductVariant(
          integration.store_id,
          integration.access_token,
          externalProductId,
          buildNuvemshopVariantCreatePayload(variantPayload, produto),
          creds,
        );

        if (!created?.id) continue;
        barcodeVariantIds.set(v.id, String(created.id));

        await supabase.from('marketplace_produto_map').upsert({
          cliente_id: clienteId,
          marketplace: MARKETPLACE,
          integracao_id: integration.id,
          produto_id: produto.id,
          produto_cor_tamanho_id: v.id,
          external_product_id: String(externalProductId),
          external_variant_id: String(created.id),
          last_sync_at: new Date().toISOString(),
          last_sync_direction: 'export',
        }, { onConflict: 'integracao_id,external_variant_id' });
      }
    } else {
      const created = await createProduct(
        integration.store_id,
        integration.access_token,
        payload,
        creds,
      );
      externalProductId = String(created.id);

      const createdFull = await getProduct(
        integration.store_id,
        integration.access_token,
        externalProductId,
        creds,
      );
      await linkCreatedNuvemImagesToAzoup(produtoId, createdFull);
      imagensEnviadas = imageUrls.length;

      const full = await listAllProductsWithVariants(
        integration.store_id,
        integration.access_token,
        creds,
      );
      const nuvemProduct = full.find((p) => String(p.id) === String(externalProductId));
      const nuvemVars = nuvemProduct?.variants || [];

      for (const v of newOnes) {
        const idx = variationsForPayload.findIndex((row) => row.id === v.id);
        const nv = findNuvemVariantForAzoup(nuvemVars, {
          skuVariacao: v.sku_variacao,
          skuPai: produto.sku,
          values: payload.variants[idx]?.values,
        });

        if (!nv) continue;
        barcodeVariantIds.set(v.id, String(nv.id));

        await supabase.from('marketplace_produto_map').upsert({
          cliente_id: clienteId,
          marketplace: MARKETPLACE,
          integracao_id: integration.id,
          produto_id: produto.id,
          produto_cor_tamanho_id: v.id,
          external_product_id: String(externalProductId),
          external_variant_id: String(nv.id),
          last_sync_at: new Date().toISOString(),
          last_sync_direction: 'export',
        }, { onConflict: 'integracao_id,external_variant_id' });
      }
    }

    const priceSync = await pushProductPricesToNuvemshop({
      clienteId,
      produtoId: produto.id,
      integration,
      creds,
      supabase,
      tabelaPrecoId,
    });

    let stockSync = { updated: 0, skipped: 0 };
    if (stockSyncEnabled) {
      stockSync = await pushProductStockToNuvemshop({
        clienteId,
        produtoId: produto.id,
        integration,
        creds,
        supabase,
        estoqueCtx,
      });
    }

    let barcodesAtualizados = 0;
    const exportedVariantIds = new Set();

    for (const v of variationsForPayload) {
      const variantId = barcodeVariantIds.get(v.id) || mapByVariacao.get(v.id)?.external_variant_id;
      if (variantId) exportedVariantIds.add(String(variantId));
    }

    for (const v of newOnes) {
      const ean = String(v.ean13 || '').trim();
      const variantId = barcodeVariantIds.get(v.id) || mapByVariacao.get(v.id)?.external_variant_id;
      if (!variantId || !externalProductId) continue;

      exportedVariantIds.add(String(variantId));

      const dimensions = buildNuvemshopVariantDimensions(produto);
      const patch = {
        ...(ean ? { barcode: ean } : {}),
        ...dimensions,
      };
      if (!Object.keys(patch).length) continue;

      try {
        await updateVariant(
          integration.store_id,
          integration.access_token,
          externalProductId,
          String(variantId),
          patch,
          creds,
        );
        if (ean) barcodesAtualizados += 1;
      } catch (barcodeErr) {
        console.warn('[export] Falha ao gravar EAN/dimensões na Nuvemshop:', barcodeErr.message);
      }
    }

    const dimensionsSync = await pushProductVariantDimensionsToNuvemshop({
      integration,
      creds,
      produto,
      externalProductId,
      externalVariantIds: [...exportedVariantIds],
    });

    const descriptionSync = await pushProductDescriptionToNuvemshop({
      integration,
      creds,
      externalProductId,
      descricao: produto.descricao,
    });

    await logSync(clienteId, 'export', 'success', {
      integracao_id: integration.id,
      produto_id: produto.id,
      external_product_id: externalProductId,
      payload: {
        imagens_enviadas: imagensEnviadas,
        imagens_cadastradas: imageUrls.length,
        produto_novo: isNewProduct,
        variacoes_exportadas: newOnes.length,
        precos_atualizados: priceSync.updated,
        estoques_atualizados: stockSync.updated,
        codigos_barras_atualizados: barcodesAtualizados,
        descricao_enviada: descriptionSync.updated,
        dimensoes_atualizadas: dimensionsSync.updated,
        dimensoes_disponiveis: Object.keys(variantDimensions),
      },
    });

    exportedProductIds.add(produto.id);
  }

  return {
    exported: [...exportedProductIds].map((produto_id) => ({ produto_id })),
    count: exportedProductIds.size,
  };
}

async function pushProductPricesToNuvemshop({
  clienteId,
  produtoId,
  integration,
  creds,
  supabase,
  tabelaPrecoId = null,
}) {
  const { data: maps } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integration.id)
    .eq('produto_id', produtoId);

  if (!maps?.length) return { updated: 0, skipped: 0 };

  const variacaoIds = maps
    .map((map) => map.produto_cor_tamanho_id)
    .filter(Boolean);

  const { data: variations, error } = await supabase
    .from('produto_cor_tamanho')
    .select('id, cor, tamanho')
    .in('id', variacaoIds);

  if (error) throw error;

  const priceByVariacao = await loadSalePricesForVariations(
    clienteId,
    produtoId,
    variations || [],
    tabelaPrecoId || integration.tabela_preco_id,
  );

  let updated = 0;
  let skipped = 0;

  for (const map of maps) {
    const preco = priceByVariacao.get(map.produto_cor_tamanho_id);
    if (!Number.isFinite(preco)) {
      skipped += 1;
      continue;
    }

    await updateVariant(
      integration.store_id,
      integration.access_token,
      map.external_product_id,
      map.external_variant_id,
      { price: formatNuvemshopPrice(preco) },
      creds,
    );
    updated += 1;
  }

  if (updated > 0) {
    await supabase.from('marketplace_produto_map')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_direction: 'price_azoup',
      })
      .eq('cliente_id', clienteId)
      .eq('marketplace', MARKETPLACE)
      .eq('integracao_id', integration.id)
      .eq('produto_id', produtoId);
  }

  return { updated, skipped };
}

export async function syncProductPrices(clienteId, options = {}) {
  const integration = await resolveIntegration(clienteId, options.integracaoId);

  const creds = requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const produtoIds = [...new Set(
    (options.produtoIds || []).map(String).filter(Boolean),
  )];

  if (!produtoIds.length) {
    return { results: [] };
  }

  const results = [];

  for (const produtoId of produtoIds) {
    try {
      const pushResult = await pushProductPricesToNuvemshop({
        clienteId,
        produtoId,
        integration,
        creds,
        supabase,
        tabelaPrecoId: integration.tabela_preco_id,
      });

      await logSync(clienteId, 'sync_price', 'success', {
        integracao_id: integration.id,
        produto_id: produtoId,
        payload: pushResult,
      });

      results.push({ produtoId, success: true, ...pushResult });
    } catch (err) {
      await logSync(clienteId, 'sync_price', 'error', {
        produto_id: produtoId,
        error_message: err.message,
      });
      results.push({ produtoId, success: false, error: err.message });
    }
  }

  return { results };
}

async function pushProductSkusToNuvemshop({
  clienteId,
  produtoId,
  integration,
  creds,
  supabase,
}) {
  const { data: maps } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integration.id)
    .eq('produto_id', produtoId);

  if (!maps?.length) return { updated: 0, skipped: 0 };

  const variacaoIds = maps
    .map((map) => map.produto_cor_tamanho_id)
    .filter(Boolean);

  const { data: produto, error: produtoError } = await supabase
    .from('produtos')
    .select('id, sku')
    .eq('id', produtoId)
    .eq('cliente_id', clienteId)
    .single();

  if (produtoError) throw produtoError;

  const { data: variations, error } = await supabase
    .from('produto_cor_tamanho')
    .select('id, sku_variacao')
    .in('id', variacaoIds);

  if (error) throw error;

  const skuByVariacao = new Map(
    (variations || []).map((v) => [v.id, String(v.sku_variacao || produto?.sku || '').trim()]),
  );

  let updated = 0;
  let skipped = 0;

  for (const map of maps) {
    const sku = skuByVariacao.get(map.produto_cor_tamanho_id);
    if (!sku) {
      skipped += 1;
      continue;
    }

    await updateVariant(
      integration.store_id,
      integration.access_token,
      map.external_product_id,
      map.external_variant_id,
      { sku },
      creds,
    );
    updated += 1;
  }

  if (updated > 0) {
    await supabase.from('marketplace_produto_map')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_direction: 'sku_azoup',
      })
      .eq('cliente_id', clienteId)
      .eq('marketplace', MARKETPLACE)
      .eq('integracao_id', integration.id)
      .eq('produto_id', produtoId);
  }

  return { updated, skipped };
}

export async function syncProductSkus(clienteId, options = {}) {
  const integration = await resolveIntegration(clienteId, options.integracaoId);

  const creds = requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const produtoIds = [...new Set(
    (options.produtoIds || []).map(String).filter(Boolean),
  )];

  if (!produtoIds.length) {
    return { results: [] };
  }

  const results = [];

  for (const produtoId of produtoIds) {
    try {
      const pushResult = await pushProductSkusToNuvemshop({
        clienteId,
        produtoId,
        integration,
        creds,
        supabase,
      });

      await logSync(clienteId, 'sync_sku', 'success', {
        integracao_id: integration.id,
        produto_id: produtoId,
        payload: pushResult,
      });

      results.push({ produtoId, success: true, ...pushResult });
    } catch (err) {
      await logSync(clienteId, 'sync_sku', 'error', {
        produto_id: produtoId,
        error_message: err.message,
      });
      results.push({ produtoId, success: false, error: err.message });
    }
  }

  return { results };
}

async function resolveStockMapEntry(supabase, clienteId, item) {
  if (item.mapId) {
    const { data: map, error } = await supabase
      .from('marketplace_produto_map')
      .select('*')
      .eq('id', item.mapId)
      .eq('cliente_id', clienteId)
      .single();
    if (error || !map) return { error: 'Map não encontrado' };
    return { map };
  }

  const {
    produtoId,
    produtoCorTamanhoId,
    externalProductId,
    externalVariantId,
  } = item;

  if (!produtoId || !produtoCorTamanhoId || !externalProductId || !externalVariantId || !item.integracaoId) {
    return { error: 'Vínculo incompleto para sincronizar estoque' };
  }

  const { data: map, error } = await supabase
    .from('marketplace_produto_map')
    .upsert({
      cliente_id: clienteId,
      marketplace: MARKETPLACE,
      integracao_id: item.integracaoId,
      produto_id: produtoId,
      produto_cor_tamanho_id: produtoCorTamanhoId,
      external_product_id: String(externalProductId),
      external_variant_id: String(externalVariantId),
    }, { onConflict: 'integracao_id,external_variant_id' })
    .select('*')
    .single();

  if (error || !map) return { error: error?.message || 'Falha ao vincular produto para estoque' };
  return { map };
}

export async function syncStock(clienteId, items, options = {}) {
  const integration = await resolveIntegration(clienteId, options.integracaoId);
  if (!isIntegrationStockSyncEnabled(integration)) {
    throw new Error('Sincronização de estoque desativada para esta loja.');
  }

  const creds = requireNuvemshopCredentials();
  const supabase = requireSupabaseAdmin();
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id || options.pontaEstoqueId,
  });
  const results = [];

  for (const item of items) {
    const direction = item.direction || 'azoup_to_nuvemshop';
    const resolved = await resolveStockMapEntry(supabase, clienteId, item);
    if (resolved.error) {
      results.push({
        mapId: item.mapId || null,
        success: false,
        error: resolved.error,
      });
      continue;
    }

    const map = resolved.map;

    try {
      if (direction === 'azoup_to_nuvemshop') {
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
        await supabase.from('marketplace_produto_map').update({
          last_sync_at: new Date().toISOString(),
          last_sync_direction: 'stock_azoup',
        }).eq('id', map.id);
      } else if (direction === 'nuvemshop_to_azoup') {
        const product = await getProduct(
          integration.store_id,
          integration.access_token,
          map.external_product_id,
          creds,
        );
        const variants = product.variants?.length
          ? product.variants
          : [{ id: product.id, stock: product.stock }];
        const nv = variants.find((v) => String(v.id) === String(map.external_variant_id));
        if (!nv) {
          results.push({
            mapId: map.id,
            success: false,
            error: 'Variação não encontrada na Nuvemshop.',
          });
          continue;
        }

        await applyStockTarget(clienteId, estoqueCtx, {
          produtoId: map.produto_id,
          variacaoId: map.produto_cor_tamanho_id,
          targetStock: normalizeNuvemshopStock(nv.stock),
          observacao: 'Nuvemshop — sincronização manual de estoque',
        });
        await supabase.from('marketplace_produto_map').update({
          last_sync_at: new Date().toISOString(),
          last_sync_direction: 'stock_nuvemshop',
        }).eq('id', map.id);
      } else {
        results.push({
          mapId: map.id,
          success: false,
          error: 'Direção não suportada. Use azoup_to_nuvemshop ou nuvemshop_to_azoup.',
        });
        continue;
      }

      await logSync(clienteId, 'sync_stock', 'success', {
        integracao_id: integration.id,
        produto_id: map.produto_id,
        external_product_id: map.external_product_id,
        payload: { direction },
      });

      results.push({ mapId: map.id, success: true, direction });
    } catch (err) {
      await logSync(clienteId, 'sync_stock', 'error', {
        produto_id: map.produto_id,
        error_message: err.message,
        payload: { direction },
      });
      results.push({ mapId: map.id, success: false, error: err.message });
    }
  }

  return { results };
}

export async function saveIntegration(clienteId, tokenData) {
  if (!clienteId) {
    throw new Error('cliente_id ausente no state OAuth.');
  }
  if (!tokenData?.access_token || !tokenData?.user_id) {
    throw new Error('Token OAuth incompleto (access_token ou user_id ausente).');
  }

  const supabase = requireSupabaseAdmin();
  const storeId = String(tokenData.user_id);
  const nome = String(tokenData.nome || tokenData.store_name || `Loja ${storeId}`).trim();

  const row = {
    cliente_id: clienteId,
    marketplace: MARKETPLACE,
    store_id: storeId,
    nome,
    access_token: encryptToken(tokenData.access_token),
    scopes: tokenData.scope || '',
    store_name: tokenData.store_name || null,
    tabela_preco_id: tokenData.tabela_preco_id || null,
    ponta_estoque_id: tokenData.ponta_estoque_id || null,
    sync_estoque: true,
    status: 'connected',
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: findError } = await supabase
    .from('marketplace_integracao')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('store_id', storeId)
    .maybeSingle();

  if (findError) throw findError;

  const { data: otherClient, error: otherClientError } = await supabase
    .from('marketplace_integracao')
    .select('id, cliente_id, nome')
    .eq('marketplace', MARKETPLACE)
    .eq('store_id', storeId)
    .eq('status', 'connected')
    .neq('cliente_id', clienteId)
    .limit(1)
    .maybeSingle();

  if (otherClientError) throw otherClientError;
  if (otherClient) {
    throw new Error(
      'Esta loja Nuvemshop já está vinculada a outra conta Azoup. '
      + 'Uma mesma loja não pode ser conectada em dois clientes ao mesmo tempo.',
    );
  }

  let data;
  let error;
  if (existing?.id) {
    ({ data, error } = await supabase
      .from('marketplace_integracao')
      .update(row)
      .eq('id', existing.id)
      .select('id, store_id, store_name, nome, status, connected_at, tabela_preco_id, ponta_estoque_id')
      .maybeSingle());
  } else {
    ({ data, error } = await supabase
      .from('marketplace_integracao')
      .insert(row)
      .select('id, store_id, store_name, nome, status, connected_at, tabela_preco_id, ponta_estoque_id')
      .maybeSingle());
  }

  if (error) throw error;
  if (!data) throw new Error('Falha ao salvar integração no Supabase.');

  await logIntegracaoEvent(clienteId, {
    categoria: 'conexao',
    nivel: 'success',
    acao: existing?.id ? 'store_reconnect' : 'store_connect',
    titulo: existing?.id
      ? `Loja reconectada: ${nome}`
      : `Primeira conexão com a loja: ${nome}`,
    integracaoId: data.id,
    lojaNome: nome,
    mensagem: existing?.id
      ? 'Token OAuth atualizado e loja vinculada novamente.'
      : 'Integração Nuvemshop configurada com sucesso.',
    payload: {
      store_id: storeId,
      store_name: tokenData.store_name || null,
    },
  });

  try {
    const creds = requireNuvemshopCredentials();
    await registerNuvemshopStockWebhooks(storeId, tokenData.access_token, creds);
  } catch (webhookErr) {
    console.warn('[marketplace] Webhooks de estoque não registrados:', webhookErr.message);
    await logIntegracaoEvent(clienteId, {
      categoria: 'conexao',
      nivel: 'warning',
      acao: 'webhook_register_failed',
      titulo: `Falha ao registrar webhooks — ${nome}`,
      integracaoId: data.id,
      lojaNome: nome,
      mensagem: webhookErr.message,
    });
  }

  try {
    const { activateEcommerceStoreBilling } = await import('./ecommerceBillingClient.js');
    await activateEcommerceStoreBilling(clienteId, {
      nome,
      marketplace: MARKETPLACE,
      storeExternalId: storeId,
      storeName: tokenData.store_name || nome,
      marketplaceIntegracaoId: data.id,
    });
  } catch (billingErr) {
    console.error('[marketplace] Billing e-commerce (+R$97) falhou:', billingErr.message);
    await logIntegracaoEvent(clienteId, {
      categoria: 'conexao',
      nivel: 'error',
      acao: 'ecommerce_billing_activate_failed',
      titulo: `Falha ao cobrar loja — ${nome}`,
      integracaoId: data.id,
      lojaNome: nome,
      mensagem: billingErr.message,
    });
  }

  return data;
}

export async function disconnectIntegration(clienteId, integracaoId) {
  const supabase = requireSupabaseAdmin();
  const { data: integration } = await supabase
    .from('marketplace_integracao')
    .select('id, nome, store_name, marketplace, store_id')
    .eq('cliente_id', clienteId)
    .eq('id', integracaoId)
    .maybeSingle();

  const { error } = await supabase
    .from('marketplace_integracao')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('cliente_id', clienteId)
    .eq('id', integracaoId);

  if (error) throw error;

  try {
    const { deactivateEcommerceStoreBilling } = await import('./ecommerceBillingClient.js');
    await deactivateEcommerceStoreBilling(clienteId, {
      marketplaceIntegracaoId: integracaoId,
    });
  } catch (billingErr) {
    console.error('[marketplace] Billing e-commerce (−R$97) falhou:', billingErr.message);
    await logIntegracaoEvent(clienteId, {
      categoria: 'conexao',
      nivel: 'error',
      acao: 'ecommerce_billing_deactivate_failed',
      titulo: `Falha ao remover cobrança — ${integration?.nome || integracaoId}`,
      integracaoId,
      lojaNome: integration?.nome || integration?.store_name || null,
      mensagem: billingErr.message,
    });
  }

  await logIntegracaoEvent(clienteId, {
    categoria: 'conexao',
    nivel: 'warning',
    acao: 'store_disconnect',
    titulo: `Loja desconectada: ${integration?.nome || integration?.store_name || integracaoId}`,
    integracaoId,
    lojaNome: integration?.nome || integration?.store_name || null,
    mensagem: 'A integração foi marcada como desconectada. Sincronizações automáticas foram interrompidas.',
  });
}

export async function getIntegrationStatus(clienteId) {
  const integrations = await listIntegrations(clienteId);
  return integrations[0] || null;
}
