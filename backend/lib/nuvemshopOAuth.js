import { verifyOAuthState } from './oauthState.js';
import { requireNuvemshopCredentials } from './marketplaceConfig.js';
import { exchangeAuthorizationCode, getStore } from './nuvemshopClient.js';
import { saveIntegration } from './marketplaceSync.js';

export function parseOAuthCallbackInput({ code, state, callbackUrl }) {
  let resolvedCode = code ? String(code).trim() : '';
  let resolvedState = state ? String(state).trim() : '';

  if (callbackUrl) {
    const raw = String(callbackUrl).trim();
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : raw;
    const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    resolvedCode = resolvedCode || params.get('code') || '';
    resolvedState = resolvedState || params.get('state') || '';
  }

  if (!resolvedCode || !resolvedState) {
    throw new Error('URL ou parâmetros code/state inválidos. Cole a URL completa após autorizar na Nuvemshop.');
  }

  return { code: resolvedCode, state: resolvedState };
}

export async function finishNuvemshopOAuth(clienteId, code, state) {
  const payload = verifyOAuthState(state);
  if (payload.clienteId !== clienteId) {
    throw new Error('Este código OAuth não pertence à sua sessão. Clique em Conectar e tente de novo.');
  }

  const creds = requireNuvemshopCredentials();
  const tokenData = await exchangeAuthorizationCode(code, creds);

  let storeName = null;
  try {
    const store = await getStore(String(tokenData.user_id), tokenData.access_token, creds);
    storeName = store?.name?.pt || store?.name?.es || store?.name || null;
  } catch {
    /* optional */
  }

  const saved = await saveIntegration(clienteId, {
    ...tokenData,
    store_name: storeName,
    nome: payload.nome || storeName || `Loja ${tokenData.user_id}`,
    tabela_preco_id: payload.tabelaPrecoId || null,
    ponta_estoque_id: payload.pontaEstoqueId || null,
  });

  return {
    id: saved.id,
    store_id: saved.store_id,
    store_name: saved.store_name,
    nome: saved.nome,
  };
}
