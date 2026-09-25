import { useCallback, useEffect, useState } from 'react';
import {
  disconnectNuvemshop,
  fetchNuvemshopAuthUrl,
  fetchNuvemshopStatus,
} from '../../services/marketplaceService';
import { toFriendlyErrorMessage } from '../../utils/helpers';

export function ConnectionPanel({ marketplace, oauthFlash, onConnectionChange }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(() => (
    oauthFlash?.settings === 'error' && oauthFlash.reason ? oauthFlash.reason : ''
  ));
  const [success, setSuccess] = useState('');

  const loadStatus = useCallback(async () => {
    if (marketplace !== 'nuvemshop') {
      setStatus(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchNuvemshopStatus();
      setStatus(data);
      onConnectionChange?.(data.connected);

      if (data.connected) {
        setSuccess('Loja Nuvemshop conectada com sucesso.');
        setError('');
      } else if (oauthFlash?.settings === 'connected') {
        setError(
          'A Nuvemshop autorizou o app, mas a conexão não foi salva. '
          + 'Confira o terminal do backend e tente conectar novamente.',
        );
      } else if (oauthFlash?.settings === 'error') {
        setError(
          oauthFlash.reason
          || 'Falha ao conectar a loja Nuvemshop. Verifique o terminal do backend e tente novamente.',
        );
      }
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
      onConnectionChange?.(false);
    } finally {
      setLoading(false);
    }
  }, [marketplace, onConnectionChange, oauthFlash?.settings, oauthFlash?.reason]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnect = async () => {
    setActionLoading(true);
    setError('');
    setSuccess('');
    try {
      const { url } = await fetchNuvemshopAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Desconectar a loja Nuvemshop?')) return;
    setActionLoading(true);
    setError('');
    setSuccess('');
    try {
      await disconnectNuvemshop();
      await loadStatus();
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (marketplace !== 'nuvemshop') {
    return (
      <div className="alert alert-info">
        Selecione Nuvemshop para configurar a integração.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty-state">
        {oauthFlash?.settings === 'connected' ? 'Finalizando conexão com a Nuvemshop…' : 'Verificando conexão...'}
      </div>
    );
  }

  const appReady = status?.appConfigured !== false;

  return (
    <div className="integration-connection-card">
      {error && <div className="alert alert-error">{error}</div>}
      {success && status?.connected && <div className="alert alert-success">{success}</div>}

      {!appReady && (
        <div className="alert alert-info">
          A integração com a Nuvemshop ainda não está disponível. Configure NUVEMSHOP_CLIENT_ID
          e NUVEMSHOP_CLIENT_SECRET no backend/.env e reinicie o servidor.
        </div>
      )}

      {status?.connected ? (
        <>
          <div className="integration-status integration-status--connected">
            <strong>Loja conectada</strong>
            <p>
              {status.integration?.store_name || 'Nuvemshop'}
              {status.integration?.store_id && (
                <span className="integration-meta"> · ID {status.integration.store_id}</span>
              )}
            </p>
            {status.integration?.connected_at && (
              <p className="integration-meta">
                Conectada em {new Date(status.integration.connected_at).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDisconnect}
            disabled={actionLoading}
          >
            {actionLoading ? 'Desconectando...' : 'Desconectar loja'}
          </button>
        </>
      ) : (
        <>
          <div className="integration-status integration-status--disconnected">
            <strong>Nenhuma loja conectada</strong>
            <p>
              Clique abaixo e faça login na Nuvemshop com a conta da sua loja para autorizar o Azoup.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={actionLoading || !appReady}
          >
            {actionLoading ? 'Redirecionando...' : 'Conectar minha loja Nuvemshop'}
          </button>
        </>
      )}
    </div>
  );
}
