import { useEffect, useState } from 'react';
import { fetchNuvemshopOrderDetail } from '../../services/marketplaceService';
import { toFriendlyErrorMessage } from '../../utils/helpers';
import {
  formatMarketplaceDateTime,
  formatMarketplaceDocument,
  formatMarketplaceMoney,
  labelMarketplaceOrderStatus,
  labelMarketplacePayment,
} from '../../utils/marketplaceOrderLabels';

export function SalesOrderDetail({ order, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!order?.externalOrderId) return;

    let cancelled = false;
    setLoading(true);
    setError('');

    fetchNuvemshopOrderDetail(order.externalOrderId, {
      integracaoId: order.integracaoId,
    })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(toFriendlyErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [order]);

  if (!order) return null;

  const items = detail?.venda?.items?.length
    ? detail.venda.items
    : (detail?.marketplaceItems || []).map((item) => ({
      nome: item.name,
      sku: item.sku,
      quantidade: item.quantity,
      valorUnitario: item.unitPrice,
      valorTotal: item.total,
    }));

  return (
    <div className="sales-order-detail-overlay" onClick={onClose} role="presentation">
      <div
        className="sales-order-detail-panel product-form-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-order-detail-title"
      >
        <div className="sales-order-detail-header">
          <div>
            <h2 id="sales-order-detail-title">
              Pedido #{detail?.externalOrderNumber || order.externalOrderNumber || order.externalOrderId}
            </h2>
            {detail?.storeName && (
              <p className="form-label-hint">{detail.storeName}</p>
            )}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            Fechar
          </button>
        </div>

        {loading && <div className="empty-state">Carregando detalhes...</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && detail && (
          <>
            <div className="sales-order-detail-grid">
              <div className="sales-order-detail-block form-section">
                <h3>Marketplace</h3>
                <dl className="sales-detail-list">
                  <div><dt>Data</dt><dd>{formatMarketplaceDateTime(detail.createdAt)}</dd></div>
                  <div><dt>Pagamento</dt><dd>{labelMarketplacePayment(detail.paymentStatus)}</dd></div>
                  <div><dt>Status pedido</dt><dd>{labelMarketplaceOrderStatus(detail.orderStatus)}</dd></div>
                  <div><dt>Total</dt><dd>{formatMarketplaceMoney(detail.total)}</dd></div>
                  {detail.shipping > 0 && (
                    <div><dt>Frete</dt><dd>{formatMarketplaceMoney(detail.shipping)}</dd></div>
                  )}
                </dl>
              </div>

              <div className="sales-order-detail-block form-section">
                <h3>Cliente</h3>
                <dl className="sales-detail-list">
                  <div><dt>Nome</dt><dd>{detail.customer?.name || '—'}</dd></div>
                  <div><dt>E-mail</dt><dd>{detail.customer?.email || '—'}</dd></div>
                  <div><dt>CPF/CNPJ</dt><dd>{formatMarketplaceDocument(detail.customer?.document)}</dd></div>
                  <div><dt>Telefone</dt><dd>{detail.customer?.phone || '—'}</dd></div>
                  {(detail.customer?.city || detail.customer?.state) && (
                    <div>
                      <dt>Cidade/UF</dt>
                      <dd>{[detail.customer.city, detail.customer.state].filter(Boolean).join(' / ')}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {detail.venda && (
                <div className="sales-order-detail-block form-section">
                  <h3>Pedido Aprovado no Azoup</h3>
                  <dl className="sales-detail-list">
                    <div><dt>Código</dt><dd>{detail.venda.codigoPedido || '—'}</dd></div>
                    <div><dt>Etapa</dt><dd>{detail.venda.etapa || detail.venda.tipo || 'Pedido Aprovado'}</dd></div>
                    <div><dt>Valor</dt><dd>{formatMarketplaceMoney(detail.venda.valorTotal)}</dd></div>
                    <div><dt>Importado em</dt><dd>{formatMarketplaceDateTime(detail.venda.createdAt)}</dd></div>
                    {detail.venda.cliente?.nome && (
                      <div><dt>Cliente cadastro</dt><dd>{detail.venda.cliente.nome}</dd></div>
                    )}
                    {detail.venda.cliente?.email && (
                      <div><dt>E-mail cadastro</dt><dd>{detail.venda.cliente.email}</dd></div>
                    )}
                    {detail.venda.cliente?.telefone && (
                      <div><dt>Telefone cadastro</dt><dd>{detail.venda.cliente.telefone}</dd></div>
                    )}
                  </dl>
                  {detail.venda.observacao && (
                    <p className="form-label-hint" style={{ marginTop: '0.75rem' }}>
                      {detail.venda.observacao}
                    </p>
                  )}
                </div>
              )}
            </div>

            {detail.errorMessage && (
              <div className="alert alert-error">{detail.errorMessage}</div>
            )}

            <div className="sales-order-detail-items form-section">
              <h3>Itens</h3>
              {items.length === 0 ? (
                <div className="empty-state">Nenhum item encontrado.</div>
              ) : (
                <div className="product-table-wrap">
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>SKU</th>
                        <th>Qtd</th>
                        <th>Unitário</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={item.id || `${item.sku}-${index}`}>
                          <td>
                            {item.nome}
                            {(item.cor || item.tamanho) && (
                              <div className="integration-meta">
                                {[item.cor, item.tamanho].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td>{item.sku || '—'}</td>
                          <td>{item.quantidade ?? '—'}</td>
                          <td>{formatMarketplaceMoney(item.valorUnitario)}</td>
                          <td>{formatMarketplaceMoney(item.valorTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
