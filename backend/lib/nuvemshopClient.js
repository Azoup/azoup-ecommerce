import { formatNuvemshopPrice } from './productPrices.js';

function resolveCredentials(creds = {}) {
  const redirectCandidates = creds.redirectUriCandidates
    || (creds.redirectUri ? [creds.redirectUri] : null)
    || (process.env.NUVEMSHOP_REDIRECT_URI ? [process.env.NUVEMSHOP_REDIRECT_URI] : []);

  return {
    clientId: creds.clientId || creds.client_id || process.env.NUVEMSHOP_CLIENT_ID || '',
    clientSecret: creds.clientSecret || creds.client_secret || process.env.NUVEMSHOP_CLIENT_SECRET || '',
    redirectUri: creds.redirectUri || creds.redirect_uri || redirectCandidates[0] || '',
    redirectUriCandidates: creds.redirectUriCandidates || redirectCandidates,
    userAgent: creds.userAgent || creds.user_agent || process.env.NUVEMSHOP_USER_AGENT || 'AzoupEcommerce (contato@azoup.com.br)',
    apiVersion: creds.apiVersion || creds.api_version || process.env.NUVEMSHOP_API_VERSION || '2025-03',
  };
}

async function postTokenExchange(code, c, redirectUri) {
  const body = {
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'authorization_code',
    code,
  };
  if (redirectUri) {
    body.redirect_uri = redirectUri;
  }

  const endpoints = [
    'https://www.nuvemshop.com.br/apps/authorize/token',
    'https://www.tiendanube.com/apps/authorize/token',
  ];

  let lastErr;
  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': c.userAgent,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return res.json();
    }

    const bodyText = await res.text();
    lastErr = new Error(`Falha ao obter token Nuvemshop (${res.status}): ${bodyText.slice(0, 300)}`);
  }

  throw lastErr;
}

function apiBase(storeId, apiVersion) {
  return `https://api.nuvemshop.com.br/${apiVersion}/${storeId}`;
}

async function nuvemFetch(url, accessToken, options = {}, creds = null) {
  const c = resolveCredentials(creds);
  const res = await fetch(url, {
    ...options,
    headers: {
      Authentication: `bearer ${accessToken}`,
      'User-Agent': c.userAgent,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Nuvemshop API ${res.status}: ${body.slice(0, 300)}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export function buildAuthorizeUrl(state, creds = null) {
  const c = resolveCredentials(creds);
  if (!c.clientId) {
    throw new Error('App Nuvemshop não configurado no servidor.');
  }
  return `https://www.nuvemshop.com.br/apps/${c.clientId}/authorize?state=${encodeURIComponent(state)}`;
}

export async function exchangeAuthorizationCode(code, creds = null) {
  const c = resolveCredentials(creds);
  if (!c.clientId || !c.clientSecret) {
    throw new Error('App Nuvemshop não configurado no servidor.');
  }

  const redirectAttempts = [
    null,
    ...c.redirectUriCandidates,
    c.redirectUri,
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  let lastErr;
  for (const redirectUri of redirectAttempts) {
    try {
      const tokenData = await postTokenExchange(code, c, redirectUri);
      if (!tokenData?.access_token || !tokenData?.user_id) {
        throw new Error('Resposta OAuth inválida: access_token ou user_id ausente.');
      }
      return tokenData;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Não foi possível trocar o code OAuth pela Nuvemshop.');
}

export async function getStore(storeId, accessToken, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/store`, accessToken, {}, c);
}

export async function listProducts(storeId, accessToken, page = 1, perPage = 50, creds = null) {
  const c = resolveCredentials(creds);
  const data = await nuvemFetch(
    `${apiBase(storeId, c.apiVersion)}/products?page=${page}&per_page=${perPage}`,
    accessToken,
    {},
    c,
  );
  return Array.isArray(data) ? data : [];
}

export async function getProduct(storeId, accessToken, productId, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/products/${productId}`, accessToken, {}, c);
}

export async function createProduct(storeId, accessToken, payload, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/products`, accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, c);
}

export async function createProductImage(storeId, accessToken, productId, payload, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/products/${productId}/images`, accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, c);
}

export async function listCategories(storeId, accessToken, page = 1, perPage = 200, creds = null) {
  const c = resolveCredentials(creds);
  const data = await nuvemFetch(
    `${apiBase(storeId, c.apiVersion)}/categories?page=${page}&per_page=${perPage}`,
    accessToken,
    {},
    c,
  );
  return Array.isArray(data) ? data : [];
}

export async function listAllCategories(storeId, accessToken, creds = null) {
  const all = [];
  let page = 1;

  while (true) {
    const batch = await listCategories(storeId, accessToken, page, 200, creds);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 200) break;
    page += 1;
    if (page > 50) break;
  }

  return all;
}

export async function createCategory(storeId, accessToken, payload, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/categories`, accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, c);
}

export async function listWebhooks(storeId, accessToken, creds = null) {
  const c = resolveCredentials(creds);
  const data = await nuvemFetch(
    `${apiBase(storeId, c.apiVersion)}/webhooks`,
    accessToken,
    {},
    c,
  );
  return Array.isArray(data) ? data : [];
}

export async function createWebhook(storeId, accessToken, payload, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/webhooks`, accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, c);
}

export async function ensureMarketplaceWebhooks(storeId, accessToken, webhookUrl, creds = null) {
  const url = String(webhookUrl || '').trim();
  if (!url.startsWith('https://')) return { registered: [] };

  const events = [
    'product/created',
    'product/updated',
    'product/deleted',
    'order/created',
    'order/updated',
    'order/paid',
  ];
  const existing = await listWebhooks(storeId, accessToken, creds);
  const registered = [];

  for (const event of events) {
    const already = existing.some((hook) => hook.event === event && hook.url === url);
    if (already) continue;
    await createWebhook(storeId, accessToken, { event, url }, creds);
    registered.push(event);
  }

  return { registered };
}

export async function updateProduct(storeId, accessToken, productId, payload, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/products/${productId}`, accessToken, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }, c);
}

export async function updateVariant(storeId, accessToken, productId, variantId, payload, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(
    `${apiBase(storeId, c.apiVersion)}/products/${productId}/variants/${variantId}`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    c,
  );
}

export async function createProductVariant(storeId, accessToken, productId, payload, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(
    `${apiBase(storeId, c.apiVersion)}/products/${productId}/variants`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    c,
  );
}

export async function updateVariantStock(storeId, accessToken, productId, payload, creds = null) {
  const c = resolveCredentials(creds);
  const raw = Array.isArray(payload) ? payload[0] : payload;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Payload de estoque inválido para Nuvemshop');
  }

  const body = {
    action: raw.action || 'replace',
    value: normalizeNuvemshopStock(raw.value ?? raw.stock ?? 0),
  };
  if (raw.id != null && raw.id !== '') {
    body.id = Number(raw.id);
  }
  if (raw.location_id) {
    body.location_id = raw.location_id;
  }

  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/products/${productId}/variants/stock`, accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  }, c);
}

/** Substitui o estoque de uma variação (compatível com multi-depósito / inventory_levels). */
export async function replaceNuvemshopVariantStock(
  storeId,
  accessToken,
  productId,
  variantId,
  stock,
  creds = null,
) {
  const c = resolveCredentials(creds);
  const normalized = normalizeNuvemshopStock(stock);
  const productKey = Number(productId);
  const variantKey = Number(variantId);

  try {
    await nuvemFetch(
      `${apiBase(storeId, c.apiVersion)}/products/stock-price`,
      accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify([{
          id: productKey,
          variants: [{
            id: variantKey,
            inventory_levels: [{ stock: normalized }],
          }],
        }]),
      },
      c,
    );
    return;
  } catch (batchErr) {
    console.warn('[nuvemshop] stock-price falhou, tentando endpoint legado:', batchErr.message);
  }

  let variant = null;
  try {
    variant = await getProductVariant(storeId, accessToken, productId, variantId, creds);
  } catch {
    // segue com endpoint legado sem location_id
  }

  const levels = variant?.inventory_levels;
  if (Array.isArray(levels) && levels.length > 1) {
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      await updateVariantStock(storeId, accessToken, productId, {
        id: variantId,
        action: 'replace',
        value: i === 0 ? normalized : 0,
        ...(level.location_id ? { location_id: level.location_id } : {}),
      }, creds);
    }
    return;
  }

  const locationId = levels?.[0]?.location_id;
  await updateVariantStock(storeId, accessToken, productId, {
    id: variantId,
    action: 'replace',
    value: normalized,
    ...(locationId ? { location_id: locationId } : {}),
  }, creds);
}

export async function listAllProductsWithVariants(storeId, accessToken, creds = null) {
  const all = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const batch = await listProducts(storeId, accessToken, page, perPage, creds);
    if (!batch.length) break;

    for (const product of batch) {
      const full = product.variants?.length
        ? product
        : await getProduct(storeId, accessToken, product.id, creds);
      all.push(full);
    }

    if (batch.length < perPage) break;
    page += 1;
    if (page > 100) break;
  }

  return all;
}

function parseNuvemshopStock(stock) {
  if (stock === '' || stock === null || stock === undefined) return 0;
  const value = Number(stock);
  return Number.isFinite(value) ? value : 0;
}

/** Estoque enviado à Nuvemshop: inteiro >= 0 (API rejeita negativos). */
export function normalizeNuvemshopStock(stock) {
  const value = parseNuvemshopStock(stock);
  return Math.max(0, Math.round(value));
}

/** Lê estoque da variação (campo legado `stock` ou `inventory_levels` multi-loja). */
export function resolveNuvemshopVariantStock(variant, product = null) {
  if (!variant) return 0;

  if (variant.stock !== undefined && variant.stock !== null && variant.stock !== '') {
    return normalizeNuvemshopStock(variant.stock);
  }

  if (Array.isArray(variant.inventory_levels) && variant.inventory_levels.length) {
    const total = variant.inventory_levels.reduce(
      (sum, level) => sum + parseNuvemshopStock(level?.stock ?? level?.quantity),
      0,
    );
    return normalizeNuvemshopStock(total);
  }

  const variants = product?.variants || [];
  if (product && variants.length <= 1) {
    const productStock = product.stock;
    if (productStock !== undefined && productStock !== null && productStock !== '') {
      return normalizeNuvemshopStock(productStock);
    }
  }

  return 0;
}

export async function getProductVariant(storeId, accessToken, productId, variantId, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(
    `${apiBase(storeId, c.apiVersion)}/products/${productId}/variants/${variantId}`,
    accessToken,
    {},
    c,
  );
}

export function parseVariantAttributes(variant) {
  const values = variant?.values || [];
  const cor = values[0]?.pt || values[0]?.es || values[0] || 'Único';
  const tamanho = values[1]?.pt || values[1]?.es || values[1] || 'Único';
  return {
    cor: String(cor),
    tamanho: String(tamanho),
  };
}

function normalizeAttr(value, fallback = 'Único') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function variantValuesKey(values) {
  return (values || [])
    .map((v) => String(v?.pt || v?.es || v || '').trim().toLowerCase())
    .join('|');
}

function ensureUniqueVariantValues(values, suffix, usedKeys) {
  const key = variantValuesKey(values);
  if (!usedKeys.has(key)) {
    usedKeys.set(key, 0);
    return values;
  }
  const count = usedKeys.get(key) + 1;
  usedKeys.set(key, count);
  const next = values.map((v) => ({ ...v }));
  const last = next[next.length - 1];
  next[next.length - 1] = { pt: `${last.pt} (${suffix})` };
  return next;
}

function inferModeFromAttributeLabels(attributes) {
  const labels = (attributes || []).map((a) => String(a?.pt || a?.es || '').toLowerCase());
  const hasCor = labels.some((l) => l.includes('cor'));
  const hasTamanho = labels.some((l) => l.includes('tamanho') || l.includes('talla') || l.includes('size'));
  if (hasCor && hasTamanho) return 'cor_tamanho';
  if (hasTamanho) return 'tamanho';
  if (hasCor) return 'cor';
  return 'variacao';
}

function hasMeaningfulCor(variations) {
  return variations.some((v) => normalizeAttr(v.cor) !== 'Único');
}

function hasMeaningfulTamanho(variations) {
  return variations.some((v) => normalizeAttr(v.tamanho) !== 'Único');
}

/** Define atributos Nuvemshop com base no catálogo Azoup e, se existir, na loja. */
export function resolveNuvemshopAttributeSchema(allVariations = [], existingAttributes = null) {
  if (existingAttributes?.length) {
    return {
      attributes: existingAttributes,
      mode: inferModeFromAttributeLabels(existingAttributes),
    };
  }

  const distinctCors = [...new Set(allVariations.map((v) => normalizeAttr(v.cor)))];
  const distinctTamanhos = [...new Set(allVariations.map((v) => normalizeAttr(v.tamanho)))];
  const corVaries = distinctCors.length > 1;
  const tamanhoVaries = distinctTamanhos.length > 1;
  const realCor = hasMeaningfulCor(allVariations);
  const realTamanho = hasMeaningfulTamanho(allVariations);

  if ((corVaries && tamanhoVaries) || (tamanhoVaries && realCor) || (corVaries && realTamanho)) {
    return {
      attributes: [{ pt: 'Cor' }, { pt: 'Tamanho' }],
      mode: 'cor_tamanho',
    };
  }
  if (tamanhoVaries) {
    return { attributes: [{ pt: 'Tamanho' }], mode: 'tamanho' };
  }
  if (corVaries) {
    return { attributes: [{ pt: 'Cor' }], mode: 'cor' };
  }
  if (realCor && realTamanho
    && allVariations.some((v) => normalizeAttr(v.cor) !== normalizeAttr(v.tamanho))) {
    return {
      attributes: [{ pt: 'Cor' }, { pt: 'Tamanho' }],
      mode: 'cor_tamanho',
    };
  }
  return { attributes: [{ pt: 'Variação' }], mode: 'variacao' };
}

function buildVariantValues(cor, tamanho, schema, variation, sku, index) {
  const c = normalizeAttr(cor);
  const t = normalizeAttr(tamanho);

  if (schema.mode === 'cor_tamanho') {
    return schema.attributes.map((attr) => {
      const label = String(attr?.pt || attr?.es || '').toLowerCase();
      if (label.includes('cor')) return { pt: c };
      if (label.includes('tamanho') || label.includes('talla') || label.includes('size')) {
        return { pt: t };
      }
      return { pt: c };
    });
  }
  if (schema.mode === 'tamanho') return [{ pt: t }];
  if (schema.mode === 'cor') return [{ pt: c }];
  if (c.toLowerCase() !== t.toLowerCase()) return [{ pt: `${c} / ${t}` }];
  return [{ pt: variation.sku_variacao || sku || `Variação ${index + 1}` }];
}

export function formatNuvemshopDecimal(value) {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return String(num);
}

export function withNuvemshopVariantDimensions(variantPayload, produto) {
  const dimensions = buildNuvemshopVariantDimensions(produto);
  if (!Object.keys(dimensions).length) return variantPayload;
  return { ...variantPayload, ...dimensions };
}

export function buildNuvemshopVariantDimensions({ peso, largura, altura, comprimento } = {}) {
  const out = {};
  const weight = formatNuvemshopDecimal(peso);
  const width = formatNuvemshopDecimal(largura);
  const height = formatNuvemshopDecimal(altura);
  const depth = formatNuvemshopDecimal(comprimento);
  if (weight !== undefined) out.weight = weight;
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  if (depth !== undefined) out.depth = depth;
  return out;
}

export function buildNuvemshopDescription(descricao) {
  const text = String(descricao ?? '').trim();
  if (!text) return undefined;
  return { pt: text };
}

/** Monta atributos e variações Nuvemshop a partir das variações Azoup. */
export function buildNuvemshopVariantEntries({
  sku,
  produtoId,
  variations = [],
  allVariations = null,
  getStock,
  existingNuvemVariants = [],
  existingNuvemAttributes = null,
  variantDimensions = {},
}) {
  const usedValueKeys = new Map();
  for (const nv of existingNuvemVariants) {
    const key = variantValuesKey(nv.values);
    if (!key) continue;
    usedValueKeys.set(key, (usedValueKeys.get(key) || 0) + 1);
  }

  const catalog = allVariations?.length ? allVariations : variations;
  const schema = resolveNuvemshopAttributeSchema(catalog, existingNuvemAttributes);

  if (!variations.length) {
    return {
      attributes: schema.attributes,
      variants: [{
        sku: sku || undefined,
        price: formatNuvemshopPrice(0),
        stock_management: true,
        stock: normalizeNuvemshopStock(getStock?.(null) ?? 0),
        values: schema.mode === 'cor_tamanho'
          ? [{ pt: 'Único' }, { pt: 'Único' }]
          : [],
        ...variantDimensions,
      }],
    };
  }

  const nuvemVariants = variations.map((v, index) => {
    let values = buildVariantValues(v.cor, v.tamanho, schema, v, sku, index);

    values = ensureUniqueVariantValues(
      values,
      v.sku_variacao || sku || String(index + 1),
      usedValueKeys,
    );

    const variant = {
      sku: v.sku_variacao || sku || undefined,
      price: formatNuvemshopPrice(v.preco_venda ?? 0),
      stock_management: true,
      stock: normalizeNuvemshopStock(getStock?.(v.id, produtoId, catalog.length) ?? 0),
      values,
      ...variantDimensions,
    };

    if (v.ean13) variant.barcode = String(v.ean13).trim();
    if (v.external_variant_id) variant.id = Number(v.external_variant_id);

    return variant;
  });

  return { attributes: schema.attributes, variants: nuvemVariants };
}

export function buildNuvemshopVariantCreatePayload(variant, produto = null) {
  const { id, ...rest } = variant;
  const payload = {
    ...rest,
    stock_management: rest.stock_management ?? true,
  };
  return produto ? withNuvemshopVariantDimensions(payload, produto) : payload;
}

/** Monta payload Nuvemshop respeitando regras de atributos/variações únicas. */
export function buildNuvemshopProductPayload({
  name,
  sku,
  produtoId,
  variations = [],
  allVariations = null,
  getStock,
  imageUrls = [],
  categoryIds = [],
  existingNuvemVariants = [],
  existingNuvemAttributes = null,
  descricao,
  variantDimensions = {},
}) {
  const attachImages = (payload) => {
    const urls = (imageUrls || []).filter(Boolean);
    if (urls.length) {
      payload.images = urls.map((src, index) => ({ src, position: index + 1 }));
    }
    return payload;
  };

  const { attributes, variants } = buildNuvemshopVariantEntries({
    sku,
    produtoId,
    variations,
    allVariations,
    getStock,
    existingNuvemVariants,
    existingNuvemAttributes,
    variantDimensions,
  });

  const description = buildNuvemshopDescription(descricao);

  const payload = {
    name: { pt: name },
    attributes,
    variants,
  };

  if (description) {
    payload.description = description;
  }

  if (categoryIds?.length) {
    payload.categories = categoryIds.map(Number);
  }

  return attachImages(payload);
}

export function findNuvemVariantForAzoup(nuvemVariants, { skuVariacao, skuPai, values }) {
  const targetSku = skuVariacao || skuPai;
  if (targetSku) {
    const bySku = nuvemVariants.find((nv) => nv.sku && String(nv.sku) === String(targetSku));
    if (bySku) return bySku;
  }
  const targetKey = variantValuesKey(values);
  return nuvemVariants.find((nv) => variantValuesKey(nv.values) === targetKey);
}

export async function listOrders(storeId, accessToken, params = {}, creds = null) {
  const c = resolveCredentials(creds);
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      qs.set(key, String(value));
    }
  });
  const query = qs.toString();
  const url = `${apiBase(storeId, c.apiVersion)}/orders${query ? `?${query}` : ''}`;
  const data = await nuvemFetch(url, accessToken, {}, c);
  return Array.isArray(data) ? data : [];
}

export async function listAllOrders(storeId, accessToken, params = {}, creds = null) {
  const all = [];
  let page = 1;
  const perPage = params.per_page || 50;
  const maxPages = params.maxPages || 10;

  while (page <= maxPages) {
    const batch = await listOrders(storeId, accessToken, {
      ...params,
      page,
      per_page: perPage,
    }, creds);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return all;
}

export async function getOrder(storeId, accessToken, orderId, creds = null) {
  const c = resolveCredentials(creds);
  return nuvemFetch(`${apiBase(storeId, c.apiVersion)}/orders/${orderId}`, accessToken, {}, c);
}

export function flattenNuvemProducts(products) {
  const rows = [];
  for (const product of products) {
    const variants = product.variants || [];
    if (variants.length === 0) {
      rows.push({
        external_product_id: String(product.id),
        external_variant_id: String(product.id),
        product_name: product.name?.pt || product.name?.es || product.name || '',
        variant_name: product.name?.pt || product.name?.es || product.name || '',
        sku: product.sku || '',
        price: product.price || 0,
        stock: resolveNuvemshopVariantStock({ stock: product.stock, inventory_levels: product.inventory_levels }, product),
        barcode: product.barcode || '',
        cor: 'Único',
        tamanho: 'Único',
        product_updated_at: product.updated_at || product.updatedAt || null,
        raw_product: product,
        raw_variant: null,
      });
      continue;
    }

    for (const variant of variants) {
      const { cor, tamanho } = parseVariantAttributes(variant);
      rows.push({
        external_product_id: String(product.id),
        external_variant_id: String(variant.id),
        product_name: product.name?.pt || product.name?.es || product.name || '',
        variant_name: `${cor} / ${tamanho}`,
        sku: variant.sku || product.sku || '',
        price: variant.price || product.price || 0,
        stock: resolveNuvemshopVariantStock(variant, product),
        barcode: variant.barcode || '',
        cor,
        tamanho,
        product_updated_at: product.updated_at || product.updatedAt || null,
        raw_product: product,
        raw_variant: variant,
      });
    }
  }
  return rows;
}
