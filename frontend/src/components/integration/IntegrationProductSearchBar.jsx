import { IconSearch } from '../ui/Icons';

export function IntegrationProductSearchBar({
  value,
  onChange,
  productCount,
  variationCount,
}) {
  return (
    <div className="integration-search-toolbar">
      <div className="consulta-search integration-search">
        <IconSearch size={18} className="consulta-search-icon" />
        <input
          type="search"
          className="form-input consulta-search-input"
          placeholder="Pesquisar por nome ou SKU..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <span className="integration-search-count">
        {productCount} produto{productCount === 1 ? '' : 's'} · {variationCount} variação
        {variationCount === 1 ? '' : 'ões'}
      </span>
    </div>
  );
}
