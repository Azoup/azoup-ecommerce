import { FormPicker } from '../ui/FormComponents';
import { formatLojaLabel } from '../../services/marketplaceService';

export function LojaFilter({
  lojas,
  value,
  onChange,
  disabled = false,
  allowAll = false,
  allLabel = 'Todas as lojas',
  label = 'Loja',
  id = 'loja-filter',
}) {
  if (!lojas?.length) return null;

  const options = [
    ...(allowAll ? [{ value: '', label: allLabel }] : []),
    ...lojas.map((loja) => ({
      value: loja.id,
      label: formatLojaLabel(loja),
    })),
  ];

  return (
    <FormPicker
      id={id}
      label={label}
      fieldClassName="integration-loja-filter"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      options={options}
    />
  );
}
