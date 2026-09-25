const MARKETPLACE = 'tray';

/** Tray desligada por padrão. Ative com TRAY_INTEGRATION_ENABLED=true no backend/.env */
export function isTrayIntegrationEnabled() {
  const raw = String(process.env.TRAY_INTEGRATION_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function assertTrayIntegrationEnabled() {
  if (!isTrayIntegrationEnabled()) {
    throw new Error('Integração Tray temporariamente desabilitada.');
  }
}

export function normalizeTrayStoreUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

export function getDefaultTrayCallbackUri() {
  const backendUrl = process.env.BACKEND_URL
    || process.env.TRAY_REDIRECT_URI?.replace(/\/api\/marketplace\/tray\/callback$/, '')
    || `http://localhost:${process.env.PORT || 3001}`;
  return `${backendUrl.replace(/\/$/, '')}/api/marketplace/tray/callback`;
}

export function getFrontendTrayOAuthRelayUri() {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${frontend.replace(/\/$/, '')}/oauth/tray/callback`;
}

export function getConfiguredTrayRedirectUri() {
  return process.env.TRAY_REDIRECT_URI?.trim() || getFrontendTrayOAuthRelayUri();
}

export function getTrayOAuthRedirectUriCandidates() {
  const candidates = [
    process.env.TRAY_REDIRECT_URI?.trim(),
    getFrontendTrayOAuthRelayUri(),
    getDefaultTrayCallbackUri(),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

export function getEnvTrayCredentials() {
  const redirectCandidates = getTrayOAuthRedirectUriCandidates();
  return {
    consumerKey: process.env.TRAY_CONSUMER_KEY?.trim() || '',
    consumerSecret: process.env.TRAY_CONSUMER_SECRET?.trim() || '',
    redirectUri: redirectCandidates[0] || getDefaultTrayCallbackUri(),
    redirectUriCandidates: redirectCandidates,
  };
}

export function isTrayAppConfigured() {
  const creds = getEnvTrayCredentials();
  return Boolean(creds.consumerKey && creds.consumerSecret);
}

export function requireTrayCredentials() {
  const creds = getEnvTrayCredentials();
  if (!creds.consumerKey || !creds.consumerSecret) {
    throw new Error(
      'App Tray não configurado no servidor. '
      + 'Configure TRAY_CONSUMER_KEY e TRAY_CONSUMER_SECRET no backend/.env '
      + '(obtenha na Central do Parceiro Tray após cadastro do aplicativo).',
    );
  }
  return creds;
}

export { MARKETPLACE };
