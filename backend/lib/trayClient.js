import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { decryptToken, encryptToken } from './tokenCrypto.js';
import { normalizeTrayStoreUrl } from './trayConfig.js';

const TRAY_AUTH_ERRORS = new Set([401, 1000, 1001, 1099]);

function unwrapTrayEntity(payload, key) {
  if (!payload) return null;
  if (payload[key]) return payload[key];
  const listKey = `${key}s`;
  const list = payload[listKey];
  if (Array.isArray(list) && list.length) {
    const first = list[0];
    return first?.[key] || first || null;
  }
  return payload;
}

function parseTrayDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMoney(value) {
  const num = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

function buildApiUrl(apiAddress, path, accessToken, query = {}) {
  const base = String(apiAddress || '').replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();
  if (accessToken) params.set('access_token', accessToken);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${base}${cleanPath}${qs ? `?${qs}` : ''}`;
}

export function buildTrayAuthorizeUrl(storeUrl, consumerKey, callbackUrl) {
  const base = normalizeTrayStoreUrl(storeUrl);
  if (!base) throw new Error('Informe a URL da loja Tray.');
  const params = new URLSearchParams({
    response_type: 'code',
    consumer_key: consumerKey,
    callback: callbackUrl,
  });
  return `${base}/auth.php?${params.toString()}`;
}

export async function exchangeTrayAuthorizationCode(apiAddress, code, creds) {
  const url = buildApiUrl(apiAddress, '/auth', null);
  const body = new URLSearchParams({
    consumer_key: creds.consumerKey,
    consumer_secret: creds.consumerSecret,
    code: String(code),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.causes?.message || payload?.message || `Tray auth HTTP ${res.status}`);
  }
  if (payload?.code && TRAY_AUTH_ERRORS.has(Number(payload.code))) {
    throw new Error(payload.message || `Tray auth error ${payload.code}`);
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    date_expiration_access_token: payload.date_expiration_access_token,
    date_expiration_refresh_token: payload.date_expiration_refresh_token,
    store_id: payload.store_id || payload.store || null,
    api_address: payload.api_address || apiAddress,
  };
}

export async function refreshTrayAccessToken(apiAddress, refreshToken, creds) {
  const url = buildApiUrl(apiAddress, '/auth', null, { refresh_token: refreshToken });
  const res = await fetch(url, { method: 'GET' });
  const payload = await res.json().catch(() => ({}));

  if (!res.ok || (payload?.code && TRAY_AUTH_ERRORS.has(Number(payload.code)))) {
    throw new Error(payload?.message || payload?.causes?.message || `Tray refresh HTTP ${res.status}`);
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || refreshToken,
    date_expiration_access_token: payload.date_expiration_access_token,
    date_expiration_refresh_token: payload.date_expiration_refresh_token,
  };
}

export async function trayFetch(apiAddress, accessToken, path, options = {}) {
  const method = options.method || 'GET';
  const query = options.query || {};
  const url = buildApiUrl(apiAddress, path, accessToken, query);

  const fetchOptions = { method, headers: { ...(options.headers || {}) } };
  if (options.body != null) {
    fetchOptions.headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOptions);
  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = payload?.causes?.message || payload?.message || payload?.name || `Tray HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.trayCode = payload?.code;
    throw err;
  }

  if (payload?.code && TRAY_AUTH_ERRORS.has(Number(payload.code))) {
    const err = new Error(payload.message || `Tray error ${payload.code}`);
    err.trayCode = Number(payload.code);
    throw err;
  }

  return payload;
}

async function paginateTray(apiAddress, accessToken, path, listKey, entityKey, { limit = 50, maxPages = 100 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await trayFetch(apiAddress, accessToken, path, {
      query: { limit, page },
    });
    const list = payload[listKey] || [];
    for (const entry of list) {
      const entity = entry?.[entityKey] || entry;
      if (entity) items.push(entity);
    }
    const paging = payload.paging || {};
    const total = Number(paging.total) || items.length;
    const offset = Number(paging.offset) || 0;
    const pageLimit = Number(paging.limit) || limit;
    if (items.length >= total || list.length < pageLimit) break;
    if (offset + list.length >= total) break;
  }
  return items;
}

export async function listAllTrayProducts(apiAddress, accessToken) {
  return paginateTray(apiAddress, accessToken, '/products', 'Products', 'Product');
}

export async function listAllTrayVariants(apiAddress, accessToken) {
  return paginateTray(apiAddress, accessToken, '/products/variants', 'Variants', 'Variant');
}

export async function getTrayProduct(apiAddress, accessToken, productId) {
  const payload = await trayFetch(apiAddress, accessToken, `/products/${productId}`);
  return unwrapTrayEntity(payload, 'Product');
}

export async function getTrayVariant(apiAddress, accessToken, variantId) {
  const payload = await trayFetch(apiAddress, accessToken, `/products/variants/${variantId}`);
  return unwrapTrayEntity(payload, 'Variant');
}

export async function getTrayOrder(apiAddress, accessToken, orderId) {
  const payload = await trayFetch(apiAddress, accessToken, `/orders/${orderId}/complete`);
  return unwrapTrayEntity(payload, 'Order');
}

export async function listAllTrayOrders(apiAddress, accessToken, { maxPages = 20 } = {}) {
  return paginateTray(apiAddress, accessToken, '/orders', 'Orders', 'Order', { maxPages });
}

export async function createTrayProduct(apiAddress, accessToken, productPayload) {
  const payload = await trayFetch(apiAddress, accessToken, '/products', {
    method: 'POST',
    body: { Product: productPayload },
  });
  return unwrapTrayEntity(payload, 'Product');
}

export async function updateTrayProduct(apiAddress, accessToken, productId, productPayload) {
  const payload = await trayFetch(apiAddress, accessToken, `/products/${productId}`, {
    method: 'PUT',
    body: { Product: productPayload },
  });
  return unwrapTrayEntity(payload, 'Product');
}

export async function createTrayVariant(apiAddress, accessToken, variantPayload) {
  const payload = await trayFetch(apiAddress, accessToken, '/products/variants', {
    method: 'POST',
    body: { Variant: variantPayload },
  });
  return unwrapTrayEntity(payload, 'Variant');
}

export async function updateTrayVariant(apiAddress, accessToken, variantId, variantPayload) {
  const payload = await trayFetch(apiAddress, accessToken, '/products/variants', {
    method: 'PUT',
    body: { Variant: { ...variantPayload, id: String(variantId) } },
  });
  return unwrapTrayEntity(payload, 'Variant');
}

export function parseTrayVariantSku(variant) {
  const skuList = variant?.Sku || variant?.sku || [];
  const corSku = skuList.find((s) => String(s.type || s.Type || '').toLowerCase() === 'cor');
  const tamSku = skuList.find((s) => {
    const type = String(s.type || s.Type || '').toLowerCase();
    return type === 'tamanho' || type === 'size';
  });
  return {
    cor: corSku?.value || corSku?.Value || 'Único',
    tamanho: tamSku?.value || tamSku?.Value || 'Único',
  };
}

export function flattenTrayCatalog(products, variants) {
  const variantsByProduct = new Map();
  for (const variant of variants || []) {
    const productId = String(variant.product_id || '');
    if (!productId) continue;
    if (!variantsByProduct.has(productId)) variantsByProduct.set(productId, []);
    variantsByProduct.get(productId).push(variant);
  }

  const rows = [];
  for (const product of products || []) {
    const productId = String(product.id);
    const productName = product.name || `Produto ${productId}`;
    const hasVariation = String(product.has_variation || '0') !== '0';
    const productVariants = variantsByProduct.get(productId) || [];

    if (!hasVariation || productVariants.length === 0) {
      rows.push({
        external_product_id: productId,
        external_variant_id: productId,
        product_name: productName,
        sku: product.reference || product.ean || productId,
        cor: 'Único',
        tamanho: 'Único',
        stock: parseMoney(product.stock),
        price: parseMoney(product.promotional_price) || parseMoney(product.price),
        product_updated_at: product.modified || product.created || null,
        weight: parseMoney(product.weight),
        length: parseMoney(product.length),
        width: parseMoney(product.width),
        height: parseMoney(product.height),
      });
      continue;
    }

    for (const variant of productVariants) {
      const { cor, tamanho } = parseTrayVariantSku(variant);
      rows.push({
        external_product_id: productId,
        external_variant_id: String(variant.id),
        product_name: productName,
        sku: variant.reference || variant.ean || product.reference || String(variant.id),
        cor,
        tamanho,
        stock: parseMoney(variant.stock),
        price: parseMoney(variant.promotional_price) || parseMoney(variant.price),
        product_updated_at: variant.modified || product.modified || product.created || null,
        weight: parseMoney(variant.weight) || parseMoney(product.weight),
        length: parseMoney(variant.length) || parseMoney(product.length),
        width: parseMoney(variant.width) || parseMoney(product.width),
        height: parseMoney(variant.height) || parseMoney(product.height),
      });
    }
  }

  return rows;
}

export async function loadTrayCatalogRows(integration) {
  const products = await listAllTrayProducts(integration.api_address, integration.access_token);
  const variants = await listAllTrayVariants(integration.api_address, integration.access_token);
  return flattenTrayCatalog(products, variants);
}

export function normalizeTrayOrderProducts(order) {
  const sold = order?.ProductsSold || order?.products_sold || [];
  return sold.map((entry) => {
    const line = entry?.ProductsSold || entry;
    const variantId = line?.variant_id != null ? String(line.variant_id) : '0';
    const productId = line?.product_id != null ? String(line.product_id) : null;
    const name = line?.name || line?.original_name || 'Item';
    const textVariant = String(line?.text_variant || '').trim();
    const displayName = textVariant && !name.includes('(')
      ? `${name} (${textVariant})`
      : name;

    return {
      product_id: productId,
      variant_id: variantId !== '0' ? variantId : productId,
      name: displayName,
      sku: line?.reference || line?.ean || '',
      quantity: parseMoney(line?.quantity) || 1,
      price: parseMoney(line?.price),
      variant_values: textVariant ? [textVariant] : [],
      name_without_variants: line?.original_name || name,
    };
  });
}

export function normalizeTrayOrder(order) {
  const paymentList = order?.Payment || [];
  const payment = paymentList[0]?.Payment || paymentList[0] || null;
  const customer = order?.Customer?.Customer || order?.Customer || {};
  const address = order?.CustomerAddresses?.[0]?.CustomerAddress
    || customer?.CustomerAddress
    || null;

  const hasPayment = String(order?.has_payment || '0') !== '0'
    || Boolean(payment?.value)
    || Boolean(order?.payment_date && order.payment_date !== '0000-00-00');

  return {
    id: String(order.id),
    number: String(order.id),
    status: order.status || '',
    payment_status: hasPayment ? 'paid' : 'pending',
    total: parseMoney(order.total),
    shipping_cost: parseMoney(order.shipment_value),
    created_at: order.date && order.hour
      ? `${order.date} ${order.hour}`
      : order.date || order.modified || null,
    contact_name: customer.name || customer.corporate_name || '',
    contact_email: customer.email || '',
    contact_phone: customer.phone || customer.cellphone || '',
    billing_name: customer.name || customer.corporate_name || '',
    billing_city: address?.city || customer.city || '',
    billing_province: address?.state || customer.state || '',
    billing_locality: address?.neighborhood || '',
    billing_zipcode: address?.zip_code || customer.zip_code || '',
    billing_address: address?.address || '',
    billing_number: address?.number || '',
    billing_floor: address?.complement || '',
    products: normalizeTrayOrderProducts(order),
    _raw: order,
  };
}

export async function ensureTrayIntegrationToken(integrationRow) {
  const expiresAt = parseTrayDate(integrationRow.token_expires_at);
  const needsRefresh = !expiresAt || expiresAt.getTime() <= Date.now() + 5 * 60 * 1000;

  if (!needsRefresh) {
    return {
      ...integrationRow,
      access_token: decryptToken(integrationRow.access_token),
      refresh_token: integrationRow.refresh_token
        ? decryptToken(integrationRow.refresh_token)
        : null,
    };
  }

  if (!integrationRow.refresh_token || !integrationRow.api_address) {
    return {
      ...integrationRow,
      access_token: decryptToken(integrationRow.access_token),
      refresh_token: null,
    };
  }

  const { requireTrayCredentials } = await import('./trayConfig.js');
  const creds = requireTrayCredentials();
  const refreshed = await refreshTrayAccessToken(
    integrationRow.api_address,
    decryptToken(integrationRow.refresh_token),
    creds,
  );

  const supabase = requireSupabaseAdmin();
  const tokenExpiresAt = parseTrayDate(refreshed.date_expiration_access_token)?.toISOString() || null;

  await supabase
    .from('marketplace_integracao')
    .update({
      access_token: encryptToken(refreshed.access_token),
      refresh_token: encryptToken(refreshed.refresh_token),
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', integrationRow.id);

  return {
    ...integrationRow,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    token_expires_at: tokenExpiresAt,
  };
}

export async function resolveTrayIntegration(integrationRow) {
  const withToken = await ensureTrayIntegrationToken(integrationRow);
  if (!withToken.api_address) {
    throw new Error('Integração Tray sem api_address. Reconecte a loja.');
  }
  return withToken;
}

export function getTrayWebhookPublicUrl() {
  const backend = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  return `${backend.replace(/\/$/, '')}/api/marketplace/webhooks/tray`;
}
