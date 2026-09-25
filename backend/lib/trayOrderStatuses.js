import { shouldImportNuvemshopOrder } from './nuvemshopOrderStatuses.js';

const DEFAULT_IMPORT_STATUSES = {
  order_statuses: ['FINALIZADO', 'A ENVIAR', 'ENVIADO', 'ENTREGUE'],
  payment_statuses: ['paid'],
};

const TRAY_ORDER_STATUS_OPTIONS = [
  { value: 'AGUARDANDO PAGAMENTO', label: 'Aguardando pagamento', description: 'Pedido aguardando confirmação de pagamento.' },
  { value: 'PAGAMENTO CONFIRMADO', label: 'Pagamento confirmado', description: 'Pagamento confirmado na Tray.' },
  { value: 'A ENVIAR', label: 'A enviar', description: 'Pedido pronto para envio.' },
  { value: 'ENVIADO', label: 'Enviado', description: 'Pedido despachado.' },
  { value: 'ENTREGUE', label: 'Entregue', description: 'Pedido entregue ao cliente.' },
  { value: 'FINALIZADO', label: 'Finalizado', description: 'Pedido concluído.' },
  { value: 'CANCELADO', label: 'Cancelado', description: 'Pedido cancelado.' },
];

const TRAY_PAYMENT_STATUS_OPTIONS = [
  { value: 'paid', label: 'Pago', description: 'Pedido com pagamento confirmado (has_payment).' },
  { value: 'pending', label: 'Pendente', description: 'Pagamento ainda não confirmado.' },
];

export function getTrayImportStatusDefinitions() {
  return {
    orderStatuses: TRAY_ORDER_STATUS_OPTIONS,
    paymentStatuses: TRAY_PAYMENT_STATUS_OPTIONS,
    defaults: { ...DEFAULT_IMPORT_STATUSES },
  };
}

export function normalizeImportStatusConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_IMPORT_STATUSES };

  const allowedOrder = new Set(TRAY_ORDER_STATUS_OPTIONS.map((item) => item.value));
  const allowedPayment = new Set(TRAY_PAYMENT_STATUS_OPTIONS.map((item) => item.value));

  const orderStatuses = Array.isArray(raw.order_statuses)
    ? raw.order_statuses.filter((value) => allowedOrder.has(String(value)))
    : (Array.isArray(raw.orderStatuses)
      ? raw.orderStatuses.filter((value) => allowedOrder.has(String(value)))
      : []);
  const paymentStatuses = Array.isArray(raw.payment_statuses)
    ? raw.payment_statuses.filter((value) => allowedPayment.has(String(value)))
    : (Array.isArray(raw.paymentStatuses)
      ? raw.paymentStatuses.filter((value) => allowedPayment.has(String(value)))
      : []);

  return {
    order_statuses: orderStatuses.length ? orderStatuses : [...DEFAULT_IMPORT_STATUSES.order_statuses],
    payment_statuses: paymentStatuses.length ? paymentStatuses : [...DEFAULT_IMPORT_STATUSES.payment_statuses],
  };
}

export function validateImportStatusPayload(raw) {
  const normalized = normalizeImportStatusConfig(raw);
  if (!normalized.order_statuses.length && !normalized.payment_statuses.length) {
    throw new Error('Selecione ao menos um status de pedido ou pagamento para importação.');
  }
  return normalized;
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

export function shouldImportTrayOrder(order, integration) {
  const config = normalizeImportStatusConfig(integration?.import_order_statuses);
  const orderStatus = normalizeStatus(order?.status || order?.order_status);
  const paymentStatus = String(order?.payment_status || '').trim().toLowerCase();

  const orderMatch = !config.order_statuses.length
    || config.order_statuses.some((s) => normalizeStatus(s) === orderStatus);
  const paymentMatch = !config.payment_statuses.length
    || config.payment_statuses.some((s) => String(s).trim().toLowerCase() === paymentStatus);

  return orderMatch || paymentMatch;
}

export function shouldImportMarketplaceOrder(order, integration) {
  if (integration?.marketplace === 'tray') {
    return shouldImportTrayOrder(order, integration);
  }
  return shouldImportNuvemshopOrder(order, integration);
}
