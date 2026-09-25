import { supabase } from './supabase';

const CONFIGURED_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

function resolveBackendBase() {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return '';
  }
  return CONFIGURED_BACKEND_URL;
}

async function getAuthToken({ forceRefresh = false } = {}) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) return null;

  const expiresAt = (session?.expires_at ?? 0) * 1000;
  const expiresSoon = !session?.access_token || expiresAt <= Date.now() + 60_000;
  const shouldRefresh = forceRefresh || expiresSoon;

  if (!shouldRefresh) {
    return session.access_token;
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (!refreshError && refreshed.session?.access_token) {
    return refreshed.session.access_token;
  }

  if (!forceRefresh && session?.access_token && expiresAt > Date.now()) {
    return session.access_token;
  }

  return null;
}

async function authFetch(path, options = {}, retried = false) {
  const token = await getAuthToken({ forceRefresh: retried });
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = resolveBackendBase();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch {
    if (!retried) {
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
      return authFetch(path, options, true);
    }
    throw new Error(
      'Não foi possível conectar ao servidor. Verifique se o backend está rodando (porta 3001).',
    );
  }

  if ([502, 503, 504].includes(res.status) && !retried) {
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    return authFetch(path, options, true);
  }

  if (res.status === 401 && !retried) {
    return authFetch(path, options, true);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(body.error || 'Sessão expirada ou token inválido. Faça login novamente.');
    }
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return body;
}

const LOJA_STORAGE_KEY = 'azoup_selected_integracao_id';

function lojaStorageKey(clienteId) {
  return clienteId ? `${LOJA_STORAGE_KEY}:${clienteId}` : LOJA_STORAGE_KEY;
}

export function getStoredIntegracaoId(clienteId) {
  if (clienteId) {
    const scoped = localStorage.getItem(lojaStorageKey(clienteId));
    if (scoped) return scoped;
  }
  return localStorage.getItem(LOJA_STORAGE_KEY) || '';
}

export function setStoredIntegracaoId(integracaoId, clienteId) {
  const key = lojaStorageKey(clienteId);
  if (integracaoId) {
    localStorage.setItem(key, String(integracaoId));
  } else {
    localStorage.removeItem(key);
  }
}

export async function fetchMarketplaceProviders() {
  return authFetch('/api/marketplace/providers');
}

export async function fetchIntegrations() {
  return authFetch('/api/marketplace/integrations');
}

export async function fetchTabelasPreco() {
  return authFetch('/api/marketplace/tabelas-preco');
}

export async function updateIntegration(integracaoId, payload) {
  return authFetch(`/api/marketplace/integrations/${integracaoId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function fetchOrderImportConfig() {
  return authFetch('/api/marketplace/nuvemshop/order-import-config');
}

export async function fetchIntegracaoEventLog(params = {}) {
  const search = new URLSearchParams();
  if (params.categoria) search.set('categoria', params.categoria);
  if (params.nivel) search.set('nivel', params.nivel);
  if (params.integracaoId) search.set('integracaoId', params.integracaoId);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));
  const query = search.toString() ? `?${search.toString()}` : '';
  return authFetch(`/api/marketplace/event-log${query}`);
}

export async function disconnectIntegration(integracaoId) {
  return authFetch(`/api/marketplace/integrations/${integracaoId}`, {
    method: 'DELETE',
  });
}

export async function fetchNuvemshopStatus() {
  return fetchIntegrations();
}

export async function fetchNuvemshopAuthUrl({ nome, tabelaPrecoId, pontaEstoqueId }) {
  return authFetch('/api/marketplace/nuvemshop/auth-url', {
    method: 'POST',
    body: JSON.stringify({ nome, tabelaPrecoId, pontaEstoqueId }),
  });
}

export async function disconnectNuvemshop(integracaoId) {
  return disconnectIntegration(integracaoId);
}

export async function fetchPontasEstoque() {
  return authFetch('/api/marketplace/pontas-estoque');
}

export async function compareNuvemshopCatalog({ integracaoId } = {}) {
  const query = integracaoId
    ? `?integracaoId=${encodeURIComponent(integracaoId)}`
    : '';
  return authFetch(`/api/marketplace/nuvemshop/compare${query}`);
}

export async function importNuvemshopProducts(imports, integracaoId) {
  return authFetch('/api/marketplace/nuvemshop/import', {
    method: 'POST',
    body: JSON.stringify({ imports, integracaoId }),
  });
}

export async function exportNuvemshopProducts(exports, integracaoId) {
  return authFetch('/api/marketplace/nuvemshop/export', {
    method: 'POST',
    body: JSON.stringify({ exports, integracaoId }),
  });
}

export async function syncNuvemshopStock(items, { integracaoId } = {}) {
  return authFetch('/api/marketplace/nuvemshop/sync-stock', {
    method: 'POST',
    body: JSON.stringify({ items, integracaoId }),
  });
}

export async function syncNuvemshopPrices(produtoIds, { integracaoId } = {}) {
  return authFetch('/api/marketplace/nuvemshop/sync-prices', {
    method: 'POST',
    body: JSON.stringify({ produtoIds, integracaoId }),
  });
}

export async function syncNuvemshopSkus(produtoIds, { integracaoId } = {}) {
  return authFetch('/api/marketplace/nuvemshop/sync-skus', {
    method: 'POST',
    body: JSON.stringify({ produtoIds, integracaoId }),
  });
}

export async function fetchNuvemshopOrders({ sync = true, integracaoId } = {}) {
  const params = new URLSearchParams();
  if (!sync) params.set('sync', '0');
  if (integracaoId) params.set('integracaoId', integracaoId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return authFetch(`/api/marketplace/nuvemshop/orders${query}`);
}

export async function syncMarketplaceOrders({ integracaoId } = {}) {
  const body = integracaoId ? JSON.stringify({ integracaoId }) : undefined;
  return authFetch('/api/marketplace/nuvemshop/sync-orders', {
    method: 'POST',
    ...(body ? { body } : {}),
  });
}

export async function fetchNuvemshopOrderDetail(externalOrderId, { integracaoId } = {}) {
  const params = new URLSearchParams();
  if (integracaoId) params.set('integracaoId', integracaoId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return authFetch(`/api/marketplace/nuvemshop/orders/${encodeURIComponent(externalOrderId)}${query}`);
}

export const MARKETPLACE_LABELS = {
  nuvemshop: 'Nuvemshop',
  tray: 'Tray',
  mercadolivre: 'Mercado Livre',
  shopify: 'Shopify',
};

export async function fetchTrayAuthUrl({ nome, storeUrl, tabelaPrecoId, pontaEstoqueId }) {
  return authFetch('/api/marketplace/tray/auth-url', {
    method: 'POST',
    body: JSON.stringify({ nome, storeUrl, tabelaPrecoId, pontaEstoqueId }),
  });
}

export async function fetchMarketplaceAuthUrl({ marketplace, nome, storeUrl, tabelaPrecoId, pontaEstoqueId }) {
  if (marketplace === 'tray') {
    return fetchTrayAuthUrl({ nome, storeUrl, tabelaPrecoId, pontaEstoqueId });
  }
  return fetchNuvemshopAuthUrl({ nome, tabelaPrecoId, pontaEstoqueId });
}

export async function compareMarketplaceCatalog({ integracaoId } = {}) {
  return compareNuvemshopCatalog({ integracaoId });
}

export function formatLojaLabel(integration) {
  if (!integration) return '—';
  const marketplace = MARKETPLACE_LABELS[integration.marketplace] || integration.marketplace;
  return `${marketplace} · ${integration.nome || integration.store_name || 'Loja'}`;
}
