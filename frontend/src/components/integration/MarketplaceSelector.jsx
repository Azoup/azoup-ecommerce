import { FormPicker } from '../ui/FormComponents';

export function MarketplaceSelector({ providers, value, onChange, disabled, fieldClassName }) {
  return (
    <FormPicker
      label="Marketplace"
      fieldClassName={fieldClassName}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      options={providers.map((p) => ({
        value: p.id,
        label: p.enabled ? p.label : `${p.label} (em breve)`,
        disabled: !p.enabled,
      }))}
    />
  );
}
