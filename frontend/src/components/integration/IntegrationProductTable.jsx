import { IconChevronDown, IconChevronRight } from '../ui/Icons';
import {
  countSelectedInGroup,
  isGroupFullySelected,
  isGroupPartiallySelected,
} from '../../utils/integrationProductGroups';

export function IntegrationProductTable({
  groups,
  selectedVariationIds,
  expandedProductIds,
  onToggleProduct,
  onToggleVariation,
  onToggleExpand,
  emptyLabel = 'Nenhum item disponível.',
  variationColumnLabel = 'Variação',
  stockColumnLabel = 'Estoque',
  showStockColumn = true,
}) {
  if (!groups.length) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="product-table-wrap">
      <table className="product-table integration-product-table">
        <thead>
          <tr>
            <th style={{ width: 40 }} />
            <th style={{ width: 40 }} />
            <th>Produto</th>
            <th>{variationColumnLabel}</th>
            <th>SKU</th>
            {showStockColumn && <th>{stockColumnLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const expanded = expandedProductIds.has(group.productId);
            const fullySelected = isGroupFullySelected(group, selectedVariationIds);
            const partiallySelected = isGroupPartiallySelected(group, selectedVariationIds);
            const selectedCount = countSelectedInGroup(group, selectedVariationIds);
            const hasMultiple = group.variations.length > 1;

            return (
              <ProductGroupRows
                key={group.productId}
                group={group}
                expanded={expanded}
                fullySelected={fullySelected}
                partiallySelected={partiallySelected}
                selectedCount={selectedCount}
                hasMultiple={hasMultiple}
                selectedVariationIds={selectedVariationIds}
                onToggleProduct={onToggleProduct}
                onToggleVariation={onToggleVariation}
                onToggleExpand={onToggleExpand}
                showStockColumn={showStockColumn}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatStock(value) {
  if (value == null || value === '') return '—';
  return Number(value);
}

function ProductGroupRows({
  group,
  expanded,
  fullySelected,
  partiallySelected,
  selectedCount,
  hasMultiple,
  selectedVariationIds,
  onToggleProduct,
  onToggleVariation,
  onToggleExpand,
  showStockColumn,
}) {
  return (
    <>
      <tr
        className={`integration-product-row ${fullySelected ? 'product-table-row--selected' : ''}`}
        onClick={() => onToggleProduct(group)}
      >
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={fullySelected}
            ref={(el) => {
              if (el) el.indeterminate = partiallySelected;
            }}
            onChange={() => onToggleProduct(group)}
            aria-label={`Selecionar todas as variações de ${group.nome}`}
          />
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {hasMultiple ? (
            <button
              type="button"
              className="integration-expand-btn"
              aria-label={expanded ? 'Recolher variações' : 'Expandir variações'}
              aria-expanded={expanded}
              onClick={() => onToggleExpand(group.productId)}
            >
              {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </button>
          ) : (
            <span className="integration-expand-placeholder" />
          )}
        </td>
        <td>
          <strong>{group.nome}</strong>
          {hasMultiple && (
            <div className="integration-meta">
              {selectedCount > 0
                ? `${selectedCount} de ${group.variations.length} variações selecionadas`
                : `${group.variations.length} variações`}
            </div>
          )}
        </td>
        <td className="integration-meta">
          {hasMultiple ? '—' : group.variations[0]?.label || '—'}
        </td>
        <td>{group.sku || group.variations[0]?.sku || '—'}</td>
        {showStockColumn && (
          <td>
            {hasMultiple ? '—' : formatStock(group.variations[0]?.estoque)}
          </td>
        )}
      </tr>

      {expanded && hasMultiple && group.variations.map((variation) => (
        <tr
          key={variation.variationId}
          className={`integration-variation-row ${selectedVariationIds.has(variation.variationId) ? 'product-table-row--selected' : ''}`}
          onClick={() => onToggleVariation(variation.variationId)}
        >
          <td onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selectedVariationIds.has(variation.variationId)}
              onChange={() => onToggleVariation(variation.variationId)}
              aria-label={`Selecionar variação ${variation.label}`}
            />
          </td>
          <td />
          <td className="integration-meta integration-variation-indent">↳ {group.nome}</td>
          <td>{variation.label}</td>
          <td>{variation.sku || '—'}</td>
          {showStockColumn && <td>{formatStock(variation.estoque)}</td>}
        </tr>
      ))}
    </>
  );
}
