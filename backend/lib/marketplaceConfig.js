const MARKETPLACE = 'nuvemshop';

export function getDefaultRedirectUri() {
  const backendUrl = process.env.BACKEND_URL
    || process.env.NUVEMSHOP_REDIRECT_URI?.replace(/\/api\/marketplace\/nuvemshop\/callback$/, '')
    || `http://localhost:${process.env.PORT || 3001}`;
  return `${backendUrl.replace(/\/$/, '')}/api/marketplace/nuvemshop/callback`;
}

export function getFrontendOAuthRelayUri() {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${frontend.replace(/\/$/, '')}/oauth/nuvemshop/callback`;
}

export function getConfiguredRedirectUri() {
  return process.env.NUVEMSHOP_REDIRECT_URI?.trim() || getDefaultRedirectUri();
}

export function getOAuthRedirectUriCandidates() {
  const candidates = [
    process.env.NUVEMSHOP_REDIRECT_URI?.trim(),
    getFrontendOAuthRelayUri(),
    getDefaultRedirectUri(),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

export function getEnvNuvemshopCredentials() {
  const redirectCandidates = getOAuthRedirectUriCandidates();
  return {
    clientId: process.env.NUVEMSHOP_CLIENT_ID?.trim() || '',
    clientSecret: process.env.NUVEMSHOP_CLIENT_SECRET?.trim() || '',
    redirectUri: redirectCandidates[0] || getDefaultRedirectUri(),
    redirectUriCandidates: redirectCandidates,
    userAgent: process.env.NUVEMSHOP_USER_AGENT?.trim() || 'AzoupEcommerce (contato@azoup.com.br)',
    apiVersion: process.env.NUVEMSHOP_API_VERSION?.trim() || '2025-03',
  };
}

export function isNuvemshopAppConfigured() {
  const creds = getEnvNuvemshopCredentials();
  return Boolean(creds.clientId && creds.clientSecret);
}

export function requireNuvemshopCredentials() {
  const creds = getEnvNuvemshopCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(
      'App Nuvemshop não configurado no servidor. '
      + 'Configure NUVEMSHOP_CLIENT_ID e NUVEMSHOP_CLIENT_SECRET no backend/.env.',
    );
  }
  return creds;
}

export { MARKETPLACE };
