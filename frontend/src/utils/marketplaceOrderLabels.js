export const MARKETPLACE_PAYMENT_LABELS = {
  paid: 'Pago',
  authorized: 'Autorizado',
  partially_paid: 'Parcialmente pago',
  pending: 'Pendente',
  refunded: 'Reembolsado',
  voided: 'Anulado',
  abandoned: 'Abandonado',
};

export const MARKETPLACE_ORDER_STATUS_LABELS = {
  open: 'Aberto',
  closed: 'Fechado',
  cancelled: 'Cancelado',
};

export const MARKETPLACE_SYNC_STATUS_LABELS = {
  imported: { label: 'Importado', className: 'badge-success' },
  partial: { label: 'Parcial', className: 'badge-warning' },
  error: { label: 'Erro', className: 'badge-error' },
  pending: { label: 'Aguardando regra', className: 'badge-muted' },
  waiting_payment: { label: 'Aguardando regra', className: 'badge-muted' },
  waiting_import: { label: 'Aguardando regra', className: 'badge-muted' },
};

export function formatMarketplaceMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

export function formatMarketplaceDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR');
}

export function formatMarketplaceDocument(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value || '—';
}

export function labelMarketplacePayment(status) {
  return MARKETPLACE_PAYMENT_LABELS[status] || status || '—';
}

export function labelMarketplaceOrderStatus(status) {
  return MARKETPLACE_ORDER_STATUS_LABELS[status] || status || '—';
}
