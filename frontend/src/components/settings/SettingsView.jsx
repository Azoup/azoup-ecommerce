import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { LojasVinculadasPanel } from './LojasVinculadasPanel';
import { toFriendlyErrorMessage } from '../../utils/helpers';

export function SettingsView({ oauthFlash }) {
  const { userData } = useAuth();
  const [clienteInfo, setClienteInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userData?.cliente_id) return;

    supabase
      .from('clientes_azoup')
      .select('id, nome, email')
      .eq('id', userData.cliente_id)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(toFriendlyErrorMessage(fetchError));
          return;
        }
        setClienteInfo(data);
      });
  }, [userData?.cliente_id]);

  return (
    <div>
      <div className="page-header">
        <h1>Configurações</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="product-form-card settings-card">
        <section className="settings-section">
          <h2 className="settings-section-title">Conta Azoup</h2>
          <div className="settings-tenant-card">
            <div>
              <strong>{clienteInfo?.nome || userData?.nome || 'Cliente'}</strong>
              <p className="integration-meta">
                {clienteInfo?.email || userData?.usuario || userData?.email || '—'}
              </p>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Lojas vinculadas</h2>
          <LojasVinculadasPanel
            oauthFlash={oauthFlash}
            onConnectionChange={setConnected}
          />
        </section>

        {connected && (
          <div className="alert alert-success settings-connected-hint">
            Loja(s) conectada(s). Em <strong>Produtos</strong>, selecione a loja no filtro para sincronizar.
          </div>
        )}
      </div>
    </div>
  );
}
