import { useEffect, useMemo, useState } from 'react';
import { IconChevronDown, IconChevronRight } from '../ui/Icons';
import {
  buildCompareProductGroups,
  resolveCompareGroupStatus,
} from '../../utils/integrationProductGroups';
import {
  syncNuvemshopPrices,
  syncNuvemshopSkus,
} from '../../services/marketplaceService';

const STATUS_LABELS = {
  linked: { label: 'Vinculado', className: 'badge-active' },
  conflict: { label: 'Conflito', className: 'badge-conflict' },
  only_azoup: { label: 'Só Azoup', className: 'badge-azoup' },
  only_nuvemshop: { label: 'Só e-commerce', className: 'badge-nuvem' },
  only_external: { label: 'Só e-commerce', className: 'badge-nuvem' },
};

function getEcommerceItem(item) {
  return item?.external ?? item?.nuvemshop ?? null;
}

function StatusBadge({ status }) {
  const cfg = STATUS_LABELS[status] || { label: status, className: 'badge-inactive' };
  return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
}

function formatGroupStatusSummary(counts) {
  return Object.entries(counts)
    .map(([status, count]) => {
      const label = STATUS_LABELS[status]?.label || status;
      return `${count} ${label.toLowerCase()}${count === 1 ? '' : 's'}`;
    })
    .join(' · ');
}

function parseCompareDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLastUpdated(value) {
  const date = parseCompareDate(value);
  return date ? date.toLocaleString('pt-BR') : '—';
}

function resolveGroupLastUpdated(variations) {
  const dates = variations
    .map((variation) => parseCompareDate(variation.item?.last_updated_at))
    .filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

const CONFLICT_REASON_LABELS = {
  estoque: 'Estoque',
  sku: 'SKU',
  preco: 'Preço',
};

function formatConflictReasons(reasons) {
  if (!reasons?.length) return null;
  return reasons
    .map((reason) => CONFLICT_REASON_LABELS[reason] || reason)
    .join(' · ');
}

function CompareStatusCell({ item }) {
  return (
    <div className="compare-status-cell">
      <StatusBadge status={item.status} />
      {item.status === 'conflict' && item.conflict_reasons?.length > 0 && (
        <div className="integration-meta compare-conflict-reasons">
          {formatConflictReasons(item.conflict_reasons)}
        </div>
      )}
    </div>
  );
}

function CompareConflictActions({
  item,
  resolvingKey,
  onResolve,
  compact = false,
}) {
  if (item.status !== 'conflict' || !item.map_id) return null;

  const reasons = item.conflict_reasons || [];
  const rowKey = String(item.map_id);

  return (
    <div className={`compare-resolve-actions${compact ? ' compare-resolve-actions--compact' : ''}`}>
      {reasons.includes('preco') && (
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={!!resolvingKey}
          title="Envia o preço do Azoup para a Nuvemshop"
          onClick={(e) => {
            e.stopPropagation();
            onResolve('preco', item, rowKey);
          }}
        >
          {resolvingKey === `${rowKey}:preco` ? '...' : 'Preço → Loja'}
        </button>
      )}
      {reasons.includes('sku') && (
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={!!resolvingKey}
          title="Envia o SKU do Azoup para a Nuvemshop"
          onClick={(e) => {
            e.stopPropagation();
            onResolve('sku', item, rowKey);
          }}
        >
          {resolvingKey === `${rowKey}:sku` ? '...' : 'SKU → Loja'}
        </button>
      )}
    </div>
  );
}

function CompareActionsHint({ item }) {
  if (!item?.status) return null;

  if (item.status === 'only_azoup') {
    return <span className="integration-meta">Enviar na aba &quot;Enviar para e-commerce&quot;</span>;
  }
  if (item.status === 'only_nuvemshop' || item.status === 'only_external') {
    return <span className="integration-meta">Puxar na aba &quot;Puxar do e-commerce&quot;</span>;
  }
  if (item.status === 'linked') {
    return <span className="integration-meta">—</span>;
  }
  if (item.status === 'conflict') {
    return <span className="integration-meta">Expanda a linha ↓</span>;
  }
  return null;
}

function CompareGroupActions({
  group,
  expanded,
  resolvingKey,
  onResolve,
}) {
  const conflictVariations = group.variations.filter(
    (v) => v.item?.status === 'conflict' && v.item?.map_id,
  );

  if (!conflictVariations.length) {
    const status = group.variations[0]?.item?.status;
    return <CompareActionsHint item={{ status }} />;
  }

  if (!expanded && conflictVariations.length === 1) {
    const reasons = conflictVariations[0].item?.conflict_reasons || [];
    if (reasons.length === 1 && reasons[0] === 'estoque') {
      return <span className="integration-meta">Conflito de estoque · alinha ao atualizar</span>;
    }
    return (
      <CompareConflictActions
        item={conflictVariations[0].item}
        resolvingKey={resolvingKey}
        onResolve={onResolve}
        compact
      />
    );
  }

  if (!expanded) {
    const hasOnlyStock = conflictVariations.every(
      (v) => (v.item?.conflict_reasons || []).length === 1
        && v.item.conflict_reasons[0] === 'estoque',
    );
    if (hasOnlyStock) {
      return <span className="integration-meta">Conflito de estoque · alinha ao atualizar</span>;
    }
    return <span className="integration-meta">Expanda para ver ações</span>;
  }

  return null;
}

function CompareVariationRow({
  variation,
  resolvingKey,
  onResolve,
}) {
  const { item } = variation;
  const ecommerce = getEcommerceItem(item);

  return (
    <tr className="integration-variation-row compare-variation-row">
      <td />
      <td><CompareStatusCell item={item} /></td>
      <td className="integration-variation-indent">{variation.label}</td>
      <td>{item.azoup?.sku || '—'}</td>
      <td>{item.azoup?.estoque ?? '—'}</td>
      <td>
        {item.azoup?.preco != null
          ? `R$ ${Number(item.azoup.preco).toFixed(2)}`
          : '—'}
      </td>
      <td>{ecommerce?.nome || '—'}</td>
      <td>{ecommerce?.sku || '—'}</td>
      <td>{ecommerce?.estoque ?? '—'}</td>
      <td>
        {ecommerce?.price != null
          ? `R$ ${Number(ecommerce.price).toFixed(2)}`
          : '—'}
      </td>
      <td className="integration-meta compare-last-updated">
        {formatLastUpdated(item.last_updated_at)}
      </td>
      <td>
        <CompareConflictActions
          item={item}
          resolvingKey={resolvingKey}
          onResolve={onResolve}
        />
      </td>
    </tr>
  );
}

function resolveGroupConflictReasons(variations) {
  const reasons = new Set();
  for (const variation of variations) {
    for (const reason of variation.item?.conflict_reasons || []) {
      reasons.add(reason);
    }
  }
  return [...reasons];
}

function CompareProductGroupRows({
  group,
  expanded,
  onToggleExpand,
  resolvingKey,
  onResolve,
  onBulkStockPull,
}) {
  const groupStatus = resolveCompareGroupStatus(group.variations);
  const hasMultiple = group.variations.length > 1;
  const groupLastUpdated = resolveGroupLastUpdated(group.variations);
  const groupConflictReasons = resolveGroupConflictReasons(group.variations);

  return (
    <>
      <tr
        className="integration-product-row compare-product-row"
        onClick={() => onToggleExpand(group.productId)}
      >
        <td onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="integration-expand-btn"
            aria-label={expanded ? 'Recolher variações' : 'Expandir variações'}
            aria-expanded={expanded}
            onClick={() => onToggleExpand(group.productId)}
          >
            {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </button>
        </td>
        <td>
          {groupStatus?.type === 'uniform' ? (
            <CompareStatusCell item={{
              status: groupStatus.status,
              conflict_reasons: groupStatus.status === 'conflict' ? groupConflictReasons : [],
            }} />
          ) : groupStatus?.type === 'mixed' ? (
            <span className="integration-meta compare-group-status-mixed">
              {formatGroupStatusSummary(groupStatus.counts)}
            </span>
          ) : (
            <span className="integration-meta">—</span>
          )}
        </td>
        <td>
          <strong>{group.nome}</strong>
          <div className="integration-meta">
            {group.variations.length} variação{group.variations.length === 1 ? '' : 'ões'}
            {!hasMultiple && group.variations[0] && (
              <> · {group.variations[0].label}</>
            )}
          </div>
        </td>
        <td colSpan={7} className="integration-meta compare-group-hint">
          {expanded ? 'Clique para recolher' : 'Clique para ver variações e detalhes'}
        </td>
        <td className="integration-meta compare-last-updated">
          {formatLastUpdated(groupLastUpdated)}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <CompareGroupActions
            group={group}
            expanded={expanded}
            resolvingKey={resolvingKey}
            onResolve={onResolve}
          />
        </td>
      </tr>

      {expanded && group.variations.map((variation) => (
        <CompareVariationRow
          key={variation.variationKey}
          variation={variation}
          resolvingKey={resolvingKey}
          onResolve={onResolve}
        />
      ))}
    </>
  );
}

export function ComparePanel({
  items,
  summary,
  loading,
  integracaoId,
  stockAutoResolve,
  onRefresh,
}) {
  const [expandedProductIds, setExpandedProductIds] = useState(() => new Set());
  const [resolvingKey, setResolvingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const groups = useMemo(() => buildCompareProductGroups(items), [items]);

  useEffect(() => {
    const conflictProductIds = new Set();
    for (const group of groups) {
      if (group.variations.some((v) => v.item?.status === 'conflict')) {
        conflictProductIds.add(group.productId);
      }
    }
    if (conflictProductIds.size > 0) {
      setExpandedProductIds((prev) => new Set([...prev, ...conflictProductIds]));
    }
  }, [groups]);

  const toggleExpand = (productId) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const handleResolve = async (action, item, rowKey) => {
    if (!integracaoId) {
      setError('Selecione uma loja em Configurações.');
      return;
    }

    setResolvingKey(`${rowKey}:${action}`);
    setError('');
    setMessage('');

    try {
      if (action === 'preco') {
        await syncNuvemshopPrices([item.produto_id], { integracaoId });
      } else if (action === 'sku') {
        await syncNuvemshopSkus([item.produto_id], { integracaoId });
      }

      setMessage('Conflito alinhado. Atualizando comparação...');
      await onRefresh?.();
      setMessage('Conflito resolvido.');
    } catch (err) {
      setError(err.message || 'Falha ao alinhar conflito.');
    } finally {
      setResolvingKey('');
    }
  };

  if (loading) {
    return <div className="empty-state">Comparando catálogos...</div>;
  }

  if (!items?.length) {
    return (
      <div className="empty-state">
        Nenhum dado para comparar. Conecte a Nuvemshop em Configurações e clique em Atualizar.
        {onRefresh && (
          <div style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-outline" onClick={onRefresh}>Atualizar</button>
          </div>
        )}
      </div>
    );
  }

  const stockAutoResolvedCount = stockAutoResolve?.resolved ?? 0;
  const stockAutoFailedCount = Math.max(
    0,
    (stockAutoResolve?.attempted ?? 0) - stockAutoResolvedCount,
  );
  const stockAutoFailures = (stockAutoResolve?.results || []).filter((row) => !row.success);

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      {stockAutoResolvedCount > 0 && (
        <div className="alert alert-success">
          {stockAutoResolvedCount} conflito(s) de estoque alinhado(s) automaticamente com o Azoup.
        </div>
      )}
      {stockAutoFailedCount > 0 && (
        <div className="alert alert-error">
          {stockAutoFailedCount} variação(ões) não puderam ter o estoque atualizado na Nuvemshop.
          {stockAutoFailures[0]?.error ? ` Detalhe: ${stockAutoFailures[0].error}` : ''}
        </div>
      )}
      {stockAutoResolve?.error && (
        <div className="alert alert-error">
          Falha ao alinhar estoque: {stockAutoResolve.error}
        </div>
      )}

      {summary && (
        <div className="integration-summary">
          <span>Total: {summary.total}</span>
          <span>Vinculados: {summary.linked}</span>
          <span>Conflitos: {summary.conflict}</span>
          <span>Só Azoup: {summary.only_azoup}</span>
          <span>Só e-commerce: {summary.only_external ?? summary.only_nuvemshop}</span>
          <span>Estoque diferente: {summary.stock_diff}</span>
          <span>Preço diferente: {summary.price_diff ?? 0}</span>
        </div>
      )}

      <div className="product-table-wrap">
        <table className="product-table integration-table integration-product-table">
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th>Status</th>
              <th>Produto / Variação</th>
              <th>SKU Azoup</th>
              <th>Estoque Azoup</th>
              <th>Preço Azoup</th>
              <th>Produto Nuvemshop</th>
              <th>SKU Nuvemshop</th>
              <th>Estoque Nuvemshop</th>
              <th>Preço Nuvem</th>
              <th>Última atualização</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <CompareProductGroupRows
                key={group.productId}
                group={group}
                expanded={expandedProductIds.has(group.productId)}
                onToggleExpand={toggleExpand}
                resolvingKey={resolvingKey}
                onResolve={handleResolve}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { StatusBadge, STATUS_LABELS };
