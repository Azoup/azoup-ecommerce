/** Status Nuvemshop usados na regra de importação para Pedido Aprovado. */

export const NUVEMSHOP_ORDER_STATUS_OPTIONS = [
  { value: 'open', label: 'Aberto', description: 'Pedido em andamento na loja.' },
  { value: 'closed', label: 'Fechado', description: 'Pedido arquivado/concluído na loja.' },
  { value: 'cancelled', label: 'Cancelado', description: 'Pedido cancelado na loja.' },
];

export const NUVEMSHOP_PAYMENT_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendente', description: 'Aguardando pagamento.' },
  { value: 'authorized', label: 'Autorizado', description: 'Pagamento autorizado, não capturado.' },
  { value: 'paid', label: 'Pago', description: 'Pagamento confirmado.' },
  { value: 'partially_paid', label: 'Parcialmente pago', description: 'Parte do valor foi paga.' },
  { value: 'abandoned', label: 'Abandonado', description: 'Checkout abandonado.' },
  { value: 'refunded', label: 'Reembolsado', description: 'Valor devolvido ao cliente.' },
  { value: 'voided', label: 'Anulado', description: 'Pagamento anulado.' },
];

export const NUVEMSHOP_IMPORT_STATUS_DEFAULT = {
  order_statuses: NUVEMSHOP_ORDER_STATUS_OPTIONS.map((item) => item.value),
  payment_statuses: NUVEMSHOP_PAYMENT_STATUS_OPTIONS.map((item) => item.value),
};

export function getNuvemshopImportStatusDefinitions() {
  return {
    orderStatuses: NUVEMSHOP_ORDER_STATUS_OPTIONS,
    paymentStatuses: NUVEMSHOP_PAYMENT_STATUS_OPTIONS,
    defaults: NUVEMSHOP_IMPORT_STATUS_DEFAULT,
  };
}

export function normalizeImportStatusConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...NUVEMSHOP_IMPORT_STATUS_DEFAULT };
  }

  const allowedOrder = new Set(NUVEMSHOP_ORDER_STATUS_OPTIONS.map((item) => item.value));
  const allowedPayment = new Set(NUVEMSHOP_PAYMENT_STATUS_OPTIONS.map((item) => item.value));

  const orderStatuses = Array.isArray(raw.order_statuses)
    ? raw.order_statuses.filter((value) => allowedOrder.has(String(value)))
    : [];
  const paymentStatuses = Array.isArray(raw.payment_statuses)
    ? raw.payment_statuses.filter((value) => allowedPayment.has(String(value)))
    : [];

  return {
    order_statuses: orderStatuses.length
      ? orderStatuses
      : [...NUVEMSHOP_IMPORT_STATUS_DEFAULT.order_statuses],
    payment_statuses: paymentStatuses.length
      ? paymentStatuses
      : [...NUVEMSHOP_IMPORT_STATUS_DEFAULT.payment_statuses],
  };
}

export function shouldImportNuvemshopOrder(order, integration) {
  const config = normalizeImportStatusConfig(integration?.import_order_statuses);
  const orderStatus = String(order?.status || 'open').trim() || 'open';
  const paymentStatus = String(order?.payment_status || 'pending').trim() || 'pending';

  return config.order_statuses.includes(orderStatus)
    && config.payment_statuses.includes(paymentStatus);
}

export function validateImportStatusPayload(payload) {
  if (payload == null) {
    return normalizeImportStatusConfig(null);
  }

  const normalized = normalizeImportStatusConfig(payload);
  if (!normalized.order_statuses.length || !normalized.payment_statuses.length) {
    throw new Error('Selecione ao menos um status de pedido e um de pagamento.');
  }

  return normalized;
}
