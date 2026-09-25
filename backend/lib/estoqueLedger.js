import crypto from 'crypto';
import { requireSupabaseAdmin } from './supabaseAdmin.js';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function resolvePontaEstoqueId(clienteId, overrideId = null) {
  const explicit = String(overrideId || '').trim();
  if (explicit) {
    await assertPontaEstoqueForTenant(clienteId, explicit);
    return explicit;
  }

  const supabase = requireSupabaseAdmin();
  const envPonta = process.env.MARKETPLACE_PONTA_ESTOQUE_ID?.trim();
  if (envPonta) return envPonta;

  const { data: empresa } = await supabase
    .from('empresas')
    .select('ponta_estoque_id')
    .eq('cliente_id', clienteId)
    .not('ponta_estoque_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (empresa?.ponta_estoque_id) return empresa.ponta_estoque_id;

  const { data: ponta } = await supabase
    .from('pontas_estoque')
    .select('id')
    .eq('cliente_id_tenant', clienteId)
    .eq('padrao', true)
    .limit(1)
    .maybeSingle();

  if (ponta?.id) return ponta.id;

  const { data: rpcPonta, error: rpcError } = await supabase.rpc(
    'ensure_ponta_estoque_padrao',
    { p_cliente_id: clienteId },
  );

  if (!rpcError && rpcPonta) return rpcPonta;

  throw new Error(
    'Ponto de estoque não configurado. Cadastre um ponto padrão no Azoup '
    + 'ou defina MARKETPLACE_PONTA_ESTOQUE_ID no backend/.env.',
  );
}

export async function assertPontaEstoqueForTenant(clienteId, pontaEstoqueId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('pontas_estoque')
    .select('id')
    .eq('cliente_id_tenant', clienteId)
    .eq('id', pontaEstoqueId)
    .eq('ativo', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Não foi possível validar ponto de estoque: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Ponto de estoque inválido ou inativo para esta conta.');
  }
  return data.id;
}

export async function listPontasEstoque(clienteId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('pontas_estoque')
    .select('id, codigo, nome, padrao, ativo')
    .eq('cliente_id_tenant', clienteId)
    .eq('ativo', true)
    .order('padrao', { ascending: false })
    .order('nome');

  if (error) {
    throw new Error(`Não foi possível listar pontos de estoque: ${error.message}`);
  }

  const defaultPontaId = await resolvePontaEstoqueId(clienteId);
  const defaultPonta = (data || []).find((row) => row.id === defaultPontaId) || null;

  return {
    pontas: data || [],
    defaultPontaId,
    defaultPonta,
  };
}

export async function getPontaEstoqueInfo(clienteId, pontaEstoqueId) {
  const supabase = requireSupabaseAdmin();
  const id = await resolvePontaEstoqueId(clienteId, pontaEstoqueId);
  const { data, error } = await supabase
    .from('pontas_estoque')
    .select('id, codigo, nome, padrao')
    .eq('cliente_id_tenant', clienteId)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return { id, codigo: null, nome: 'Ponto de estoque' };
  }
  return data;
}

async function resolveMovimentacaoContext(clienteId, usuarioIdHint, pontaEstoqueId = null) {
  const supabase = requireSupabaseAdmin();

  let usuarioId = usuarioIdHint || process.env.MARKETPLACE_INTEGRACAO_USUARIO_ID?.trim();
  if (!usuarioId) {
    const { data: user } = await supabase
      .from('usuarios')
      .select('id')
      .eq('cliente_id', clienteId)
      .eq('ativo', true)
      .limit(1)
      .maybeSingle();
    usuarioId = user?.id;
  }

  const { data: empresa } = await supabase
    .from('empresas')
    .select('id')
    .eq('cliente_id', clienteId)
    .limit(1)
    .maybeSingle();

  if (!empresa?.id || !usuarioId) {
    throw new Error(
      'Empresa ou usuário não encontrados para registrar movimentação de estoque.',
    );
  }

  const pontaEstoqueIdResolved = await resolvePontaEstoqueId(clienteId, pontaEstoqueId);

  return {
    empresaId: empresa.id,
    usuarioId,
    pontaEstoqueId: pontaEstoqueIdResolved,
  };
}

export async function fetchSaldoMaps(clienteId, pontaEstoqueId = null) {
  const supabase = requireSupabaseAdmin();
  let query = supabase
    .from('vw_estoque_saldo_ponta')
    .select('item_id, variacao_id, quantidade')
    .eq('cliente_id_tenant', clienteId)
    .eq('tipo_item', 'produto');

  if (pontaEstoqueId) {
    query = query.eq('ponta_estoque_id', pontaEstoqueId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Não foi possível ler saldo de estoque: ${error.message}`);
  }

  const byVariacao = new Map();
  const byProduto = new Map();

  for (const row of data || []) {
    const qty = Number(row.quantidade) || 0;
    if (row.variacao_id) {
      byVariacao.set(row.variacao_id, (byVariacao.get(row.variacao_id) || 0) + qty);
    } else if (row.item_id) {
      byProduto.set(row.item_id, (byProduto.get(row.item_id) || 0) + qty);
    }
  }

  return { byVariacao, byProduto };
}

/** @deprecated use fetchSaldoMaps */
export async function fetchSaldoByVariacao(clienteId, pontaEstoqueId) {
  const { byVariacao } = await fetchSaldoMaps(clienteId, pontaEstoqueId);
  return byVariacao;
}

export function getVariacaoSaldo(stockCtx, variacaoId, produtoId = null, variationCount = 1) {
  if (!variacaoId && !produtoId) return null;

  const byVariacao = stockCtx?.byVariacao || stockCtx?.saldoMap || stockCtx;
  const byProduto = stockCtx?.productSaldoMap || stockCtx?.byProduto;

  if (variacaoId && byVariacao?.has?.(variacaoId)) {
    return byVariacao.get(variacaoId);
  }

  if (produtoId && byProduto?.has?.(produtoId) && Number(variationCount) <= 1) {
    return byProduto.get(produtoId);
  }

  if (variacaoId) return 0;
  return null;
}

export function stocksAreDifferent(azoupStock, nuvemStock) {
  return Number(azoupStock ?? 0) !== Number(nuvemStock ?? 0);
}

/** Conflito de estoque só quando o Azoup tem menos que a Nuvemshop (e-commerce com saldo a mais). */
export function stockConflictRequiresSync(azoupStock, nuvemStock) {
  return Number(azoupStock ?? 0) < Number(nuvemStock ?? 0);
}

/** Só conflita SKU quando os dois lados têm valor preenchido e são diferentes. */
export function skusAreDifferent(azSku, nvSku) {
  const az = String(azSku ?? '').trim();
  const nv = String(nvSku ?? '').trim();
  if (!az || !nv) return false;
  return az !== nv;
}

export async function createEstoqueLedgerContext(clienteId, usuarioIdHint, options = {}) {
  const pontaEstoqueId = await resolvePontaEstoqueId(clienteId, options.pontaEstoqueId);
  const saldoMaps = await fetchSaldoMaps(clienteId, pontaEstoqueId);
  const movimentacao = await resolveMovimentacaoContext(
    clienteId,
    usuarioIdHint,
    pontaEstoqueId,
  );

  return {
    pontaEstoqueId,
    saldoMap: saldoMaps.byVariacao,
    productSaldoMap: saldoMaps.byProduto,
    byVariacao: saldoMaps.byVariacao,
    byProduto: saldoMaps.byProduto,
    movimentacao,
  };
}

export async function applyStockTarget(clienteId, ctx, {
  produtoId,
  variacaoId,
  targetStock,
  observacao,
  loteId,
}) {
  if (!variacaoId) {
    throw new Error('Variação (produto_cor_tamanho) obrigatória para ajuste de estoque.');
  }

  const current = getVariacaoSaldo(
    ctx,
    variacaoId,
    produtoId,
  ) ?? 0;
  const target = Number(targetStock) || 0;
  const delta = target - current;

  if (delta === 0) {
    return { changed: false, saldo: current, delta: 0 };
  }

  const supabase = requireSupabaseAdmin();
  const batchId = loteId || crypto.randomUUID();
  const { error } = await supabase.from('estoque_movimentacao').insert({
    cliente_id_tenant: clienteId,
    empresa_id: ctx.movimentacao.empresaId,
    usuario_id: ctx.movimentacao.usuarioId,
    item_id: produtoId,
    produto_id: produtoId,
    variacao_id: variacaoId,
    tipo_item: 'produto',
    status_movimentacao: delta > 0 ? 'entrada' : 'saida',
    quantidade: Math.abs(delta),
    data_movimentacao: todayIsoDate(),
    ponta_estoque_id: ctx.movimentacao.pontaEstoqueId,
    movimentacao_lote_id: batchId,
    observacao: observacao || `E-commerce sync ${new Date().toISOString()}`,
  });

  if (error) {
    throw new Error(`Falha ao registrar movimentação de estoque: ${error.message}`);
  }

  ctx.saldoMap.set(variacaoId, target);
  if (ctx.byVariacao) ctx.byVariacao.set(variacaoId, target);

  scheduleMarketplaceStockPush(clienteId, {
    variacaoId,
    produtoId,
    observacao,
  });

  return { changed: true, saldo: target, delta, loteId: batchId };
}

function scheduleMarketplaceStockPush(clienteId, { variacaoId, produtoId, observacao }) {
  const text = String(observacao || '').toLowerCase();
  if (
    text.includes('nuvemshop')
    || text.includes('e-commerce sync')
    || text.includes('ecommerce sync')
    || text.includes('marketplace sync')
  ) {
    return;
  }

  import('./marketplaceStockSync.js')
    .then(({ propagateStockChangeToMarketplaces }) => propagateStockChangeToMarketplaces(clienteId, {
      variacaoId,
      produtoId,
      observacao,
    }))
    .then((result) => {
      if (result?.updated) {
        console.info(
          `[estoque] Estoque enviado ao e-commerce: variação ${variacaoId}, ${result.count} vínculo(s), saldo ${result.stock}.`,
        );
      }
    })
    .catch((err) => {
      console.error('[estoque] Falha ao sincronizar estoque com e-commerce:', err.message);
    });
}
