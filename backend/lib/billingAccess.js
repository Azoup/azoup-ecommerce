const ACTIVE_PAID_STATUSES = new Set(['active', 'ativa', 'ativo']);

const ACTIVE_LEGACY_STATUSES = new Set([
  'cortesia',
  'legado',
  'legacy',
  'gratuito',
  'free',
  'sem_pagamento',
  'isento',
]);

const BLOCKED_STATUSES = new Set([
  'cancelado',
  'cancelada',
  'cancelled',
  'canceled',
  'expired',
  'expirado',
  'unpaid',
  'inadimplente',
  'trial',
  'trialing',
]);

function readStatus(assinatura) {
  const raw = assinatura?.status
    ?? assinatura?.situacao
    ?? assinatura?.status_assinatura
    ?? '';
  return String(raw).trim().toLowerCase();
}

function readStripeStatus(assinatura) {
  return String(assinatura?.stripe_status || '').trim().toLowerCase();
}

function readPlano(assinatura) {
  return assinatura?.planos_assinatura || assinatura?.plano || null;
}

function readPlanoId(assinatura) {
  const plano = readPlano(assinatura);
  return assinatura?.plano_id
    ?? assinatura?.plano_assinatura_id
    ?? plano?.id
    ?? null;
}

function readPlanoValor(plano) {
  if (!plano) return null;
  const raw = plano.valor ?? plano.preco ?? plano.valor_mensal ?? plano.price;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function isFreeOrLegacyPlan(plano) {
  if (!plano) return false;
  const valor = readPlanoValor(plano);
  if (valor === 0) return true;
  const nome = String(plano.nome ?? plano.descricao ?? plano.titulo ?? '').toLowerCase();
  return nome.includes('legado')
    || nome.includes('legacy')
    || nome.includes('cortesia')
    || nome.includes('gratuito');
}

function hasStripeSubscription(assinatura, cliente) {
  return Boolean(
    assinatura?.stripe_subscription_id
    || assinatura?.stripe_sub_id
    || assinatura?.subscription_id
    || assinatura?.id_assinatura_stripe
    || cliente?.stripe_customer_id,
  );
}

function isLegacyTenant(assinatura, cliente) {
  const plano = readPlano(assinatura);
  if (isFreeOrLegacyPlan(plano)) return true;
  // Conta antiga sem Stripe: libera acesso, mas NÃO pode adicionar loja cobrável.
  if (!hasStripeSubscription(assinatura, cliente) && (readPlanoId(assinatura) != null || plano)) {
    return true;
  }
  return false;
}

/**
 * Acesso ao app e-commerce:
 * - Assinatura paga: status Ativo/active E stripe_status active
 * - Trial: bloqueado (igual Confec/PDV)
 * - Legacy sem Stripe: permite entrar; adicionar loja exige Stripe active no Confec
 */
export function evaluateAssinaturaAccess(assinatura, cliente = null) {
  if (!assinatura) {
    return { allowed: true, reason: 'legacy_no_subscription', canAddStore: false };
  }

  const status = readStatus(assinatura);
  const stripeStatus = readStripeStatus(assinatura);
  const planoId = readPlanoId(assinatura);
  const legacy = isLegacyTenant(assinatura, cliente);
  const hasStripe = hasStripeSubscription(assinatura, cliente);

  if (status === 'trial' || status === 'trialing' || stripeStatus === 'trialing') {
    return {
      allowed: false,
      reason: 'Trial não libera o e-commerce. Ative o plano Confec.',
      status,
      stripeStatus,
      planoId,
      canAddStore: false,
    };
  }

  if (ACTIVE_PAID_STATUSES.has(status) && stripeStatus === 'active') {
    return {
      allowed: true,
      reason: 'active',
      status,
      stripeStatus,
      planoId,
      canAddStore: true,
    };
  }

  if (ACTIVE_PAID_STATUSES.has(status) && hasStripe && stripeStatus && stripeStatus !== 'active') {
    return {
      allowed: false,
      reason: 'Assinatura Stripe inativa. Regularize o pagamento no Confec.',
      status,
      stripeStatus,
      planoId,
      canAddStore: false,
    };
  }

  if (legacy || ACTIVE_LEGACY_STATUSES.has(status)) {
    return {
      allowed: true,
      reason: 'legacy_plan',
      status,
      stripeStatus,
      planoId,
      canAddStore: false,
    };
  }

  if (BLOCKED_STATUSES.has(status)) {
    return {
      allowed: false,
      reason: 'Assinatura inativa ou cancelada',
      status,
      stripeStatus,
      planoId,
      canAddStore: false,
    };
  }

  if (status === 'inativa' || status === 'inativo' || status === 'inactive') {
    if (!hasStripe) {
      return {
        allowed: true,
        reason: 'legacy_inactive_status_no_stripe',
        status,
        planoId,
        canAddStore: false,
      };
    }
    return {
      allowed: false,
      reason: 'Assinatura inativa ou cancelada',
      status,
      stripeStatus,
      planoId,
      canAddStore: false,
    };
  }

  if (!status && (planoId != null || readPlano(assinatura))) {
    return {
      allowed: true,
      reason: 'legacy_no_status',
      planoId,
      canAddStore: false,
    };
  }

  if (planoId != null || readPlano(assinatura)) {
    return {
      allowed: true,
      reason: 'legacy_unknown_status',
      status,
      planoId,
      canAddStore: false,
    };
  }

  return {
    allowed: false,
    reason: 'Assinatura inativa ou cancelada',
    status,
    stripeStatus,
    canAddStore: false,
  };
}
