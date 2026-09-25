import { useEffect, useState } from 'react';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

function redirectToSettings(flash) {
  const qs = new URLSearchParams({ menu: 'Settings' });
  if (flash?.settings) qs.set('settings', flash.settings);
  if (flash?.reason) qs.set('reason', flash.reason);
  window.location.replace(`/app?${qs.toString()}`);
}

/**
 * Repassa code/state da Nuvemshop para o backend trocar o token OAuth.
 */
export function NuvemshopOAuthRelay() {
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Conectando sua loja Nuvemshop…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code || !state) {
      setError('Parâmetros OAuth ausentes. Tente conectar a loja novamente em Configurações.');
      return;
    }

    if (!BACKEND_URL) {
      setError('VITE_BACKEND_URL não configurado no frontend.');
      return;
    }

    const lockKey = `oauth_relay_lock_${code.slice(0, 24)}`;
    try {
      if (sessionStorage.getItem(lockKey)) return;
      sessionStorage.setItem(lockKey, String(Date.now()));
    } catch {
      /* ignore */
    }

    setStatus('Finalizando autorização no servidor…');

    const target = `${BACKEND_URL}/api/marketplace/nuvemshop/callback?relay=json&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

    fetch(target, { credentials: 'include', redirect: 'manual' })
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';

        if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
          throw new Error(
            'Backend retornou redirect em vez de JSON. Reinicie o backend (npm run dev na pasta backend).',
          );
        }

        if (!contentType.includes('application/json')) {
          const text = await res.text();
          throw new Error(
            text?.slice(0, 200)
            || `Backend indisponível (HTTP ${res.status}). Verifique se está rodando em ${BACKEND_URL}.`,
          );
        }

        const payload = await res.json();

        if (!payload?.settings) {
          throw new Error(payload?.reason || payload?.error || 'Falha ao finalizar OAuth.');
        }

        if (payload.settings === 'connected') {
          setStatus('Loja conectada! Redirecionando…');
        } else {
          setStatus('Redirecionando…');
        }

        redirectToSettings({
          settings: payload.settings,
          reason: payload.reason || null,
        });
      })
      .catch((err) => {
        setError(err.message || 'Não foi possível conectar ao backend.');
        try {
          sessionStorage.removeItem(lockKey);
        } catch {
          /* ignore */
        }
      });
  }, []);

  const boxStyle = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
    background: '#f0f4f8',
    fontFamily: 'system-ui, sans-serif',
  };

  const cardStyle = {
    width: '100%',
    maxWidth: 420,
    background: '#fff',
    borderRadius: 14,
    border: '1px solid #dde3ea',
    padding: '2rem',
    boxShadow: '0 8px 32px rgba(15, 15, 65, 0.08)',
    textAlign: 'center',
    color: '#1a1a2e',
  };

  if (error) {
    return (
      <div style={boxStyle}>
        <div style={cardStyle}>
          <div style={{ color: '#b91c1c', marginBottom: '1rem', lineHeight: 1.5 }}>{error}</div>
          <a
            href="/app?menu=Settings"
            style={{
              display: 'inline-block',
              marginTop: '0.5rem',
              padding: '0.6rem 1.2rem',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Voltar às Configurações
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>{status}</div>
        <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
          Aguarde, estamos finalizando a autorização no servidor.
        </p>
      </div>
    </div>
  );
}

export function hasOAuthCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get('code') && params.get('state'));
}
