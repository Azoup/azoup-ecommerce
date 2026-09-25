import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { requireNuvemshopCredentials } from './marketplaceConfig.js';
import { getOrder, listAllOrders } from './nuvemshopClient.js';
import { shouldImportMarketplaceOrder } from './trayOrderStatuses.js';
import { isTrayIntegrationEnabled } from './trayConfig.js';
import { getIntegrationById } from './marketplaceIntegrationRead.js';
import {
  listConnectedIntegrationsRows,
  normalizeIntegrationStockSyncFlag,
} from './marketplaceIntegration.js';
import { logLegacyMarketplaceSync, logIntegracaoEvent } from './integracaoEventLog.js';

const DEFAULT_MARKETPLACE = 'nuvemshop';

async function listIntegrations(clienteId) {
  const supabase = requireSupabaseAdmin();
  const rows = await listConnectedIntegrationsRows(supabase, clienteId);
  const mapped = rows.map((row) => ({
    ...row,
    sync_estoque: normalizeIntegrationStockSyncFlag(row.sync_estoque),
  }));
  if (isTrayIntegrationEnabled()) return mapped;
  return mapped.filter((row) => row.marketplace !== 'tray');
}
const PEDIDO_APROVADO = 'Pedido Aprovado';
const PLACEHOLDER_EMAILS = new Set([
  'email@naoinformado.com',
  'email@noinformado.com',
]);

function parseMoney(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseOrderDate(order) {
  const raw = order.created_at || order.updated_at;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function logOrderSync(clienteId, action, status, extra = {}) {
  await logLegacyMarketplaceSync(clienteId, action, status, extra);
}

async function loadProductMaps(clienteId, integracaoId = null, marketplace = DEFAULT_MARKETPLACE) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_produto_map')
    .select(`
      id, produto_id, produto_cor_tamanho_id, external_variant_id, external_product_id, integracao_id,
      produto_cor_tamanho ( id, cor, tamanho, sku_variacao ),
      produtos ( id, nome, sku )
    `)
    .eq('cliente_id', clienteId)
    .eq('marketplace', marketplace);

  if (error) throw error;

  let rows = data || [];
  if (integracaoId) {
    const integrationKey = String(integracaoId);
    rows = rows.filter(
      (row) => row.integracao_id == null || String(row.integracao_id) === integrationKey,
    );
  }

  rows = await enrichProductMapRows(supabase, rows);
  return buildProductMapIndexes(rows);
}

async function enrichProductMapRows(supabase, rows) {
  if (!rows.length) return rows;

  const variacaoIds = [...new Set(rows.map((row) => row.produto_cor_tamanho_id).filter(Boolean))];
  const produtoIds = [...new Set(rows.map((row) => row.produto_id).filter(Boolean))];

  const [{ data: variacoes }, { data: produtos }] = await Promise.all([
    variacaoIds.length
      ? supabase
        .from('produto_cor_tamanho')
        .select('id, cor, tamanho, sku_variacao')
        .in('id', variacaoIds)
      : Promise.resolve({ data: [] }),
    produtoIds.length
      ? supabase
        .from('produtos')
        .select('id, nome, sku')
        .in('id', produtoIds)
      : Promise.resolve({ data: [] }),
  ]);

  const variacaoById = new Map((variacoes || []).map((row) => [row.id, row]));
  const produtoById = new Map((produtos || []).map((row) => [row.id, row]));

  return rows.map((row) => ({
    ...row,
    produto_cor_tamanho: row.produto_cor_tamanho
      || (row.produto_cor_tamanho_id ? variacaoById.get(row.produto_cor_tamanho_id) || null : null),
    produtos: row.produtos || (row.produto_id ? produtoById.get(row.produto_id) || null : null),
  }));
}

function normalizeMapAttr(value) {
  return String(value ?? 'Único').trim().toLowerCase();
}

function buildProductMapIndexes(rows) {
  const byVariant = new Map();
  const bySku = new Map();
  const byProductVariacao = new Map();
  const byProductNameVariacao = new Map();
  const byExternalProduct = new Map();

  for (const row of rows) {
    if (!row.produto_cor_tamanho_id) continue;

    if (row.external_variant_id) {
      byVariant.set(String(row.external_variant_id), row);
    }

    if (row.external_product_id) {
      const productKey = String(row.external_product_id);
      if (!byExternalProduct.has(productKey)) byExternalProduct.set(productKey, []);
      byExternalProduct.get(productKey).push(row);
    }

    const pct = row.produto_cor_tamanho;
    if (row.external_product_id && pct) {
      const key = `${String(row.external_product_id)}|${normalizeMapAttr(pct.cor)}|${normalizeMapAttr(pct.tamanho)}`;
      byProductVariacao.set(key, row);
    }

    const productName = String(row.produtos?.nome || '').trim().toLowerCase();
    if (productName && pct) {
      const nameKey = `${productName}|${normalizeMapAttr(pct.cor)}|${normalizeMapAttr(pct.tamanho)}`;
      byProductNameVariacao.set(nameKey, row);
    }

    for (const sku of [pct?.sku_variacao, row.produtos?.sku]) {
      const normalized = String(sku || '').trim().toLowerCase();
      if (!normalized) continue;
      if (!bySku.has(normalized)) bySku.set(normalized, []);
      bySku.get(normalized).push(row);
    }
  }

  return {
    byVariant,
    bySku,
    byProductVariacao,
    byProductNameVariacao,
    byExternalProduct,
    rows,
  };
}

function parseParentheticalLineName(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;

  const match = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!match) {
    return { productName: name.toLowerCase(), cor: 'Único', tamanho: 'Único' };
  }

  const productName = match[1].trim().toLowerCase();
  const label = match[2].trim();
  if (label.includes('/')) {
    const [cor, tamanho] = label.split('/').map((part) => part.trim());
    return {
      productName,
      cor: cor || 'Único',
      tamanho: tamanho || 'Único',
    };
  }

  return {
    productName,
    cor: label,
    tamanho: 'Único',
  };
}

function resolveLineProductName(line) {
  const fromField = String(line.name_without_variants || '').trim().toLowerCase();
  if (fromField) return fromField;
  return parseParentheticalLineName(line.name)?.productName || null;
}

function extractLineVariantValues(line) {
  const parsedName = parseParentheticalLineName(line.name);
  const productName = resolveLineProductName(line);

  if (Array.isArray(line.variant_values) && line.variant_values.length) {
    const rawValues = line.variant_values.map((value) => (
      typeof value === 'object'
        ? String(value.pt || value.es || value.en || '').trim()
        : String(value || '').trim()
    )).filter(Boolean);

    if (rawValues.length === 1) {
      return {
        cor: rawValues[0] || parsedName?.cor || 'Único',
        tamanho: 'Único',
        productName,
      };
    }

    if (rawValues.length >= 2) {
      return {
        cor: rawValues[0] || 'Único',
        tamanho: rawValues[1] || 'Único',
        productName,
      };
    }
  }

  if (parsedName) return parsedName;

  if (productName) {
    return { cor: 'Único', tamanho: 'Único', productName };
  }

  return null;
}

function resolveOrderLineIds(line) {
  const variantId = line.variant_id != null
    ? String(line.variant_id)
    : (line.variant?.id != null ? String(line.variant.id) : null);
  const productId = line.product_id != null
    ? String(line.product_id)
    : (line.product?.id != null ? String(line.product.id) : null);

  return { variantId, productId };
}

function variationMatchesLabel(pct, cor, tamanho) {
  if (!pct) return false;

  const nCor = normalizeMapAttr(pct.cor);
  const nTam = normalizeMapAttr(pct.tamanho);
  const nLineCor = normalizeMapAttr(cor);
  const nLineTam = normalizeMapAttr(tamanho);

  if (nCor === nLineCor && (nTam === nLineTam || nLineTam === 'único')) return true;
  if (nTam === nLineCor && nLineTam === 'único') return true;
  if (nCor === nLineCor && nTam === 'único' && nLineTam === 'único') return true;
  return false;
}

function findMapAmongCandidates(candidates, variant) {
  const valid = (candidates || []).filter((row) => row?.produto_cor_tamanho_id);
  if (!valid.length) return null;
  if (!variant) return valid.length === 1 ? valid[0] : null;
  if (valid.length === 1) return valid[0];

  for (const row of valid) {
    if (variationMatchesLabel(row.produto_cor_tamanho, variant.cor, variant.tamanho)) {
      return row;
    }
  }

  return null;
}

function findMapByProductNameAndAttrs(line, mapCatalog, variant = null) {
  const resolvedVariant = variant || extractLineVariantValues(line);
  if (!resolvedVariant) return null;

  const productName = resolvedVariant.productName || resolveLineProductName(line);
  if (!productName) return null;

  const candidates = mapCatalog.rows.filter((row) => {
    if (!row.produto_cor_tamanho_id || !row.produtos?.nome) return false;
    const nome = String(row.produtos.nome).trim().toLowerCase();
    return nome === productName
      || nome.startsWith(`${productName} `)
      || productName.startsWith(`${nome} `)
      || nome.startsWith(productName)
      || productName.startsWith(nome);
  });

  return findMapAmongCandidates(candidates, {
    ...resolvedVariant,
    productName,
  });
}

function resolveMapForOrderLine(line, mapCatalog) {
  const {
    byVariant,
    bySku,
    byProductVariacao,
    byProductNameVariacao,
    byExternalProduct,
  } = mapCatalog;
  const { variantId, productId } = resolveOrderLineIds(line);
  const sku = String(line.sku || '').trim().toLowerCase();
  const variant = extractLineVariantValues(line);

  if (variantId && byVariant.has(variantId)) {
    return byVariant.get(variantId);
  }

  if (productId && byExternalProduct.has(productId)) {
    const matched = findMapAmongCandidates(byExternalProduct.get(productId), variant);
    if (matched) return matched;
  }

  if (productId && variant) {
    const keys = [
      `${productId}|${normalizeMapAttr(variant.cor)}|${normalizeMapAttr(variant.tamanho)}`,
      `${productId}|${normalizeMapAttr(variant.cor)}|único`,
      `${productId}|único|${normalizeMapAttr(variant.tamanho)}`,
    ];
    for (const key of keys) {
      if (byProductVariacao.has(key)) {
        return byProductVariacao.get(key);
      }
    }
  }

  if (variant?.productName) {
    const nameKeys = [
      `${variant.productName}|${normalizeMapAttr(variant.cor)}|${normalizeMapAttr(variant.tamanho)}`,
      `${variant.productName}|${normalizeMapAttr(variant.cor)}|único`,
      `${variant.productName}|único|${normalizeMapAttr(variant.tamanho)}`,
    ];
    for (const key of nameKeys) {
      if (byProductNameVariacao.has(key)) {
        return byProductNameVariacao.get(key);
      }
    }
  }

  const byName = findMapByProductNameAndAttrs(line, mapCatalog, variant);
  if (byName) return byName;

  if (sku && bySku.has(sku)) {
    const skuCandidates = bySku.get(sku);
    const matched = findMapAmongCandidates(skuCandidates, variant);
    if (matched) return matched;
    if (productId) {
      const scoped = skuCandidates.filter(
        (row) => String(row.external_product_id) === productId,
      );
      const scopedMatch = findMapAmongCandidates(scoped, variant);
      if (scopedMatch) return scopedMatch;
    }
    if (skuCandidates.length === 1) return skuCandidates[0];
  }

  return null;
}

async function resolveEmpresaId(clienteId) {
  const supabase = requireSupabaseAdmin();
  const { data } = await supabase
    .from('empresas')
    .select('id')
    .eq('cliente_id', clienteId)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email || !email.includes('@') || PLACEHOLDER_EMAILS.has(email)) return null;
  return email;
}

function normalizeDocument(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) return digits;
  return null;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits;
}

function extractOrderBuyer(order) {
  const customer = order.customer || {};
  const name = (
    order.contact_name
    || customer.name
    || order.billing_name
    || order.billing_business_name
    || order.billing_trade_name
    || ''
  ).trim();

  const email = normalizeEmail(order.contact_email || customer.email);
  const phone = normalizePhone(
    order.contact_phone || order.billing_phone || customer.phone,
  );
  const document = normalizeDocument(
    order.contact_identification
    || order.billing_identification
    || customer.identification
    || order.billing_tax_id,
  );

  return {
    name,
    email,
    phone,
    document,
    externalCustomerId: customer.id != null ? String(customer.id) : null,
    billingCity: order.billing_city || order.shipping_city || null,
    billingState: order.billing_province || order.shipping_province || null,
  };
}

function extractOrderAddress(order) {
  const cepRaw = order.billing_zipcode || order.shipping_zipcode || '';
  const cep = String(cepRaw).replace(/\D/g, '');
  const rua = String(order.billing_address || order.shipping_address || '').trim();
  if (!cep || !rua) return null;

  return {
    cep,
    rua,
    numero: order.billing_number || order.shipping_number || null,
    complemento: order.billing_floor || order.shipping_floor || null,
    bairro: order.billing_locality || order.shipping_locality || null,
    estado: order.billing_province || order.shipping_province || null,
  };
}

function buildBuyerObservacao(order, buyer) {
  const parts = [`Importado da Nuvemshop — pedido #${order.number || order.id}`];
  if (buyer.externalCustomerId) {
    parts.push(`cliente Nuvemshop ${buyer.externalCustomerId}`);
  }
  return parts.join(' · ');
}

function cadastrosForTenantQuery(supabase, tenantId, columns = 'id') {
  return supabase
    .from('clientes_cadastros')
    .select(columns)
    .eq('cliente_id', tenantId);
}

async function findCadastroByContact(supabase, tenantId, { email, phone }) {
  const { data: cadastros, error: cadastrosError } = await supabase
    .from('clientes_cadastros')
    .select('id')
    .eq('cliente_id', tenantId);

  if (cadastrosError) throw cadastrosError;

  const cadastroIds = (cadastros || []).map((row) => row.id);
  if (!cadastroIds.length) return null;

  if (email) {
    const { data, error } = await supabase
      .from('cliente_contato')
      .select('cadastro_id')
      .in('cadastro_id', cadastroIds)
      .ilike('email', email)
      .limit(1)
      .maybeSingle();

    if (!error && data?.cadastro_id) return data.cadastro_id;
  }

  if (phone) {
    const { data: contacts, error } = await supabase
      .from('cliente_contato')
      .select('cadastro_id, numero')
      .in('cadastro_id', cadastroIds)
      .not('numero', 'is', null)
      .limit(500);

    if (!error && contacts?.length) {
      const match = contacts.find(
        (row) => normalizePhone(row.numero) === phone,
      );
      if (match?.cadastro_id) return match.cadastro_id;
    }
  }

  return null;
}

async function findExistingBuyerClient(supabase, tenantId, buyer) {
  if (buyer.document) {
    const docFields = buyer.document.length === 14
      ? ['cnpj', 'cpf']
      : ['cpf', 'cnpj'];

    for (const field of docFields) {
      const { data, error } = await cadastrosForTenantQuery(supabase, tenantId, 'id')
        .eq(field, buyer.document)
        .limit(1)
        .maybeSingle();
      if (!error && data?.id) return data.id;
    }

    const { data: rows, error: rowsError } = await cadastrosForTenantQuery(
      supabase,
      tenantId,
      'id, cpf, cnpj',
    )
      .or('cpf.not.is.null,cnpj.not.is.null')
      .limit(1000);

    if (!rowsError && rows?.length) {
      const match = rows.find((row) =>
        normalizeDocument(row.cpf) === buyer.document
        || normalizeDocument(row.cnpj) === buyer.document,
      );
      if (match?.id) return match.id;
    }
  }

  return findCadastroByContact(supabase, tenantId, buyer);
}

async function createBuyerClient(supabase, tenantId, buyer, order) {
  const displayName = buyer.name || `Cliente Nuvemshop #${order.number || order.id}`;
  const tipoPessoa = buyer.document?.length === 14 ? 'Juridica' : 'Fisica';
  const email = buyer.email || `nv-${order.id}@importado.azoup.local`;

  const cadastroPayload = {
    cliente_id: tenantId,
    nome: displayName,
    tipo_pessoa: tipoPessoa,
    observacoes: buildBuyerObservacao(order, buyer),
    ativo: true,
  };

  if (buyer.document?.length === 11) cadastroPayload.cpf = buyer.document;
  if (buyer.document?.length === 14) cadastroPayload.cnpj = buyer.document;

  const { data: cadastro, error: cadastroError } = await supabase
    .from('clientes_cadastros')
    .insert(cadastroPayload)
    .select('id')
    .single();

  if (cadastroError || !cadastro?.id) {
    throw new Error(
      `Não foi possível cadastrar o cliente do pedido: ${cadastroError?.message || 'erro desconhecido'}`,
    );
  }

  const cadastroId = cadastro.id;

  const { error: contatoError } = await supabase
    .from('cliente_contato')
    .insert({
      cadastro_id: cadastroId,
      contato: displayName,
      email,
      numero: buyer.phone || null,
      principal: true,
    });

  if (contatoError) {
    throw new Error(
      `Não foi possível cadastrar o contato do cliente: ${contatoError.message}`,
    );
  }

  const address = extractOrderAddress(order);
  if (address) {
    const { error: enderecoError } = await supabase
      .from('cliente_endereco')
      .insert({
        cadastro_id: cadastroId,
        cep: address.cep,
        rua: address.rua,
        numero: address.numero,
        complemento: address.complemento,
        bairro: address.bairro,
        estado: address.estado,
        principal: true,
      });

    if (enderecoError) {
      console.warn(
        `[marketplaceOrderSync] Endereço não cadastrado para cliente ${cadastroId}:`,
        enderecoError.message,
      );
    }
  }

  return cadastroId;
}

async function resolveBuyerClientId(clienteId, order) {
  const supabase = requireSupabaseAdmin();
  const buyer = extractOrderBuyer(order);

  const existingId = await findExistingBuyerClient(supabase, clienteId, buyer);
  if (existingId) return existingId;

  return createBuyerClient(supabase, clienteId, buyer, order);
}

function getOrderCustomerFields(order) {
  const buyer = extractOrderBuyer(order);
  return {
    customerName: buyer.name || order.contact_name || order.billing_name || null,
    customerEmail: buyer.email || order.contact_email || null,
  };
}

function shouldImportOrder(order, integration) {
  return shouldImportMarketplaceOrder(order, integration);
}

async function fetchExternalOrder(integration, externalOrderId) {
  if (integration.marketplace === 'tray') {
    if (!isTrayIntegrationEnabled()) {
      throw new Error('Integração Tray temporariamente desabilitada.');
    }
    const {
      getTrayOrder,
      normalizeTrayOrder,
      resolveTrayIntegration,
    } = await import('./trayClient.js');
    const trayIntegration = await resolveTrayIntegration(integration);
    const raw = await getTrayOrder(
      trayIntegration.api_address,
      trayIntegration.access_token,
      externalOrderId,
    );
    return normalizeTrayOrder(raw);
  }

  const creds = requireNuvemshopCredentials();
  return getOrder(
    integration.store_id,
    integration.access_token,
    externalOrderId,
    creds,
  );
}

async function listExternalOrders(integration) {
  if (integration.marketplace === 'tray') {
    if (!isTrayIntegrationEnabled()) {
      return [];
    }
    const {
      listAllTrayOrders,
      normalizeTrayOrder,
      resolveTrayIntegration,
    } = await import('./trayClient.js');
    const trayIntegration = await resolveTrayIntegration(integration);
    const orders = await listAllTrayOrders(
      trayIntegration.api_address,
      trayIntegration.access_token,
      { maxPages: 10 },
    );
    return orders.map((order) => normalizeTrayOrder(order));
  }

  const creds = requireNuvemshopCredentials();
  return listAllOrders(
    integration.store_id,
    integration.access_token,
    { payment_status: 'any', per_page: 50, maxPages: 10 },
    creds,
  );
}

function getOrderMarketplaceMeta(integration) {
  const marketplace = integration?.marketplace || DEFAULT_MARKETPLACE;
  return {
    marketplace,
    label: marketplace === 'tray' ? 'Tray' : 'Nuvemshop',
    prefix: marketplace === 'tray' ? 'TR' : 'NV',
  };
}

async function buildVendaItems(order, mapCatalog, supabase) {
  const grouped = new Map();
  const unmapped = [];

  for (const line of order.products || []) {
    const map = resolveMapForOrderLine(line, mapCatalog);
    const quantity = parseMoney(line.quantity) || 1;
    const unitPrice = parseMoney(line.price);

    if (!map?.produto_id || !map?.produto_cor_tamanho_id) {
      unmapped.push(line.name || line.sku || line.variant_id || 'Item');
      continue;
    }

    const key = map.produto_cor_tamanho_id;
    if (grouped.has(key)) {
      const prev = grouped.get(key);
      prev.quantidade += quantity;
      prev.valor_total += unitPrice * quantity;
    } else {
      grouped.set(key, {
        produto_id: map.produto_id,
        produto_cor_tamanho_id: map.produto_cor_tamanho_id,
        quantidade: quantity,
        valor_unitario: unitPrice,
        valor_total: unitPrice * quantity,
      });
    }
  }

  if (grouped.size === 0) {
    throw new Error(
      unmapped.length
        ? `Nenhum item vinculado ao catálogo Azoup. Produtos: ${unmapped.slice(0, 3).join(', ')}`
        : 'Pedido sem itens.',
    );
  }

  const variacaoIds = [...grouped.keys()];
  const { data: variacoes } = await supabase
    .from('produto_cor_tamanho')
    .select('id, cor, tamanho')
    .in('id', variacaoIds);

  const variacaoById = new Map((variacoes || []).map((v) => [v.id, v]));

  const items = [...grouped.values()].map((item) => {
    const variacao = variacaoById.get(item.produto_cor_tamanho_id);
    return {
      ...item,
      cor: variacao?.cor || 'Único',
      tamanho: variacao?.tamanho || 'Único',
      valor_unitario_base: item.valor_unitario,
      quantidade_expedicao: 0,
    };
  });

  return { items, unmapped };
}

async function upsertOrderMap(clienteId, payload) {
  const supabase = requireSupabaseAdmin();
  const marketplace = payload.marketplace || DEFAULT_MARKETPLACE;
  const { data, error } = await supabase
    .from('marketplace_pedido_map')
    .upsert({
      ...payload,
      cliente_id: clienteId,
      marketplace,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cliente_id,marketplace,external_order_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function importOrderToVenda(clienteId, order, ctx) {
  const supabase = requireSupabaseAdmin();
  const externalOrderId = String(order.id);
  const existing = ctx.existingMaps.get(externalOrderId);

  if (existing?.venda_id) {
    return { skipped: true, map: existing, reason: 'already_imported' };
  }

  const { items, unmapped } = await buildVendaItems(order, ctx.mapCatalog, supabase);
  const itemsTotal = items.reduce((sum, item) => sum + item.valor_total, 0);
  const orderTotal = parseMoney(order.total) || itemsTotal;
  const frete = parseMoney(order.shipping_cost_customer ?? order.shipping_cost ?? order.shipping);

  const buyerClientId = await resolveBuyerClientId(clienteId, order);
  const buyer = extractOrderBuyer(order);
  const { customerName, customerEmail } = getOrderCustomerFields(order);
  const externalOrderNumber = String(order.number ?? '');
  const { label: marketplaceLabel, prefix: orderPrefix, marketplace } = getOrderMarketplaceMeta(ctx.integration);

  let observacao = [
    `Marketplace ${marketplaceLabel} · Pedido #${externalOrderNumber}`,
    `(ID ${externalOrderId})`,
  ].join(' ');
  if (customerName || customerEmail) {
    observacao += ` · Cliente: ${customerName}${customerEmail ? ` <${customerEmail}>` : ''}`;
  }
  if (buyer.document) {
    observacao += ` · ${buyer.document.length === 14 ? 'CNPJ' : 'CPF'}: ${buyer.document}`;
  }
  if (unmapped.length) {
    observacao += ` · Itens não vinculados: ${unmapped.join(', ')}`;
  }

  const vendaPayload = {
    cliente_id_tenant: clienteId,
    empresa_id: ctx.empresaId,
    cliente_id: buyerClientId,
    tipo: PEDIDO_APROVADO,
    etapa: PEDIDO_APROVADO,
    codigo_pedido: `${orderPrefix}-${externalOrderNumber || externalOrderId}`,
    valor_total: orderTotal,
    frete,
    desconto_valor: 0,
    observacao,
    vendedor_id: ctx.usuarioId || null,
    tabela_preco_id: ctx.integration?.tabela_preco_id || null,
  };

  const { data: venda, error: vendaError } = await supabase
    .from('venda')
    .insert(vendaPayload)
    .select('id, codigo_pedido, valor_total, created_at')
    .single();

  if (vendaError) throw vendaError;

  const vendaItems = items.map((item) => ({
    venda_id: venda.id,
    produto_id: item.produto_id,
    produto_cor_tamanho_id: item.produto_cor_tamanho_id,
    cor: item.cor,
    tamanho: item.tamanho,
    quantidade: item.quantidade,
    valor_unitario: item.valor_unitario,
    valor_unitario_base: item.valor_unitario_base,
    valor_total: item.valor_total,
    quantidade_expedicao: 0,
  }));

  const { error: itemsError } = await supabase.from('venda_itens').insert(vendaItems);
  if (itemsError) {
    await supabase.from('venda').delete().eq('id', venda.id);
    throw itemsError;
  }

  const map = await upsertOrderMap(clienteId, {
    marketplace,
    integracao_id: ctx.integration?.id || null,
    external_order_id: externalOrderId,
    external_order_number: externalOrderNumber,
    venda_id: venda.id,
    payment_status: order.payment_status || null,
    order_status: order.status || null,
    sync_status: unmapped.length ? 'partial' : 'imported',
    error_message: unmapped.length
      ? `Importado parcialmente. Itens não vinculados: ${unmapped.join(', ')}`
      : null,
    order_total: orderTotal,
    customer_name: customerName || null,
    customer_email: customerEmail || null,
    customer_document: buyer.document || null,
    order_created_at: parseOrderDate(order),
    imported_at: new Date().toISOString(),
  });

  await logOrderSync(clienteId, 'import_order', 'success', {
    integracao_id: ctx.integration?.id || null,
    loja_nome: ctx.integration?.nome || ctx.integration?.store_name || null,
    payload: {
      external_order_id: externalOrderId,
      venda_id: venda.id,
      cliente_cadastro_id: buyerClientId,
    },
  });

  return { skipped: false, map, venda };
}

function formatOrderRow(order, mapRow, integrationMeta = null) {
  const externalOrderId = String(order.id);
  const buyer = extractOrderBuyer(order);
  const { customerName, customerEmail } = getOrderCustomerFields(order);
  const imported = Boolean(mapRow?.venda_id);
  let syncStatus = 'pending';

  if (imported) {
    syncStatus = mapRow.sync_status === 'partial' ? 'partial' : 'imported';
  } else if (mapRow?.sync_status === 'error') {
    syncStatus = 'error';
  } else if (!shouldImportOrder(order, integrationMeta)) {
    syncStatus = 'waiting_import';
  }

  return {
    externalOrderId,
    integracaoId: mapRow?.integracao_id || integrationMeta?.id || null,
    storeName: integrationMeta?.nome || integrationMeta?.store_name || null,
    externalOrderNumber: String(order.number ?? mapRow?.external_order_number ?? ''),
    customerName: customerName || mapRow?.customer_name || '—',
    customerEmail: customerEmail || mapRow?.customer_email || '',
    customerDocument: buyer.document || mapRow?.customer_document || '',
    total: parseMoney(order.total) || parseMoney(mapRow?.order_total),
    paymentStatus: order.payment_status || mapRow?.payment_status || '',
    orderStatus: order.status || mapRow?.order_status || '',
    createdAt: parseOrderDate(order) || mapRow?.order_created_at || null,
    syncStatus,
    vendaId: mapRow?.venda_id || null,
    codigoPedido: mapRow?.venda_id
      ? (mapRow?.venda?.codigo_pedido || `NV-${order.number ?? mapRow.external_order_number}`)
      : null,
    errorMessage: mapRow?.error_message || null,
    itemsCount: (order.products || []).length,
  };
}

function formatStoredOrderRow(row) {
  return {
    externalOrderId: row.external_order_id,
    integracaoId: row.integracao_id || null,
    storeName: row.integracao?.nome || row.integracao?.store_name || null,
    externalOrderNumber: row.external_order_number || '',
    customerName: row.customer_name || '—',
    customerEmail: row.customer_email || '',
    customerDocument: row.customer_document || '',
    total: parseMoney(row.order_total),
    paymentStatus: row.payment_status || '',
    orderStatus: row.order_status || '',
    createdAt: row.order_created_at,
    syncStatus: row.venda_id
      ? (row.sync_status === 'partial' ? 'partial' : 'imported')
      : (row.sync_status === 'pending' ? 'waiting_import' : (row.sync_status || 'error')),
    vendaId: row.venda_id,
    codigoPedido: row.venda?.codigo_pedido || (row.venda_id ? `NV-${row.external_order_number}` : null),
    errorMessage: row.error_message,
    itemsCount: null,
  };
}

async function buildOrderSyncContext(clienteId, integration, options = {}) {
  const supabase = requireSupabaseAdmin();
  const marketplace = integration?.marketplace || DEFAULT_MARKETPLACE;
  const [mapCatalog, existingMapsList, empresaId] = await Promise.all([
    loadProductMaps(clienteId, integration?.id, marketplace),
    supabase
      .from('marketplace_pedido_map')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('marketplace', marketplace),
    resolveEmpresaId(clienteId),
  ]);

  if (!empresaId) {
    throw new Error('Empresa não configurada para este tenant. Cadastre uma empresa no Azoup.');
  }

  const existingMaps = new Map(
    (existingMapsList.data || []).map((row) => [String(row.external_order_id), row]),
  );

  return {
    integration,
    mapCatalog,
    existingMaps,
    empresaId,
    usuarioId: options.usuarioId || null,
  };
}

async function processOrderForImport(clienteId, order, ctx) {
  const externalOrderId = String(order.id);
  const existing = ctx.existingMaps.get(externalOrderId);
  const buyer = extractOrderBuyer(order);
  const { customerName, customerEmail } = getOrderCustomerFields(order);

  if (!shouldImportOrder(order, ctx.integration)) {
    if (!existing) {
      const map = await upsertOrderMap(clienteId, {
        marketplace: ctx.integration?.marketplace || DEFAULT_MARKETPLACE,
        integracao_id: ctx.integration?.id || null,
        external_order_id: externalOrderId,
        external_order_number: String(order.number ?? ''),
        venda_id: null,
        payment_status: order.payment_status || null,
        order_status: order.status || null,
        sync_status: 'pending',
        error_message: null,
        order_total: parseMoney(order.total),
        customer_name: customerName,
        customer_email: customerEmail,
        customer_document: buyer.document || null,
        order_created_at: parseOrderDate(order),
      });
      ctx.existingMaps.set(externalOrderId, map);
    }
    return { action: 'waiting' };
  }

  if (existing?.venda_id) {
    return { action: 'skipped', map: existing };
  }

  if (existing?.sync_status === 'error') {
    await upsertOrderMap(clienteId, {
      marketplace: ctx.integration?.marketplace || existing.marketplace || DEFAULT_MARKETPLACE,
      integracao_id: ctx.integration?.id || existing.integracao_id || null,
      external_order_id: externalOrderId,
      external_order_number: String(order.number ?? existing.external_order_number ?? ''),
      venda_id: null,
      payment_status: order.payment_status || existing.payment_status || null,
      order_status: order.status || existing.order_status || null,
      sync_status: 'pending',
      error_message: null,
      order_total: parseMoney(order.total) || existing.order_total || 0,
      customer_name: customerName || existing.customer_name || null,
      customer_email: customerEmail || existing.customer_email || null,
      customer_document: buyer.document || existing.customer_document || null,
      order_created_at: parseOrderDate(order) || existing.order_created_at || null,
    });
  }

  try {
    const result = await importOrderToVenda(clienteId, order, ctx);
    if (result.skipped) {
      return { action: 'skipped', map: result.map };
    }
    ctx.existingMaps.set(externalOrderId, result.map);
    return { action: 'imported', map: result.map, venda: result.venda };
  } catch (err) {
    const map = await upsertOrderMap(clienteId, {
      marketplace: ctx.integration?.marketplace || DEFAULT_MARKETPLACE,
      integracao_id: ctx.integration?.id || null,
      external_order_id: externalOrderId,
      external_order_number: String(order.number ?? ''),
      venda_id: null,
      payment_status: order.payment_status || null,
      order_status: order.status || null,
      sync_status: 'error',
      error_message: err.message,
      order_total: parseMoney(order.total),
      customer_name: customerName,
      customer_email: customerEmail,
      customer_document: buyer.document || null,
      order_created_at: parseOrderDate(order),
    });
    ctx.existingMaps.set(externalOrderId, map);

    await logOrderSync(clienteId, 'import_order', 'error', {
      integracao_id: ctx.integration?.id || null,
      loja_nome: ctx.integration?.nome || ctx.integration?.store_name || null,
      error_message: err.message,
      payload: { external_order_id: externalOrderId, integracao_id: ctx.integration?.id || null },
    });

    return { action: 'error', error: err.message, map };
  }
}

async function syncOrdersForIntegration(clienteId, integrationRow, options = {}) {
  const integration = await getIntegrationById(clienteId, integrationRow.id);
  if (!integration) {
    throw new Error(`Loja ${integrationRow.nome || integrationRow.id} não encontrada ou desconectada.`);
  }

  const ctx = await buildOrderSyncContext(clienteId, integration, options);
  const externalOrders = await listExternalOrders(integration);

  const summary = { imported: 0, skipped: 0, errors: 0, waiting: 0 };
  const orders = [];

  for (const order of externalOrders) {
    const result = await processOrderForImport(clienteId, order, ctx);
    if (result.action === 'imported') summary.imported += 1;
    else if (result.action === 'skipped') summary.skipped += 1;
    else if (result.action === 'error') summary.errors += 1;
    else if (result.action === 'waiting') summary.waiting += 1;

    orders.push(formatOrderRow(
      order,
      ctx.existingMaps.get(String(order.id)),
      integration,
    ));
  }

  await logIntegracaoEvent(clienteId, {
    categoria: 'pedido',
    nivel: summary.errors > 0 ? 'warning' : 'success',
    acao: 'order_sync_batch',
    titulo: `Sincronização de pedidos — ${integration.nome || integration.store_name}`,
    integracaoId: integration.id,
    lojaNome: integration.nome || integration.store_name,
    mensagem: `${summary.imported} importado(s), ${summary.skipped} já existente(s), ${summary.waiting} aguardando regra, ${summary.errors} erro(s).`,
    payload: summary,
    usuarioId: options.usuarioId || null,
  });

  return { orders, summary };
}

export async function importMarketplaceOrderFromWebhook(clienteId, externalOrderId, { integration }) {
  const order = await fetchExternalOrder(integration, externalOrderId);

  const ctx = await buildOrderSyncContext(clienteId, integration, {});
  const result = await processOrderForImport(clienteId, order, ctx);

  return {
    ...result,
    externalOrderId: String(order.id),
    vendaId: result.map?.venda_id || null,
  };
}

function formatVendaCliente(cliente) {
  if (!cliente) return null;

  const contacts = Array.isArray(cliente.cliente_contato) ? cliente.cliente_contato : [];
  const primary = contacts.find((contact) => contact.principal) || contacts[0];

  return {
    id: cliente.id,
    nome: cliente.nome,
    cpf: cliente.cpf,
    cnpj: cliente.cnpj,
    email: primary?.email || null,
    telefone: primary?.numero || null,
  };
}

export async function getMarketplaceOrderDetail(clienteId, externalOrderId, options = {}) {
  const supabase = requireSupabaseAdmin();
  let mapQuery = supabase
    .from('marketplace_pedido_map')
    .select(`
      *,
      venda:venda_id (
        id, codigo_pedido, valor_total, frete, observacao, tipo, etapa, created_at,
        cliente:cliente_id (
          id, nome, cpf, cnpj,
          cliente_contato ( email, numero, principal )
        )
      ),
      integracao:integracao_id ( id, nome, store_name, marketplace )
    `)
    .eq('cliente_id', clienteId)
    .eq('external_order_id', String(externalOrderId));

  if (options.marketplace) {
    mapQuery = mapQuery.eq('marketplace', options.marketplace);
  }

  const { data: mapRow, error } = await mapQuery.maybeSingle();

  if (error) throw error;

  let liveOrder = null;
  let integration = null;
  const integrationId = mapRow?.integracao_id || options.integracaoId;

  if (integrationId) {
    integration = await getIntegrationById(clienteId, integrationId);
  } else {
    const lojas = await listIntegrations(clienteId);
    if (lojas.length === 1) {
      integration = await getIntegrationById(clienteId, lojas[0].id);
    }
  }

  if (integration) {
    try {
      liveOrder = await fetchExternalOrder(integration, externalOrderId);
    } catch {
      liveOrder = null;
    }
  }

  if (!mapRow && !liveOrder) {
    throw new Error('Pedido não encontrado.');
  }

  let vendaItems = [];
  if (mapRow?.venda_id) {
    const { data: items } = await supabase
      .from('venda_itens')
      .select(`
        id, produto_id, produto_cor_tamanho_id, cor, tamanho,
        quantidade, valor_unitario, valor_total,
        produtos ( nome, sku )
      `)
      .eq('venda_id', mapRow.venda_id);
    vendaItems = items || [];
  }

  const buyer = liveOrder ? extractOrderBuyer(liveOrder) : null;
  const marketplaceItems = (liveOrder?.products || []).map((line) => ({
    name: line.name || line.name_without_variants || '—',
    sku: line.sku || '',
    quantity: parseMoney(line.quantity) || 1,
    unitPrice: parseMoney(line.price),
    total: (parseMoney(line.quantity) || 1) * parseMoney(line.price),
    variantId: line.variant_id != null ? String(line.variant_id) : null,
  }));

  return {
    externalOrderId: String(externalOrderId),
    externalOrderNumber: mapRow?.external_order_number
      || (liveOrder?.number != null ? String(liveOrder.number) : ''),
    storeName: mapRow?.integracao?.nome
      || mapRow?.integracao?.store_name
      || integration?.nome
      || integration?.store_name
      || null,
    marketplace: mapRow?.integracao?.marketplace || integration?.marketplace || DEFAULT_MARKETPLACE,
    createdAt: mapRow?.order_created_at || parseOrderDate(liveOrder),
    paymentStatus: liveOrder?.payment_status || mapRow?.payment_status || '',
    orderStatus: liveOrder?.status || mapRow?.order_status || '',
    total: parseMoney(liveOrder?.total) || parseMoney(mapRow?.order_total),
    shipping: parseMoney(
      liveOrder?.shipping_cost_customer ?? liveOrder?.shipping_cost ?? liveOrder?.shipping,
    ),
    syncStatus: mapRow?.venda_id
      ? (mapRow.sync_status === 'partial' ? 'partial' : 'imported')
      : (mapRow?.sync_status || 'pending'),
    errorMessage: mapRow?.error_message || null,
    customer: {
      name: mapRow?.customer_name || buyer?.name || liveOrder?.contact_name || '—',
      email: mapRow?.customer_email || buyer?.email || '',
      document: mapRow?.customer_document || buyer?.document || '',
      phone: buyer?.phone || liveOrder?.contact_phone || '',
      city: buyer?.billingCity || liveOrder?.billing_city || '',
      state: buyer?.billingState || liveOrder?.billing_province || '',
    },
    venda: mapRow?.venda ? {
      id: mapRow.venda.id,
      codigoPedido: mapRow.venda.codigo_pedido,
      valorTotal: parseMoney(mapRow.venda.valor_total),
      frete: parseMoney(mapRow.venda.frete),
      observacao: mapRow.venda.observacao,
      tipo: mapRow.venda.tipo,
      etapa: mapRow.venda.etapa,
      createdAt: mapRow.venda.created_at,
      cliente: formatVendaCliente(mapRow.venda.cliente),
      items: vendaItems.map((item) => ({
        id: item.id,
        nome: item.produtos?.nome || '—',
        sku: item.produtos?.sku || '',
        cor: item.cor,
        tamanho: item.tamanho,
        quantidade: item.quantidade,
        valorUnitario: parseMoney(item.valor_unitario),
        valorTotal: parseMoney(item.valor_total),
      })),
    } : null,
    marketplaceItems,
  };
}

export async function syncAndListOrders(clienteId, options = {}) {
  const integrations = await listIntegrations(clienteId);
  if (!integrations.length) throw new Error('Nenhuma loja de e-commerce conectada.');

  const targetIntegrations = options.integracaoId
    ? integrations.filter((row) => String(row.id) === String(options.integracaoId))
    : integrations;

  if (!targetIntegrations.length) {
    throw new Error('Loja selecionada não encontrada ou desconectada.');
  }

  const summary = { imported: 0, skipped: 0, errors: 0, waiting: 0 };
  const allOrders = [];

  for (const integrationRow of targetIntegrations) {
    const { orders, summary: partial } = await syncOrdersForIntegration(
      clienteId,
      integrationRow,
      options,
    );
    allOrders.push(...orders);
    summary.imported += partial.imported;
    summary.skipped += partial.skipped;
    summary.errors += partial.errors;
    summary.waiting += partial.waiting;
  }

  allOrders.sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db - da;
  });

  return { orders: allOrders, summary };
}

export async function listStoredOrders(clienteId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_pedido_map')
    .select(`
      *,
      venda:venda_id ( id, codigo_pedido, valor_total, tipo, etapa, created_at ),
      integracao:integracao_id ( id, nome, store_name, marketplace )
    `)
    .eq('cliente_id', clienteId)
    .order('order_created_at', { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) throw error;

  return (data || []).map((row) => formatStoredOrderRow(row));
}
