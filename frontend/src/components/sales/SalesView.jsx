import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchIntegrations,
  fetchNuvemshopOrders,
  syncMarketplaceOrders,
} from '../../services/marketplaceService';
import { toFriendlyErrorMessage } from '../../utils/helpers';
import {
  formatMarketplaceDateTime,
  formatMarketplaceMoney,
  labelMarketplaceOrderStatus,
  labelMarketplacePayment,
  MARKETPLACE_SYNC_STATUS_LABELS,
} from '../../utils/marketplaceOrderLabels';
import { LojaFilter } from '../integration/LojaFilter';
import { SalesOrderDetail } from './SalesOrderDetail';
import { SalesImportSettings } from './SalesImportSettings';

const SALES_VIEW_FILTER_KEY = 'azoup_sales_view_integracao_filter';

function StatusBadge({ status }) {
  const info = MARKETPLACE_SYNC_STATUS_LABELS[status]
    || { label: status || '—', className: 'badge-muted' };
  return <span className={`sales-badge ${info.className}`}>{info.label}</span>;
}

export function SalesView({ onOpenSettings }) {
  const [connected, setConnected] = useState(false);
  const [integrations, setIntegrations] = useState([]);
  const [viewIntegracaoId, setViewIntegracaoId] = useState(
    () => localStorage.getItem(SALES_VIEW_FILTER_KEY) || '',
  );
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showImportSettings, setShowImportSettings] = useState(false);

  const loadOrders = useCallback(async (options = {}) => {
    setLoading(true);
    setError('');
    if (!options.silent) setMessage('');

    try {
      const status = await fetchIntegrations();
      const lojas = status.integrations || [];
      const isConnected = lojas.length > 0;
      setConnected(isConnected);
      setIntegrations(lojas);

      if (!isConnected) {
        setOrders([]);
        setSummary(null);
        return;
      }

      const syncOptions = viewIntegracaoId ? { integracaoId: viewIntegracaoId } : {};
      const data = options.forceSync
        ? await syncMarketplaceOrders(syncOptions)
        : await fetchNuvemshopOrders({ sync: true, ...syncOptions });

      setOrders(data.orders || []);
      setSummary(data.summary || null);

      if (data.summary?.imported > 0) {
        setMessage(
          `${data.summary.imported} pedido(s) importado(s) como Pedido Aprovado no Azoup.`,
        );
      }
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [viewIntegracaoId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (viewIntegracaoId) {
      localStorage.setItem(SALES_VIEW_FILTER_KEY, viewIntegracaoId);
    } else {
      localStorage.removeItem(SALES_VIEW_FILTER_KEY);
    }
  }, [viewIntegracaoId]);

  const filteredOrders = useMemo(() => {
    if (!viewIntegracaoId) return orders;
    return orders.filter((order) => order.integracaoId === viewIntegracaoId);
  }, [orders, viewIntegracaoId]);

  return (
    <div>
      <div className="page-header integration-page-header">
        <h1>Vendas E-commerce</h1>
        {connected && (
          <div className="integration-page-toolbar">
            <LojaFilter
              id="sales-view-loja-filter"
              label="Filtrar por loja"
              lojas={integrations}
              value={viewIntegracaoId}
              onChange={setViewIntegracaoId}
              disabled={loading}
              allowAll
            />
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowImportSettings(true)}
            >
              Regras de importação
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={loading}
              onClick={() => loadOrders({ forceSync: true })}
            >
              {loading ? 'Sincronizando...' : 'Sincronizar pedidos'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      {!loading && !connected && (
        <div className="alert alert-info integration-settings-prompt">
          <div>
            <strong>Nenhuma loja conectada</strong>
            <p style={{ margin: '0.35rem 0 0' }}>
              Conecte a Nuvemshop em Configurações para importar vendas automaticamente.
            </p>
          </div>
          {onOpenSettings && (
            <button type="button" className="btn btn-primary" onClick={onOpenSettings}>
              Ir para Configurações
            </button>
          )}
        </div>
      )}

      {connected && (
        <p className="sales-sync-hint">
          Pedidos da Nuvemshop que atenderem às regras configuradas viram{' '}
          <strong>Pedido Aprovado</strong> no Azoup automaticamente.
          O cliente é vinculado por CPF/CNPJ (ou cadastrado se não existir).
          <span className="integration-meta">
            {' '}A sincronização considera todas as lojas; o filtro acima afeta só a visualização.
          </span>
          {summary && (
            <span className="integration-meta">
              {' '}Última sync: {summary.imported} novo(s), {summary.skipped} já importado(s)
              {summary.waiting > 0 ? `, ${summary.waiting} aguardando regra` : ''}
              {summary.errors > 0 ? `, ${summary.errors} erro(s)` : ''}.
            </span>
          )}
        </p>
      )}

      {loading ? (
        <div className="empty-state">Carregando vendas...</div>
      ) : connected && filteredOrders.length === 0 ? (
        <div className="empty-state">
          {orders.length === 0
            ? 'Nenhum pedido encontrado na Nuvemshop.'
            : 'Nenhum pedido para a loja selecionada.'}
        </div>
      ) : connected ? (
        <div className="product-table-wrap">
          <table className="product-table sales-orders-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Total</th>
                <th>Pagamento</th>
                <th>Azoup</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={`${order.integracaoId || 'loja'}-${order.externalOrderId}`}
                  className="sales-order-row"
                  onClick={() => setSelectedOrder(order)}
                >
                  <td>
                    <strong>#{order.externalOrderNumber || order.externalOrderId}</strong>
                    {order.storeName && (
                      <div className="integration-meta">{order.storeName}</div>
                    )}
                  </td>
                  <td>
                    <div>{order.customerName}</div>
                    {order.customerEmail && (
                      <div className="integration-meta">{order.customerEmail}</div>
                    )}
                  </td>
                  <td>{formatMarketplaceDateTime(order.createdAt)}</td>
                  <td>{formatMarketplaceMoney(order.total)}</td>
                  <td>
                    <div>{labelMarketplacePayment(order.paymentStatus)}</div>
                    {order.orderStatus && (
                      <div className="integration-meta">
                        {labelMarketplaceOrderStatus(order.orderStatus)}
                      </div>
                    )}
                  </td>
                  <td>
                    {order.vendaId ? (
                      <span className="integration-meta">
                        {order.codigoPedido || `Venda #${order.vendaId}`}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <StatusBadge status={order.syncStatus} />
                    {order.errorMessage && (
                      <div className="integration-meta sales-error-hint">{order.errorMessage}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selectedOrder && (
        <SalesOrderDetail
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}

      {showImportSettings && (
        <SalesImportSettings
          onClose={() => setShowImportSettings(false)}
          onSaved={() => loadOrders({ forceSync: true, silent: true })}
        />
      )}
    </div>
  );
}
