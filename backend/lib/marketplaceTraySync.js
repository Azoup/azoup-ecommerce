import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { encryptToken } from './tokenCrypto.js';
import { requireTrayCredentials, MARKETPLACE } from './trayConfig.js';
import {
  loadTrayCatalogRows,
  getTrayProduct,
  listAllTrayVariants,
  parseTrayVariantSku,
  createTrayProduct,
  updateTrayProduct,
  createTrayVariant,
  updateTrayVariant,
  resolveTrayIntegration,
} from './trayClient.js';
import {
  resolveIntegration,
} from './marketplaceSync.js';
import {
  isIntegrationStockSyncEnabled,
} from './marketplaceIntegration.js';
import {
  createEstoqueLedgerContext,
  getPontaEstoqueInfo,
  getVariacaoSaldo,
  applyStockTarget,
  stocksAreDifferent,
  stockConflictRequiresSync,
  skusAreDifferent,
} from './estoqueLedger.js';
import {
  getDefaultPriceTableId,
  getSalePriceFromMap,
  loadSalePricesForProducts,
  pricesAreDifferent,
} from './productPrices.js';
import { pruneStaleMarketplaceProductMaps } from './marketplaceProductMap.js';
import { logIntegracaoEvent, logLegacyMarketplaceSync } from './integracaoEventLog.js';

function buildExternalSide(row) {
  return {
    nome: row.product_name,
    sku: row.sku,
    cor: row.cor,
    tamanho: row.tamanho,
    estoque: row.stock,
    price: row.price,
  };
}

function normalizeCompareItem(item) {
  const external = item.external || item.nuvemshop || null;
  return {
    ...item,
    external,
    nuvemshop: external,
  };
}

async function loadAzoupCatalog(clienteId, integracaoId, estoqueCtx, tabelaPrecoId) {
  const supabase = requireSupabaseAdmin();
  const ctx = estoqueCtx || await createEstoqueLedgerContext(clienteId);

  const { data: produtos, error } = await supabase
    .from('produtos')
    .select(`
      id, nome, sku, inativo,
      produto_cor_tamanho ( id, cor, tamanho, sku_variacao, ean13 )
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

  const mapByExternal = new Map((maps || []).map((m) => [String(m.external_variant_id), m]));
  const mapByVariacao = new Map((maps || []).map((m) => [m.produto_cor_tamanho_id, m]));
  const produtoIds = [...new Set((produtos || []).map((p) => p.id))];
  const priceByKey = await loadSalePricesForProducts(clienteId, produtoIds, tabelaPrecoId);

  const rows = [];
  for (const p of produtos || []) {
    const variations = p.produto_cor_tamanho || [];
    if (!variations.length) {
      rows.push({
        produto_id: p.id,
        produto_cor_tamanho_id: null,
        nome: p.nome,
        sku: p.sku,
        cor: 'Único',
        tamanho: 'Único',
        estoque: null,
        map: null,
      });
      continue;
    }
    for (const v of variations) {
      rows.push({
        produto_id: p.id,
        produto_cor_tamanho_id: v.id,
        nome: p.nome,
        sku: v.sku_variacao || p.sku,
        cor: v.cor,
        tamanho: v.tamanho,
        estoque: getVariacaoSaldo(ctx, v.id, p.id, variations.length),
        preco: getSalePriceFromMap(priceByKey, p.id, v.cor, v.tamanho),
        map: mapByVariacao.get(v.id) || null,
      });
    }
  }

  return { rows, mapByExternal, mapByVariacao, estoqueCtx: ctx };
}

function resolveCompareConflict(az, external, azoupRows, { stockSyncEnabled = true } = {}) {
  if (!az || !external) return { status: 'linked', conflict_reasons: [] };
  const reasons = [];
  const stockAzoup = az.estoque ?? 0;
  const stockExternal = external.stock ?? external.estoque ?? 0;
  if (stockSyncEnabled && stockConflictRequiresSync(stockAzoup, stockExternal)) {
    reasons.push('estoque');
  }
  if (skusAreDifferent(az.sku, external.sku)) reasons.push('sku');
  if (pricesAreDifferent(az.preco, external.price)) reasons.push('preco');
  return { status: reasons.length ? 'conflict' : 'linked', conflict_reasons: reasons };
}

function buildCompareSummary(results, { stockSyncEnabled = true } = {}) {
  return {
    total: results.length,
    linked: results.filter((r) => r.status === 'linked').length,
    conflict: results.filter((r) => r.status === 'conflict').length,
    only_azoup: results.filter((r) => r.status === 'only_azoup').length,
    only_nuvemshop: results.filter((r) => r.status === 'only_external' || r.status === 'only_nuvemshop').length,
    only_external: results.filter((r) => r.status === 'only_external' || r.status === 'only_nuvemshop').length,
    stock_diff: stockSyncEnabled
      ? results.filter((r) =>
        r.azoup && (r.external || r.nuvemshop)
        && stockConflictRequiresSync(r.azoup.estoque, (r.external || r.nuvemshop).estoque ?? (r.external || r.nuvemshop).stock),
      ).length
      : 0,
    price_diff: results.filter((r) =>
      r.azoup && (r.external || r.nuvemshop)
      && pricesAreDifferent(r.azoup.preco, (r.external || r.nuvemshop).price),
    ).length,
  };
}

export async function compareTrayCatalog(clienteId, options = {}) {
  const integration = await resolveIntegration(clienteId, options.integracaoId);
  if (integration.marketplace !== MARKETPLACE) {
    throw new Error('A loja selecionada não é Tray.');
  }

  const trayIntegration = await resolveTrayIntegration(integration);
  const stockSyncEnabled = isIntegrationStockSyncEnabled(trayIntegration);
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: trayIntegration.ponta_estoque_id || options.pontaEstoqueId,
  });
  const pontaEstoque = await getPontaEstoqueInfo(clienteId, estoqueCtx.pontaEstoqueId);

  let trayRows;
  try {
    trayRows = await loadTrayCatalogRows(trayIntegration);
  } catch (err) {
    throw new Error(`Não foi possível listar produtos da Tray: ${err.message}`);
  }

  const catalog = await loadAzoupCatalog(
    clienteId,
    trayIntegration.id,
    estoqueCtx,
    trayIntegration.tabela_preco_id,
  );

  await pruneStaleMarketplaceProductMaps({
    clienteId,
    integracaoId: trayIntegration.id,
    azoupRows: catalog.rows,
    nuvemRows: trayRows.map((row) => ({
      external_variant_id: row.external_variant_id,
      external_product_id: row.external_product_id,
    })),
    integracaoNome: trayIntegration.nome || trayIntegration.store_name,
    usuarioId: options.usuarioId,
  });

  const { rows: azoupRows, mapByExternal, mapByVariacao } = await loadAzoupCatalog(
    clienteId,
    trayIntegration.id,
    estoqueCtx,
    trayIntegration.tabela_preco_id,
  );

  const usedAzoup = new Set();
  const usedExternal = new Set();
  const results = [];

  for (const map of [...mapByExternal.values()]) {
    const az = azoupRows.find((r) => r.produto_cor_tamanho_id === map.produto_cor_tamanho_id);
    const ext = trayRows.find((r) => String(r.external_variant_id) === String(map.external_variant_id));
    if (az) usedAzoup.add(az.produto_cor_tamanho_id || az.produto_id);
    if (ext) usedExternal.add(String(ext.external_variant_id));

    const externalSide = ext ? buildExternalSide(ext) : null;
    const { status, conflict_reasons } = resolveCompareConflict(
      az ? { ...az, estoque: az.estoque ?? 0 } : null,
      ext ? { ...ext, stock: ext.stock } : null,
      azoupRows,
      { stockSyncEnabled },
    );

    results.push(normalizeCompareItem({
      status,
      conflict_reasons,
      map_id: map.id,
      produto_id: map.produto_id,
      produto_cor_tamanho_id: map.produto_cor_tamanho_id,
      external_product_id: map.external_product_id,
      external_variant_id: map.external_variant_id,
      azoup: az ? {
        nome: az.nome,
        sku: az.sku,
        cor: az.cor,
        tamanho: az.tamanho,
        estoque: az.estoque,
        preco: az.preco,
      } : null,
      external: externalSide,
    }));
  }

  for (const ext of trayRows) {
    const variantId = String(ext.external_variant_id);
    if (usedExternal.has(variantId)) continue;

    const skuMatch = azoupRows.find(
      (a) => !usedAzoup.has(a.produto_cor_tamanho_id || a.produto_id)
        && a.sku && ext.sku && String(a.sku) === String(ext.sku),
    );

    if (skuMatch) {
      usedAzoup.add(skuMatch.produto_cor_tamanho_id || skuMatch.produto_id);
      usedExternal.add(variantId);
      const externalSide = buildExternalSide(ext);
      const { status, conflict_reasons } = resolveCompareConflict(skuMatch, ext, azoupRows, { stockSyncEnabled });
      results.push(normalizeCompareItem({
        status,
        conflict_reasons,
        map_id: null,
        produto_id: skuMatch.produto_id,
        produto_cor_tamanho_id: skuMatch.produto_cor_tamanho_id,
        external_product_id: ext.external_product_id,
        external_variant_id: ext.external_variant_id,
        azoup: {
          nome: skuMatch.nome,
          sku: skuMatch.sku,
          cor: skuMatch.cor,
          tamanho: skuMatch.tamanho,
          estoque: skuMatch.estoque,
          preco: skuMatch.preco,
        },
        external: externalSide,
      }));
      continue;
    }

    results.push(normalizeCompareItem({
      status: 'only_external',
      map_id: null,
      external_product_id: ext.external_product_id,
      external_variant_id: ext.external_variant_id,
      external: buildExternalSide(ext),
    }));
    usedExternal.add(variantId);
  }

  for (const az of azoupRows) {
    const key = az.produto_cor_tamanho_id || az.produto_id;
    if (usedAzoup.has(key)) continue;
    if (az.produto_cor_tamanho_id && mapByVariacao.has(az.produto_cor_tamanho_id)) continue;
    results.push(normalizeCompareItem({
      status: 'only_azoup',
      map_id: null,
      produto_id: az.produto_id,
      produto_cor_tamanho_id: az.produto_cor_tamanho_id,
      azoup: {
        nome: az.nome,
        sku: az.sku,
        cor: az.cor,
        tamanho: az.tamanho,
        estoque: az.estoque,
        preco: az.preco,
      },
    }));
  }

  return {
    integracao: {
      id: trayIntegration.id,
      nome: trayIntegration.nome,
      marketplace: MARKETPLACE,
      store_name: trayIntegration.store_name,
      tabela_preco_id: trayIntegration.tabela_preco_id,
      ponta_estoque_id: trayIntegration.ponta_estoque_id,
      sync_estoque: stockSyncEnabled,
    },
    pontaEstoque,
    items: results,
    summary: buildCompareSummary(results, { stockSyncEnabled }),
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

export async function importFromTray(clienteId, importRequests, options = {}) {
  const integration = await resolveTrayIntegration(await resolveIntegration(clienteId, options.integracaoId));
  const stockSyncEnabled = isIntegrationStockSyncEnabled(integration);
  const supabase = requireSupabaseAdmin();
  const fiscal = await getDefaultFiscal(clienteId);
  const tabelaPrecoId = integration.tabela_preco_id || fiscal.tabela_preco_id;
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id || options.pontaEstoqueId,
  });

  const trayRows = await loadTrayCatalogRows(integration);
  const stockByVariant = new Map(trayRows.map((r) => [String(r.external_variant_id), r.stock]));

  for (const request of importRequests) {
    const externalProductId = String(request.externalProductId);
    const product = await getTrayProduct(integration.api_address, integration.access_token, externalProductId);
    if (!product) throw new Error(`Produto Tray ${externalProductId} não encontrado.`);

    const allVariants = String(product.has_variation || '0') !== '0'
      ? (await listAllTrayVariants(integration.api_address, integration.access_token))
        .filter((v) => String(v.product_id) === externalProductId)
      : [{
        id: externalProductId,
        product_id: externalProductId,
        reference: product.reference,
        ean: product.ean,
        stock: product.stock,
        price: product.promotional_price || product.price,
        Sku: [],
      }];

    const { data: existingMaps } = await supabase
      .from('marketplace_produto_map')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('marketplace', MARKETPLACE)
      .eq('integracao_id', integration.id)
      .eq('external_product_id', externalProductId);

    const mappedVariants = new Set((existingMaps || []).map((m) => String(m.external_variant_id)));
    let variantsToImport = allVariants.filter((v) => !mappedVariants.has(String(v.id)));
    if (request.externalVariantIds?.length) {
      const allowed = new Set(request.externalVariantIds.map(String));
      variantsToImport = variantsToImport.filter((v) => allowed.has(String(v.id)));
    }
    if (!variantsToImport.length) continue;

    let produtoId = existingMaps?.[0]?.produto_id || null;
    if (!produtoId) {
      const { data: produto, error } = await supabase.from('produtos').insert({
        cliente_id: clienteId,
        nome: product.name || `Produto ${externalProductId}`,
        sku: product.reference || product.ean || externalProductId,
        ncm: '00000000',
        unidade: 'UN',
        grupo_fiscal_id: fiscal.grupo_fiscal_id,
        origem_id: fiscal.origem_id,
        inativo: false,
      }).select('id, sku').single();
      if (error) throw error;
      produtoId = produto.id;
    }

    const { data: existingPct } = await supabase
      .from('produto_cor_tamanho')
      .select('id, cor, tamanho, ordem')
      .eq('produto_id', produtoId);

    let nextOrdem = (existingPct || []).reduce((max, row) => Math.max(max, Number(row.ordem) || 0), -1);

    for (const variant of variantsToImport) {
      const { cor, tamanho } = parseTrayVariantSku(variant);
      const existingRow = (existingPct || []).find((row) => row.cor === cor && row.tamanho === tamanho);
      let pctId = existingRow?.id;
      if (!pctId) {
        nextOrdem += 1;
        const { data: pct, error: pctError } = await supabase.from('produto_cor_tamanho').insert({
          produto_id: produtoId,
          cor,
          tamanho,
          sku_variacao: variant.reference || variant.ean || String(variant.id),
          ordem: nextOrdem,
        }).select('id').single();
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

      if (stockSyncEnabled) {
        const targetStock = stockByVariant.get(String(variant.id)) ?? (Number(variant.stock) || 0);
        await applyStockTarget(clienteId, estoqueCtx, {
          produtoId,
          variacaoId: pctId,
          targetStock,
          observacao: 'Tray — estoque importado do e-commerce',
        });
      }
    }
  }

  return { ok: true };
}

export async function exportToTray(clienteId, exportRequests, options = {}) {
  const integration = await resolveTrayIntegration(await resolveIntegration(clienteId, options.integracaoId));
  const supabase = requireSupabaseAdmin();

  for (const request of exportRequests) {
    const produtoId = request.produtoId || request.produto_id;
    const { data: produto, error } = await supabase
      .from('produtos')
      .select(`
        id, nome, sku, descricao, peso, altura, largura, comprimento,
        produto_cor_tamanho ( id, cor, tamanho, sku_variacao )
      `)
      .eq('cliente_id', clienteId)
      .eq('id', produtoId)
      .single();
    if (error || !produto) throw new Error('Produto Azoup não encontrado.');

    const variations = produto.produto_cor_tamanho || [];
    if (!variations.length) throw new Error('Produto sem variações para exportar.');

    const { data: maps } = await supabase
      .from('marketplace_produto_map')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('integracao_id', integration.id)
      .eq('produto_id', produtoId);

    let externalProductId = resolveExternalProductIdFromMaps(maps || []);
    if (!externalProductId) {
      const created = await createTrayProduct(integration.api_address, integration.access_token, {
        name: produto.nome,
        reference: produto.sku || String(produto.id),
        description: produto.descricao || produto.nome,
        weight: produto.peso || '0',
        length: produto.comprimento || '0',
        width: produto.largura || '0',
        height: produto.altura || '0',
        available: '1',
        has_variation: variations.length > 1 ? '1' : '0',
      });
      externalProductId = String(created.id);
    } else {
      await updateTrayProduct(integration.api_address, integration.access_token, externalProductId, {
        name: produto.nome,
        reference: produto.sku || externalProductId,
        description: produto.descricao || produto.nome,
      });
    }

    for (const variacao of variations) {
      const map = (maps || []).find((m) => m.produto_cor_tamanho_id === variacao.id);
      const skuPayload = [
        { type: 'Cor', value: variacao.cor || 'Único' },
        { type: 'Tamanho', value: variacao.tamanho || 'Único' },
      ];

      if (map?.external_variant_id && map.external_variant_id !== externalProductId) {
        await updateTrayVariant(integration.api_address, integration.access_token, map.external_variant_id, {
          product_id: externalProductId,
          reference: variacao.sku_variacao || produto.sku || String(variacao.id),
          Sku: skuPayload,
        });
      } else if (!map) {
        const createdVariant = await createTrayVariant(integration.api_address, integration.access_token, {
          product_id: externalProductId,
          reference: variacao.sku_variacao || produto.sku || String(variacao.id),
          Sku: skuPayload,
          stock: '0',
          price: '0',
        });
        await supabase.from('marketplace_produto_map').upsert({
          cliente_id: clienteId,
          marketplace: MARKETPLACE,
          integracao_id: integration.id,
          produto_id: produtoId,
          produto_cor_tamanho_id: variacao.id,
          external_product_id: externalProductId,
          external_variant_id: String(createdVariant.id),
          last_sync_at: new Date().toISOString(),
          last_sync_direction: 'export',
        }, { onConflict: 'integracao_id,external_variant_id' });
      }
    }
  }

  return { ok: true };
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

export async function syncTrayStock(clienteId, items, options = {}) {
  const integration = await resolveTrayIntegration(await resolveIntegration(clienteId, options.integracaoId));
  if (!isIntegrationStockSyncEnabled(integration)) {
    return { results: [], skipped: true, reason: 'sync_estoque_disabled' };
  }

  const supabase = requireSupabaseAdmin();
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, options.usuarioId, {
    pontaEstoqueId: integration.ponta_estoque_id,
  });
  const results = [];

  for (const item of items || []) {
    const mapId = item.mapId || item.map_id;
    const { data: map } = await supabase
      .from('marketplace_produto_map')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('id', mapId)
      .maybeSingle();
    if (!map) continue;

    const saldo = getVariacaoSaldo(
      estoqueCtx,
      map.produto_cor_tamanho_id,
      map.produto_id,
      1,
    );

    try {
      if (String(map.external_variant_id) === String(map.external_product_id)) {
        await updateTrayProduct(integration.api_address, integration.access_token, map.external_product_id, {
          stock: String(saldo),
        });
      } else {
        await updateTrayVariant(integration.api_address, integration.access_token, map.external_variant_id, {
          stock: String(saldo),
        });
      }
      results.push({ mapId, success: true });
    } catch (err) {
      results.push({ mapId, success: false, error: err.message });
    }
  }

  return { results };
}

export async function saveTrayIntegration(clienteId, tokenData) {
  if (!clienteId) throw new Error('cliente_id ausente no state OAuth.');
  if (!tokenData?.access_token || !tokenData?.store_id) {
    throw new Error('Token OAuth Tray incompleto.');
  }
  if (!tokenData?.api_address) {
    throw new Error('api_address Tray ausente. Reconecte a loja.');
  }

  const supabase = requireSupabaseAdmin();
  const storeId = String(tokenData.store_id);
  const nome = String(tokenData.nome || tokenData.store_name || `Loja Tray ${storeId}`).trim();
  const tokenExpiresAt = tokenData.date_expiration_access_token
    ? new Date(String(tokenData.date_expiration_access_token).replace(' ', 'T')).toISOString()
    : null;

  const row = {
    cliente_id: clienteId,
    marketplace: MARKETPLACE,
    store_id: storeId,
    nome,
    store_url: tokenData.store_url || null,
    api_address: String(tokenData.api_address).replace(/\/+$/, ''),
    access_token: encryptToken(tokenData.access_token),
    refresh_token: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
    token_expires_at: tokenExpiresAt,
    scopes: '',
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

  const { data: otherClient } = await supabase
    .from('marketplace_integracao')
    .select('id')
    .eq('marketplace', MARKETPLACE)
    .eq('store_id', storeId)
    .eq('status', 'connected')
    .neq('cliente_id', clienteId)
    .limit(1)
    .maybeSingle();

  if (otherClient) {
    throw new Error('Esta loja Tray já está vinculada a outra conta Azoup.');
  }

  let data;
  if (existing?.id) {
    ({ data } = await supabase
      .from('marketplace_integracao')
      .update(row)
      .eq('id', existing.id)
      .select('id, store_id, store_name, nome, status, connected_at, marketplace')
      .maybeSingle());
  } else {
    ({ data } = await supabase
      .from('marketplace_integracao')
      .insert(row)
      .select('id, store_id, store_name, nome, status, connected_at, marketplace')
      .maybeSingle());
  }

  if (!data) throw new Error('Falha ao salvar integração Tray.');

  await logIntegracaoEvent(clienteId, {
    categoria: 'conexao',
    nivel: 'success',
    acao: existing?.id ? 'store_reconnect' : 'store_connect',
    titulo: `${existing?.id ? 'Loja reconectada' : 'Primeira conexão'}: ${nome}`,
    integracaoId: data.id,
    lojaNome: nome,
    mensagem: 'Integração Tray configurada com sucesso.',
    payload: { store_id: storeId, marketplace: MARKETPLACE },
  });

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
    console.error('[tray] Billing e-commerce (+R$97) falhou:', billingErr.message);
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

async function logSync(clienteId, action, status, extra = {}) {
  await logLegacyMarketplaceSync(clienteId, action, status, extra);
}

export { logSync as logTraySync };
