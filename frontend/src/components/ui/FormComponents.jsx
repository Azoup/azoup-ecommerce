import { useState } from 'react';

export function FormLabel({ children, required, hint }) {
  return (
    <label className="form-label">
      {children}
      {required && <span className="form-required"> *</span>}
      {hint && <span className="form-label-hint">{hint}</span>}
    </label>
  );
}

export function FormLabelRow({ label, required, hint, action }) {
  if (!label && !action) return null;
  return (
    <div className="form-label-row">
      {label ? <FormLabel required={required} hint={hint}>{label}</FormLabel> : <span />}
      {action}
    </div>
  );
}

export function FormField({
  label,
  required,
  hint,
  labelAction,
  children,
  error,
  fieldClassName = '',
}) {
  return (
    <div className={['form-field', fieldClassName].filter(Boolean).join(' ')}>
      {label && (
        labelAction
          ? <FormLabelRow label={label} required={required} hint={hint} action={labelAction} />
          : <FormLabel required={required} hint={hint}>{label}</FormLabel>
      )}
      {children}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

export function FormInput({
  label,
  required,
  hint,
  labelAction,
  error,
  className = '',
  fieldClassName = '',
  ...props
}) {
  return (
    <FormField
      label={label}
      required={required}
      hint={hint}
      labelAction={labelAction}
      error={error}
      fieldClassName={fieldClassName}
    >
      <input className={`form-input ${className}`} {...props} />
    </FormField>
  );
}

export function FormPasswordInput({
  label,
  required,
  error,
  className = '',
  fieldClassName = '',
  ...props
}) {
  const [visible, setVisible] = useState(false);

  return (
    <FormField label={label} required={required} error={error} fieldClassName={fieldClassName}>
      <div className="form-password-wrap">
        <input
          className={`form-input ${className}`}
          type={visible ? 'text' : 'password'}
          {...props}
        />
        <button
          type="button"
          className="form-password-toggle"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </FormField>
  );
}

export function FormPicker({
  label,
  required,
  hint,
  labelAction,
  error,
  options = [],
  placeholder,
  className = '',
  fieldClassName = '',
  ...props
}) {
  return (
    <FormField
      label={label}
      required={required}
      hint={hint}
      labelAction={labelAction}
      error={error}
      fieldClassName={fieldClassName}
    >
      <select className={`form-picker ${className}`} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

export function FormCheckbox({ label, checked, onChange, id, className = '', disabled = false }) {
  const checkboxId = id || `checkbox-${label?.replace(/\s/g, '-')}`;
  return (
    <label className={`form-checkbox ${className}`.trim()} htmlFor={checkboxId}>
      <input
        id={checkboxId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function FormTextarea({
  label,
  required,
  error,
  className = '',
  fieldClassName = '',
  rows = 4,
  ...props
}) {
  return (
    <FormField label={label} required={required} error={error} fieldClassName={fieldClassName}>
      <textarea className={`form-textarea ${className}`} rows={rows} {...props} />
    </FormField>
  );
}
