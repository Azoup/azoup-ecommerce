import { verifyOAuthState } from './oauthState.js';
import { requireTrayCredentials, normalizeTrayStoreUrl } from './trayConfig.js';
import {
  exchangeTrayAuthorizationCode,
  normalizeTrayOrder,
} from './trayClient.js';
import { saveTrayIntegration } from './marketplaceTraySync.js';

export function parseTrayOAuthCallbackInput({ code, store, api_address, apiAddress, url, callbackUrl }) {
  let resolvedCode = code ? String(code).trim() : '';
  let resolvedStore = store ? String(store).trim() : '';
  let resolvedApiAddress = api_address || apiAddress ? String(api_address || apiAddress).trim() : '';
  let resolvedStoreUrl = url ? normalizeTrayStoreUrl(url) : '';

  if (callbackUrl) {
    const raw = String(callbackUrl).trim();
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : raw;
    const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    resolvedCode = resolvedCode || params.get('code') || '';
    resolvedStore = resolvedStore || params.get('store') || '';
    resolvedApiAddress = resolvedApiAddress || params.get('api_address') || '';
    resolvedStoreUrl = resolvedStoreUrl || normalizeTrayStoreUrl(params.get('url') || '');
  }

  if (!resolvedCode || !resolvedApiAddress) {
    throw new Error(
      'Parâmetros OAuth Tray inválidos. Informe code e api_address retornados pelo callback da Tray.',
    );
  }

  return {
    code: resolvedCode,
    store: resolvedStore,
    api_address: resolvedApiAddress.replace(/\/+$/, ''),
    store_url: resolvedStoreUrl,
  };
}

export async function finishTrayOAuth(clienteId, callbackParams, state) {
  const payload = verifyOAuthState(state);
  if (payload.clienteId !== clienteId) {
    throw new Error('Este código OAuth não pertence à sua sessão. Clique em Conectar e tente novamente.');
  }

  const creds = requireTrayCredentials();
  const parsed = typeof callbackParams === 'string'
    ? parseTrayOAuthCallbackInput({ callbackUrl: callbackParams })
    : parseTrayOAuthCallbackInput(callbackParams);

  const tokenData = await exchangeTrayAuthorizationCode(parsed.api_address, parsed.code, creds);

  const saved = await saveTrayIntegration(clienteId, {
    ...tokenData,
    store_id: String(tokenData.store_id || parsed.store || ''),
    store_url: parsed.store_url || payload.storeUrl || null,
    api_address: parsed.api_address || tokenData.api_address,
    store_name: tokenData.store_name || null,
    nome: payload.nome || `Loja Tray ${tokenData.store_id || parsed.store || ''}`,
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

export { normalizeTrayOrder };
