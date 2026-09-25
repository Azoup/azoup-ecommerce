import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchIntegracaoEventLog,
  fetchIntegrations,
} from '../../services/marketplaceService';
import { toFriendlyErrorMessage } from '../../utils/helpers';
import { formatMarketplaceDateTime } from '../../utils/marketplaceOrderLabels';
import { LojaFilter } from '../integration/LojaFilter';
import { FormPicker } from '../ui/FormComponents';

const LEVEL_BADGES = {
  info: 'badge-muted',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
};

function LevelBadge({ nivel, label }) {
  return (
    <span className={`sales-badge ${LEVEL_BADGES[nivel] || 'badge-muted'}`}>
      {label || nivel}
    </span>
  );
}

function EventDetail({ event }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(event.mensagem || event.payload || event.referenciaId);

  if (!hasDetail) return null;

  return (
    <div className="event-log-detail">
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Ocultar detalhes' : 'Ver detalhes'}
      </button>
      {open && (
        <div className="event-log-detail-body">
          {event.mensagem && <p>{event.mensagem}</p>}
          {event.referenciaId && (
            <p className="form-label-hint">
              Referência ({event.referenciaTipo || 'item'}): {event.referenciaId}
            </p>
          )}
          {event.payload && (
            <pre className="event-log-payload">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function EventLogView() {
  const [integrations, setIntegrations] = useState([]);
  const [filtersMeta, setFiltersMeta] = useState({ categorias: {}, niveis: {} });
  const [tableMissing, setTableMissing] = useState(false);
  const [categoria, setCategoria] = useState('');
  const [nivel, setNivel] = useState('');
  const [integracaoId, setIntegracaoId] = useState('');
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const integrationsData = await fetchIntegrations();
      setIntegrations(integrationsData.integrations || []);

      try {
        const logData = await fetchIntegracaoEventLog({
          categoria: categoria || undefined,
          nivel: nivel || undefined,
          integracaoId: integracaoId || undefined,
          limit: 200,
        });

        setEvents(logData.events || []);
        setTotal(logData.total || 0);
        setTableMissing(Boolean(logData.tableMissing));
        setFiltersMeta({
          categorias: logData.filters?.categorias || {},
          niveis: logData.filters?.niveis || {},
        });
      } catch (logErr) {
        setEvents([]);
        setTotal(0);
        setTableMissing(false);
        setError(toFriendlyErrorMessage(logErr));
      }
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [categoria, integracaoId, nivel]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const categoriaOptions = useMemo(
    () => Object.entries(filtersMeta.categorias || {}).map(([value, label]) => ({ value, label })),
    [filtersMeta.categorias],
  );

  const nivelOptions = useMemo(
    () => Object.entries(filtersMeta.niveis || {}).map(([value, label]) => ({ value, label })),
    [filtersMeta.niveis],
  );

  return (
    <div>
      <div className="page-header integration-page-header">
        <h1>Log do sistema</h1>
        <div className="integration-page-toolbar">
          <button type="button" className="btn btn-outline" disabled={loading} onClick={loadEvents}>
            {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      <p className="sales-sync-hint">
        Histórico de conexões, envio/puxada de produtos, estoque, pedidos, webhooks e erros
        da integração com e-commerce.
      </p>

      {tableMissing && (
        <div className="alert alert-info">
          A tabela de log ainda não existe no Supabase. Execute o script{' '}
          <code>database/integracao_event_log_migration.sql</code> e recarregue a página.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="integration-page-toolbar event-log-filters">
        <LojaFilter
          id="event-log-loja-filter"
          label="Loja"
          lojas={integrations}
          value={integracaoId}
          onChange={setIntegracaoId}
          allowAll
          allLabel="Todas as lojas"
          disabled={loading}
        />
        <FormPicker
          id="event-log-categoria"
          label="Categoria"
          fieldClassName="integration-loja-filter"
          value={categoria}
          onChange={(event) => setCategoria(event.target.value)}
          disabled={loading}
          placeholder="Todas"
          options={categoriaOptions}
        />
        <FormPicker
          id="event-log-nivel"
          label="Nível"
          fieldClassName="integration-loja-filter"
          value={nivel}
          onChange={(event) => setNivel(event.target.value)}
          disabled={loading}
          placeholder="Todos"
          options={nivelOptions}
        />
      </div>

      {loading ? (
        <div className="empty-state">Carregando log...</div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          Nenhum evento registrado ainda. Ações de integração aparecerão aqui automaticamente.
        </div>
      ) : (
        <>
          <p className="integration-meta event-log-count">
            Exibindo {events.length} de {total} evento(s)
          </p>
          <div className="product-table-wrap">
            <table className="product-table event-log-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Nível</th>
                  <th>Categoria</th>
                  <th>Evento</th>
                  <th>Loja</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatMarketplaceDateTime(event.createdAt)}</td>
                    <td>
                      <LevelBadge nivel={event.nivel} label={event.nivelLabel} />
                    </td>
                    <td>{event.categoriaLabel}</td>
                    <td>
                      <strong>{event.titulo}</strong>
                      <div className="integration-meta">{event.acao}</div>
                    </td>
                    <td>{event.lojaNome || '—'}</td>
                    <td>
                      <EventDetail event={event} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
