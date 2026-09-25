import { useMemo, useState } from 'react';
import { importNuvemshopProducts } from '../../services/marketplaceService';
import { IntegrationProductSearchBar } from './IntegrationProductSearchBar';
import { IntegrationProductTable } from './IntegrationProductTable';
import {
  areAllGroupsSelected,
  buildImportPayload,
  buildImportProductGroups,
  collectVariationIdsFromGroups,
  filterProductGroups,
  isGroupFullySelected,
} from '../../utils/integrationProductGroups';
import { toFriendlyErrorMessage } from '../../utils/helpers';

export function ImportPanel({ items, connected, integracaoId, onDone }) {
  const [search, setSearch] = useState('');
  const [selectedVariationIds, setSelectedVariationIds] = useState(() => new Set());
  const [expandedProductIds, setExpandedProductIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const productGroups = useMemo(() => buildImportProductGroups(items), [items]);
  const filteredGroups = useMemo(
    () => filterProductGroups(productGroups, search),
    [productGroups, search],
  );

  const filteredVariationCount = useMemo(
    () => filteredGroups.reduce((sum, group) => sum + group.variations.length, 0),
    [filteredGroups],
  );

  const filteredVariationIds = useMemo(
    () => collectVariationIdsFromGroups(filteredGroups),
    [filteredGroups],
  );

  const allFilteredSelected = areAllGroupsSelected(filteredGroups, selectedVariationIds);

  const toggleProduct = (group) => {
    const ids = group.variations.map((v) => v.variationId);
    const selectAll = !isGroupFullySelected(group, selectedVariationIds);
    setSelectedVariationIds((prev) => {
      const next = new Set(prev);
      if (selectAll) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const toggleVariation = (variationId) => {
    setSelectedVariationIds((prev) => {
      const next = new Set(prev);
      if (next.has(variationId)) next.delete(variationId);
      else next.add(variationId);
      return next;
    });
  };

  const toggleExpand = (productId) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedVariationIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredVariationIds.forEach((id) => next.delete(id));
      } else {
        filteredVariationIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedVariationIds.size === 0) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const imports = buildImportPayload(productGroups, selectedVariationIds);
      const result = await importNuvemshopProducts(imports, integracaoId);
      const variationCount = imports.reduce((sum, row) => sum + row.externalVariantIds.length, 0);
      setMessage(
        `${variationCount} variação(ões) puxada(s) do e-commerce em ${result.count} produto(s) no Azoup. Revise dados fiscais no cadastro.`,
      );
      setSelectedVariationIds(new Set());
      setExpandedProductIds(new Set());
      setSearch('');
      onDone?.();
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return <div className="alert alert-info">Conecte a Nuvemshop em Configurações para puxar produtos do e-commerce.</div>;
  }

  if (productGroups.length === 0) {
    return <div className="empty-state">Nenhum produto exclusivo do e-commerce para puxar.</div>;
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <p className="integration-panel-hint">
        Clique no produto para puxar todas as variações do e-commerce. Use a seta à direita para
        expandir e puxar variações individuais. Novas variações do mesmo produto são vinculadas ao
        mesmo cadastro no Azoup. O estoque da loja é importado para o Azoup na vinculação. Depois,
        entradas e saídas ficam sincronizadas entre os dois lados automaticamente.
      </p>

      <IntegrationProductSearchBar
        value={search}
        onChange={setSearch}
        productCount={filteredGroups.length}
        variationCount={filteredVariationCount}
      />

      <div className="integration-actions-bar">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={allFilteredSelected && filteredVariationCount > 0}
            onChange={toggleAll}
          />
          <span>
            Selecionar todos visíveis ({filteredGroups.length} produtos · {filteredVariationCount}{' '}
            variações)
          </span>
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || selectedVariationIds.size === 0}
          onClick={handleImport}
        >
          {loading ? 'Puxando...' : `Puxar selecionados (${selectedVariationIds.size})`}
        </button>
      </div>

      <IntegrationProductTable
        groups={filteredGroups}
        selectedVariationIds={selectedVariationIds}
        expandedProductIds={expandedProductIds}
        onToggleProduct={toggleProduct}
        onToggleVariation={toggleVariation}
        onToggleExpand={toggleExpand}
        stockColumnLabel="Estoque Nuvemshop"
        emptyLabel={
          search
            ? 'Nenhum produto encontrado para essa pesquisa.'
            : 'Nenhum produto exclusivo do e-commerce para puxar.'
        }
      />
    </div>
  );
}
