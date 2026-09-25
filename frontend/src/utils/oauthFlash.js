const STORAGE_KEY = 'azoup_oauth_flash';

/** Grava feedback OAuth para sobreviver a redirects e limpeza da URL. */
export function storeOAuthFlash(flash) {
  if (!flash?.settings) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flash));
  } catch {
    /* ignore */
  }
}

/** Lê parâmetros OAuth da URL ou sessionStorage (uma única vez). */
export function captureOAuthFlash() {
  const params = new URLSearchParams(window.location.search);
  const settings = params.get('settings');
  const reason = params.get('reason');

  if (settings) {
    const flash = {
      settings,
      reason: reason ? decodeURIComponent(reason) : null,
    };
    storeOAuthFlash(flash);
    return flash;
  }

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      sessionStorage.removeItem(STORAGE_KEY);
      return JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }

  return { settings: null, reason: null };
}

export function clearOAuthQueryParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('menu') || params.has('settings') || params.has('integration') || params.has('reason') || params.has('marketplace')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}
