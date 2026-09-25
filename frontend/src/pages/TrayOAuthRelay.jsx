import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');

export function TrayOAuthRelay() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('Conectando loja Tray...');

  useEffect(() => {
    const code = searchParams.get('code');
    const store = searchParams.get('store');
    const apiAddress = searchParams.get('api_address');
    const url = searchParams.get('url');
    const state = searchParams.get('state');

    if (!code || !apiAddress || !state) {
      setMessage('Parâmetros OAuth Tray incompletos. Tente conectar novamente em Configurações.');
      return;
    }

    const params = new URLSearchParams({
      relay: 'json',
      code,
      state,
    });
    if (store) params.set('store', store);
    if (apiAddress) params.set('api_address', apiAddress);
    if (url) params.set('url', url);

    const target = `${BACKEND_URL}/api/marketplace/tray/callback?${params.toString()}`;

    fetch(target)
      .then((res) => res.json())
      .then((payload) => {
        if (payload.ok) {
          navigate('/app?menu=Settings&settings=connected&marketplace=tray', { replace: true });
          return;
        }
        const reason = encodeURIComponent(payload.reason || 'Erro ao conectar Tray');
        navigate(`/app?menu=Settings&settings=error&reason=${reason}`, { replace: true });
      })
      .catch((err) => {
        setMessage(err.message || 'Falha ao concluir OAuth Tray.');
      });
  }, [navigate, searchParams]);

  return (
    <div className="oauth-relay-page">
      <p>{message}</p>
    </div>
  );
}
