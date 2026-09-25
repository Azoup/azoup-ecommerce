import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { assertPontaEstoqueForTenant } from '../lib/estoqueLedger.js';
import { assertTabelaPrecoForTenant } from '../lib/productPrices.js';
import {
  buildAuthorizeUrl,
} from '../lib/nuvemshopClient.js';
import {
  compareCatalog,
  disconnectIntegration,
  exportProducts,
  getIntegrationStatus,
  importProducts,
  listIntegrations,
  saveIntegration,
  syncStock,
  syncProductPrices,
  syncProductSkus,
  getIntegration,
  updateIntegrationSettings,
  getOrderImportStatusDefinitions,
} from '../lib/marketplaceDispatch.js';
import {
  handleAzoupStockChangedWebhook,
  handleNuvemshopWebhookEvent,
  syncProductStockFromAzoup,
  verifyNuvemshopWebhookHmac,
} from '../lib/marketplaceStockSync.js';
import { listPontasEstoque } from '../lib/estoqueLedger.js';
import { syncAndListOrders, listStoredOrders, getMarketplaceOrderDetail } from '../lib/marketplaceOrderSync.js';
import { handleTrayWebhookEvent } from '../lib/marketplaceTrayWebhooks.js';
import { registerAllNuvemshopWebhooks } from '../lib/marketplaceWebhooks.js';
import { normalizeImportStatusConfig as normalizeNuvemshopImportStatusConfig } from '../lib/nuvemshopOrderStatuses.js';
import { normalizeImportStatusConfig as normalizeTrayImportStatusConfig } from '../lib/trayOrderStatuses.js';
import {
  EVENT_CATEGORIES,
  EVENT_LEVELS,
  listIntegracaoEvents,
} from '../lib/integracaoEventLog.js';
import {
  getConfiguredRedirectUri,
  getFrontendOAuthRelayUri,
  isNuvemshopAppConfigured,
  requireNuvemshopCredentials,
} from '../lib/marketplaceConfig.js';
import { finishNuvemshopOAuth, parseOAuthCallbackInput } from '../lib/nuvemshopOAuth.js';
import { finishTrayOAuth, parseTrayOAuthCallbackInput } from '../lib/trayOAuth.js';
import {
  buildTrayAuthorizeUrl,
  getTrayWebhookPublicUrl,
} from '../lib/trayClient.js';
import {
  getConfiguredTrayRedirectUri,
  getFrontendTrayOAuthRelayUri,
  isTrayAppConfigured,
  isTrayIntegrationEnabled,
  normalizeTrayStoreUrl,
  requireTrayCredentials,
} from '../lib/trayConfig.js';
import { createOAuthState, verifyOAuthState } from '../lib/oauthState.js';
import { requireSupabaseAdmin } from '../lib/supabaseAdmin.js';

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Limite de sincronização atingido. Tente novamente em 15 minutos.' },
});

const PROVIDERS = [
  { id: 'nuvemshop', label: 'Nuvemshop', enabled: true },
  { id: 'tray', label: 'Tray', enabled: isTrayIntegrationEnabled() },
  { id: 'mercadolivre', label: 'Mercado Livre', enabled: false },
  { id: 'shopify', label: 'Shopify', enabled: false },
];

function trayIntegrationDisabledResponse(res) {
  return res.status(503).json({
    error: 'Integração Tray temporariamente desabilitada.',
  });
}

function readIntegracaoId(source) {
  const value = source?.integracaoId ?? source?.integracao_id;
  return value ? String(value) : undefined;
}

function isMissingColumnError(error) {
  const message = String(error?.message || '');
  return error?.code === '42703'
    || /column .* does not exist/i.test(message)
    || /Could not find the .* column/i.test(message);
}

router.get('/integrations', requireAuth, async (req, res) => {
  try {
    const integrations = await listIntegrations(req.userData.cliente_id);
    res.json({
      integrations,
      connected: integrations.length > 0,
    });
  } catch (err) {
    console.error('[integrations]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/integrations/:integracaoId', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const settings = {
      nome: body.nome,
      tabela_preco_id: body.tabelaPrecoId ?? body.tabela_preco_id,
      ponta_estoque_id: body.pontaEstoqueId ?? body.ponta_estoque_id,
      importOrderStatuses: body.importOrderStatuses ?? body.import_order_statuses,
      usuarioId: req.userData.id,
    };
    if ('syncEstoque' in body || 'sync_estoque' in body) {
      settings.syncEstoque = body.syncEstoque ?? body.sync_estoque;
    }

    const integration = await updateIntegrationSettings(
      req.userData.cliente_id,
      req.params.integracaoId,
      settings,
    );
    res.json({ integration });
  } catch (err) {
    console.error('[integrations patch]', err);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/integrations/:integracaoId', requireAuth, async (req, res) => {
  try {
    await disconnectIntegration(req.userData.cliente_id, req.params.integracaoId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tabelas-preco', requireAuth, async (req, res) => {
  try {
    const supabase = requireSupabaseAdmin();
    const { data, error } = await supabase
      .from('tabela_precos')
      .select('id, descricao, ativo')
      .eq('cliente_id', req.userData.cliente_id)
      .eq('ativo', true)
      .order('descricao');
    if (error) throw error;
    res.json({ tabelas: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/providers', requireAuth, (_req, res) => {
  res.json({ providers: PROVIDERS });
});

router.get('/nuvemshop/oauth-info', requireAuth, (_req, res) => {
  res.json({
    redirectUriBackend: getConfiguredRedirectUri(),
    redirectUriFrontendRelay: getFrontendOAuthRelayUri(),
    appConfigured: isNuvemshopAppConfigured(),
  });
});

router.get('/nuvemshop/status', requireAuth, async (req, res) => {
  try {
    const integrations = await listIntegrations(req.userData.cliente_id);
    const integration = integrations[0] || null;
    res.json({
      connected: integrations.length > 0,
      integrations,
      integration,
      appConfigured: isNuvemshopAppConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nuvemshop/auth-url', requireAuth, async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    if (!nome) {
      return res.status(400).json({ error: 'Informe um nome para identificar a loja.' });
    }

    const tabelaPrecoId = req.body?.tabelaPrecoId || req.body?.tabela_preco_id;
    const pontaEstoqueId = req.body?.pontaEstoqueId || req.body?.ponta_estoque_id;
    if (!tabelaPrecoId || !pontaEstoqueId) {
      return res.status(400).json({ error: 'Tabela de preço e ponto de estoque são obrigatórios.' });
    }

    await assertTabelaPrecoForTenant(req.userData.cliente_id, tabelaPrecoId);
    await assertPontaEstoqueForTenant(req.userData.cliente_id, pontaEstoqueId);

    const creds = requireNuvemshopCredentials();
    const state = createOAuthState(req.userData.cliente_id, {
      nome,
      tabelaPrecoId,
      pontaEstoqueId,
    });
    const url = buildAuthorizeUrl(state, creds);
    res.json({ url, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nuvemshop/auth-url', requireAuth, async (req, res) => {
  res.status(400).json({
    error: 'Use POST /nuvemshop/auth-url informando nome, tabelaPrecoId e pontaEstoqueId.',
  });
});

function formatOAuthCallbackError(err) {
  const msg = err?.message || String(err);
  if (msg.includes('marketplace_integracao') && (msg.includes('does not exist') || msg.includes('schema cache'))) {
    return 'Tabela marketplace_integracao não existe. Execute database/marketplace_schema.sql no Supabase.';
  }
  if (msg.includes('SUPABASE_URL') || msg.includes('SERVICE_ROLE')) {
    return 'Backend sem credenciais Supabase. Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.';
  }
  if (msg.includes('State expirado')) {
    return 'Sessão OAuth expirou. Clique em Conectar novamente (válido por 10 minutos).';
  }
  if (msg.includes('Assinatura do state')) {
    return 'State OAuth inválido. Reinicie o backend e tente conectar de novo.';
  }
  if (msg.includes('401') || msg.includes('403')) {
    return `Credenciais ou code OAuth rejeitados pela Nuvemshop. Verifique Client Secret e Redirect URI no app. Detalhe: ${msg}`;
  }
  if (msg.includes('row-level security') || msg.includes('42501')) {
    return 'Supabase bloqueou salvar a conexão (RLS). Use SUPABASE_SERVICE_ROLE_KEY (secret) no backend/.env — não use a chave anon/publishable do frontend.';
  }
  return msg;
}

function sendOAuthRelayResult(req, res, payload) {
  if (req.query?.relay === 'json') {
    const status = payload.ok ? 200 : 400;
    return res.status(status).json(payload);
  }
  if (payload.ok) {
    return res.redirect(`${FRONTEND_URL}/app?menu=Settings&settings=connected&marketplace=nuvemshop`);
  }
  return res.redirect(
    `${FRONTEND_URL}/app?menu=Settings&settings=error&reason=${encodeURIComponent(payload.reason || 'Erro OAuth')}`,
  );
}

router.get('/nuvemshop/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return sendOAuthRelayResult(req, res, {
        ok: false,
        settings: 'error',
        reason: 'Parâmetros OAuth ausentes (code ou state).',
      });
    }

    console.log('[nuvemshop/callback] Recebido code, trocando por token...');

    const payload = verifyOAuthState(String(state));
    const saved = await finishNuvemshopOAuth(payload.clienteId, String(code), String(state));

    console.log('[nuvemshop/callback] Integração salva, loja', saved.store_id);

    return sendOAuthRelayResult(req, res, {
      ok: true,
      settings: 'connected',
      storeId: saved.store_id,
      storeName: saved.store_name,
    });
  } catch (err) {
    const friendly = formatOAuthCallbackError(err);
    console.error('[nuvemshop/callback] Erro:', err);
    return sendOAuthRelayResult(req, res, {
      ok: false,
      settings: 'error',
      reason: friendly,
    });
  }
});

router.post('/nuvemshop/complete-auth', requireAuth, async (req, res) => {
  try {
    const { code, state, callbackUrl } = req.body || {};
    const parsed = parseOAuthCallbackInput({ code, state, callbackUrl });
    const saved = await finishNuvemshopOAuth(
      req.userData.cliente_id,
      parsed.code,
      parsed.state,
    );
    res.json({ ok: true, connected: true, integration: saved });
  } catch (err) {
    console.error('[nuvemshop/complete-auth] Erro:', err);
    res.status(400).json({ error: formatOAuthCallbackError(err) });
  }
});

function sendTrayOAuthRelayResult(req, res, payload) {
  if (req.query?.relay === 'json') {
    const status = payload.ok ? 200 : 400;
    return res.status(status).json(payload);
  }
  if (payload.ok) {
    return res.redirect(`${FRONTEND_URL}/app?menu=Settings&settings=connected&marketplace=tray`);
  }
  return res.redirect(
    `${FRONTEND_URL}/app?menu=Settings&settings=error&reason=${encodeURIComponent(payload.reason || 'Erro OAuth Tray')}`,
  );
}

router.get('/tray/oauth-info', requireAuth, (_req, res) => {
  if (!isTrayIntegrationEnabled()) return trayIntegrationDisabledResponse(res);
  res.json({
    redirectUriBackend: getConfiguredTrayRedirectUri(),
    redirectUriFrontendRelay: getFrontendTrayOAuthRelayUri(),
    appConfigured: isTrayAppConfigured(),
    webhookUrl: getTrayWebhookPublicUrl(),
  });
});

router.post('/tray/auth-url', requireAuth, async (req, res) => {
  if (!isTrayIntegrationEnabled()) return trayIntegrationDisabledResponse(res);
  try {
    const nome = String(req.body?.nome || '').trim();
    const storeUrl = normalizeTrayStoreUrl(req.body?.storeUrl || req.body?.store_url);
    if (!nome) {
      return res.status(400).json({ error: 'Informe um nome para identificar a loja.' });
    }
    if (!storeUrl) {
      return res.status(400).json({ error: 'Informe a URL da loja Tray (ex.: https://sualoja.commercesuite.com.br).' });
    }

    const tabelaPrecoId = req.body?.tabelaPrecoId || req.body?.tabela_preco_id;
    const pontaEstoqueId = req.body?.pontaEstoqueId || req.body?.ponta_estoque_id;
    if (!tabelaPrecoId || !pontaEstoqueId) {
      return res.status(400).json({ error: 'Tabela de preço e ponto de estoque são obrigatórios.' });
    }

    await assertTabelaPrecoForTenant(req.userData.cliente_id, tabelaPrecoId);
    await assertPontaEstoqueForTenant(req.userData.cliente_id, pontaEstoqueId);

    const creds = requireTrayCredentials();
    const state = createOAuthState(req.userData.cliente_id, {
      nome,
      tabelaPrecoId,
      pontaEstoqueId,
      storeUrl,
      marketplace: 'tray',
    });
    const callbackWithState = `${creds.redirectUri}${creds.redirectUri.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`;
    const url = buildTrayAuthorizeUrl(storeUrl, creds.consumerKey, callbackWithState);
    res.json({ url, state, storeUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tray/callback', async (req, res) => {
  if (!isTrayIntegrationEnabled()) {
    return sendTrayOAuthRelayResult(req, res, {
      ok: false,
      settings: 'error',
      reason: 'Integração Tray temporariamente desabilitada.',
    });
  }
  try {
    const parsed = parseTrayOAuthCallbackInput({
      code: req.query.code,
      store: req.query.store,
      api_address: req.query.api_address,
      url: req.query.url,
    });
    const state = String(req.query.state || '');
    if (!state) {
      return sendTrayOAuthRelayResult(req, res, {
        ok: false,
        settings: 'error',
        reason: 'State OAuth ausente.',
      });
    }

    const payload = verifyOAuthState(state);
    const saved = await finishTrayOAuth(payload.clienteId, parsed, state);

    return sendTrayOAuthRelayResult(req, res, {
      ok: true,
      settings: 'connected',
      storeId: saved.store_id,
      storeName: saved.store_name,
    });
  } catch (err) {
    console.error('[tray/callback] Erro:', err);
    return sendTrayOAuthRelayResult(req, res, {
      ok: false,
      settings: 'error',
      reason: err.message || 'Erro OAuth Tray',
    });
  }
});

router.post('/tray/complete-auth', requireAuth, async (req, res) => {
  if (!isTrayIntegrationEnabled()) return trayIntegrationDisabledResponse(res);
  try {
    const { state, callbackUrl } = req.body || {};
    if (!state) {
      return res.status(400).json({ error: 'state é obrigatório.' });
    }
    const parsed = parseTrayOAuthCallbackInput({ callbackUrl });
    const saved = await finishTrayOAuth(req.userData.cliente_id, parsed, String(state));
    res.json({ ok: true, connected: true, integration: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/nuvemshop/disconnect', requireAuth, async (req, res) => {
  try {
    const integracaoId = readIntegracaoId(req.query) || readIntegracaoId(req.body);
    if (!integracaoId) {
      return res.status(400).json({ error: 'integracaoId é obrigatório' });
    }
    await disconnectIntegration(req.userData.cliente_id, integracaoId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pontas-estoque', requireAuth, async (req, res) => {
  try {
    const data = await listPontasEstoque(req.userData.cliente_id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nuvemshop/compare', requireAuth, syncLimiter, async (req, res) => {
  try {
    const integracaoId = readIntegracaoId(req.query);
    if (!integracaoId) {
      return res.status(400).json({ error: 'integracaoId é obrigatório' });
    }
    const data = await compareCatalog(req.userData.cliente_id, {
      integracaoId,
      usuarioId: req.userData.id,
    });
    res.json(data);
  } catch (err) {
    console.error('[compare]', err);
    const status = err.message?.includes('não encontrada') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

function normalizeImportRequests(body) {
  if (Array.isArray(body.imports) && body.imports.length > 0) {
    return body.imports.map((row) => ({
      externalProductId: String(row.externalProductId),
      externalVariantIds: Array.isArray(row.externalVariantIds)
        ? row.externalVariantIds.map(String)
        : undefined,
    }));
  }
  if (Array.isArray(body.externalProductIds) && body.externalProductIds.length > 0) {
    return body.externalProductIds.map((externalProductId) => ({
      externalProductId: String(externalProductId),
      externalVariantIds: undefined,
    }));
  }
  return null;
}

function normalizeExportRequests(body) {
  if (Array.isArray(body.exports) && body.exports.length > 0) {
    return body.exports.map((row) => ({
      produtoId: String(row.produtoId),
      variationIds: Array.isArray(row.variationIds)
        ? row.variationIds.map(String)
        : undefined,
    }));
  }
  if (Array.isArray(body.produtoIds) && body.produtoIds.length > 0) {
    return body.produtoIds.map((produtoId) => ({
      produtoId: String(produtoId),
      variationIds: undefined,
    }));
  }
  return null;
}

router.post('/nuvemshop/import', requireAuth, syncLimiter, async (req, res) => {
  try {
    const integracaoId = readIntegracaoId(req.body);
    if (!integracaoId) {
      return res.status(400).json({ error: 'integracaoId é obrigatório' });
    }
    const imports = normalizeImportRequests(req.body);
    if (!imports) {
      return res.status(400).json({ error: 'imports é obrigatório' });
    }
    const result = await importProducts(req.userData.cliente_id, imports, {
      usuarioId: req.userData.id,
      integracaoId,
    });
    res.json(result);
  } catch (err) {
    console.error('[import]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/nuvemshop/export', requireAuth, syncLimiter, async (req, res) => {
  try {
    const integracaoId = readIntegracaoId(req.body);
    if (!integracaoId) {
      return res.status(400).json({ error: 'integracaoId é obrigatório' });
    }
    const exports = normalizeExportRequests(req.body);
    if (!exports) {
      return res.status(400).json({ error: 'exports é obrigatório' });
    }
    const result = await exportProducts(req.userData.cliente_id, exports, {
      usuarioId: req.userData.id,
      integracaoId,
    });
    res.json(result);
  } catch (err) {
    console.error('[export]', err);
    const message = isMissingColumnError(err)
      ? `${err.message}. Execute database/produtos_ecommerce_fields_migration.sql no Supabase.`
      : err.message;
    res.status(500).json({ error: message });
  }
});

router.post('/nuvemshop/sync-stock', requireAuth, syncLimiter, async (req, res) => {
  try {
    const integracaoId = readIntegracaoId(req.body);
    if (!integracaoId) {
      return res.status(400).json({ error: 'integracaoId é obrigatório' });
    }
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items é obrigatório' });
    }
    const result = await syncStock(req.userData.cliente_id, items, {
      usuarioId: req.userData.id,
      integracaoId,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nuvemshop/sync-prices', requireAuth, syncLimiter, async (req, res) => {
  try {
    const integracaoId = readIntegracaoId(req.body);
    if (!integracaoId) {
      return res.status(400).json({ error: 'integracaoId é obrigatório' });
    }
    const produtoIds = Array.isArray(req.body?.produtoIds)
      ? req.body.produtoIds.map(String).filter(Boolean)
      : [];
    if (!produtoIds.length) {
      return res.status(400).json({ error: 'produtoIds é obrigatório' });
    }
    const result = await syncProductPrices(req.userData.cliente_id, {
      produtoIds,
      integracaoId,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nuvemshop/sync-skus', requireAuth, syncLimiter, async (req, res) => {
  try {
    const integracaoId = readIntegracaoId(req.body);
    if (!integracaoId) {
      return res.status(400).json({ error: 'integracaoId é obrigatório' });
    }
    const produtoIds = Array.isArray(req.body?.produtoIds)
      ? req.body.produtoIds.map(String).filter(Boolean)
      : [];
    if (!produtoIds.length) {
      return res.status(400).json({ error: 'produtoIds é obrigatório' });
    }
    const result = await syncProductSkus(req.userData.cliente_id, {
      produtoIds,
      integracaoId,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhooks/product-price-changed', syncLimiter, async (req, res) => {
  try {
    const secret = req.headers['x-marketplace-webhook-secret'];
    const expectedSecret = process.env.MARKETPLACE_WEBHOOK_SECRET?.trim();
    if (!expectedSecret || secret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const clienteId = String(req.body?.clienteId || req.body?.cliente_id || '').trim();
    const produtoId = String(req.body?.produtoId || req.body?.produto_id || '').trim();
    if (!clienteId || !produtoId) {
      return res.status(400).json({ error: 'clienteId e produtoId são obrigatórios' });
    }

    const integrations = await listIntegrations(clienteId);
    const results = [];
    for (const integration of integrations) {
      const result = await syncProductPrices(clienteId, {
        produtoIds: [produtoId],
        integracaoId: integration.id,
      });
      results.push({ integracaoId: integration.id, ...result });
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhooks/stock-changed', syncLimiter, async (req, res) => {
  try {
    const secret = req.headers['x-marketplace-webhook-secret'];
    const expectedSecret = process.env.MARKETPLACE_WEBHOOK_SECRET?.trim();
    if (!expectedSecret || secret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const clienteId = String(req.body?.clienteId || req.body?.cliente_id || '').trim();
    const variacaoId = String(req.body?.variacaoId || req.body?.variacao_id || '').trim();
    if (!clienteId || !variacaoId) {
      return res.status(400).json({ error: 'clienteId e variacaoId são obrigatórios' });
    }

    const result = await handleAzoupStockChangedWebhook(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhooks/nuvemshop', syncLimiter, async (req, res) => {
  try {
    const creds = requireNuvemshopCredentials();
    const hmacHeader = req.headers['x-linkedstore-hmac-sha256']
      || req.headers['http_x_linkedstore_hmac_sha256'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    if (!verifyNuvemshopWebhookHmac(rawBody, hmacHeader, creds.clientSecret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await handleNuvemshopWebhookEvent(req.body || {});
    res.status(200).json(result);
  } catch (err) {
    console.error('[webhook nuvemshop]', err.message);
    res.status(200).json({ error: err.message });
  }
});

router.post('/webhooks/nuvemshop/register', syncLimiter, async (req, res) => {
  try {
    const secret = req.headers['x-marketplace-webhook-secret'];
    const expectedSecret = process.env.MARKETPLACE_WEBHOOK_SECRET?.trim();
    if (!expectedSecret || secret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await registerAllNuvemshopWebhooks();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nuvemshop/sync-product-stock', requireAuth, syncLimiter, async (req, res) => {
  try {
    const produtoIds = Array.isArray(req.body?.produtoIds)
      ? req.body.produtoIds.map(String).filter(Boolean)
      : [];
    if (!produtoIds.length) {
      return res.status(400).json({ error: 'produtoIds é obrigatório' });
    }
    const result = await syncProductStockFromAzoup(req.userData.cliente_id, { produtoIds }, {
      usuarioId: req.userData.id,
      pontaEstoqueId: req.body?.pontaEstoqueId ? String(req.body.pontaEstoqueId) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/event-log', requireAuth, async (req, res) => {
  try {
    const result = await listIntegracaoEvents(req.userData.cliente_id, {
      categoria: req.query.categoria ? String(req.query.categoria) : undefined,
      nivel: req.query.nivel ? String(req.query.nivel) : undefined,
      integracaoId: req.query.integracaoId ? String(req.query.integracaoId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({
      ...result,
      filters: {
        categorias: EVENT_CATEGORIES,
        niveis: EVENT_LEVELS,
      },
      tableMissing: Boolean(result.tableMissing),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nuvemshop/order-import-config', requireAuth, async (req, res) => {
  try {
    const integrations = await listIntegrations(req.userData.cliente_id);
    const normalizeForMarketplace = (row) => (
      row.marketplace === 'tray'
        ? normalizeTrayImportStatusConfig(row.import_order_statuses)
        : normalizeNuvemshopImportStatusConfig(row.import_order_statuses)
    );

    res.json({
      ...getOrderImportStatusDefinitions('nuvemshop'),
      definitionsByMarketplace: {
        nuvemshop: getOrderImportStatusDefinitions('nuvemshop'),
        tray: getOrderImportStatusDefinitions('tray'),
      },
      integrations: integrations.map((row) => ({
        id: row.id,
        nome: row.nome,
        marketplace: row.marketplace,
        storeName: row.store_name,
        importOrderStatuses: normalizeForMarketplace(row),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nuvemshop/orders/:externalOrderId', requireAuth, syncLimiter, async (req, res) => {
  try {
    const detail = await getMarketplaceOrderDetail(
      req.userData.cliente_id,
      req.params.externalOrderId,
      { integracaoId: req.query.integracaoId ? String(req.query.integracaoId) : undefined },
    );
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nuvemshop/orders', requireAuth, syncLimiter, async (req, res) => {
  try {
    const autoSync = req.query.sync !== '0';
    if (!autoSync) {
      const orders = await listStoredOrders(req.userData.cliente_id);
      return res.json({ orders, summary: null });
    }
    const result = await syncAndListOrders(req.userData.cliente_id, {
      usuarioId: req.userData.id,
      integracaoId: readIntegracaoId(req.body) || readIntegracaoId(req.query),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nuvemshop/sync-orders', requireAuth, syncLimiter, async (req, res) => {
  try {
    const result = await syncAndListOrders(req.userData.cliente_id, {
      usuarioId: req.userData.id,
      integracaoId: readIntegracaoId(req.body) || readIntegracaoId(req.query),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhooks/tray', syncLimiter, async (req, res) => {
  if (!isTrayIntegrationEnabled()) {
    return res.status(200).json({ skipped: true, reason: 'tray_integration_disabled' });
  }
  try {
    const result = await handleTrayWebhookEvent(req.body || {});
    res.status(200).json(result);
  } catch (err) {
    console.error('[webhooks/tray]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
