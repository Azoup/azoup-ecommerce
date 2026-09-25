import { requireSupabaseAdmin } from './supabaseAdmin.js';

export function formatNuvemshopPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '0';
  return amount.toFixed(2);
}

export function pricesAreDifferent(azoupPrice, nuvemPrice) {
  const azoup = Number(azoupPrice);
  const nuvem = Number(nuvemPrice);
  if (!Number.isFinite(azoup) || !Number.isFinite(nuvem)) return false;
  return formatNuvemshopPrice(azoup) !== formatNuvemshopPrice(nuvem);
}

export async function getDefaultPriceTableId(clienteId) {
  const supabase = requireSupabaseAdmin();

  const { data: padrao } = await supabase
    .from('tabela_precos')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('ativo', true)
    .ilike('descricao', '%padr%')
    .limit(1)
    .maybeSingle();

  if (padrao?.id) return padrao.id;

  const { data: fallback } = await supabase
    .from('tabela_precos')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('ativo', true)
    .limit(1)
    .maybeSingle();

  return fallback?.id || null;
}

export async function assertTabelaPrecoForTenant(clienteId, tabelaPrecoId) {
  const id = String(tabelaPrecoId || '').trim();
  if (!id) throw new Error('Tabela de preço é obrigatória.');

  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('tabela_precos')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('id', id)
    .eq('ativo', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Não foi possível validar tabela de preço: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Tabela de preço inválida ou inativa para esta conta.');
  }
  return data.id;
}

function buildCorTamanhoKey(produtoId, cor, tamanho) {
  return `${produtoId}|${cor}|${tamanho}`;
}

export async function loadSalePricesForVariations(clienteId, produtoId, variations = [], tabelaPrecoId = null) {
  const priceByVariacao = new Map();
  if (!variations.length) return priceByVariacao;

  const tableId = tabelaPrecoId || await getDefaultPriceTableId(clienteId);
  if (!tableId) return priceByVariacao;

  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('produto_cor_tamanho_tabela_preco')
    .select('cor, tamanho, preco')
    .eq('produto_id', produtoId)
    .eq('tabela_preco_id', tableId);

  if (error) throw error;

  const priceByCorTamanho = new Map(
    (data || []).map((row) => [`${row.cor}|${row.tamanho}`, Number(row.preco)]),
  );

  for (const variation of variations) {
    const preco = priceByCorTamanho.get(`${variation.cor}|${variation.tamanho}`);
    if (Number.isFinite(preco)) {
      priceByVariacao.set(variation.id, preco);
    }
  }

  return priceByVariacao;
}

export async function loadSalePricesForProducts(clienteId, produtoIds = [], tabelaPrecoId = null) {
  const priceByKey = new Map();
  const ids = [...new Set(produtoIds.map(String))].filter(Boolean);
  if (!ids.length) return priceByKey;

  const tableId = tabelaPrecoId || await getDefaultPriceTableId(clienteId);
  if (!tableId) return priceByKey;

  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('produto_cor_tamanho_tabela_preco')
    .select('produto_id, cor, tamanho, preco')
    .in('produto_id', ids)
    .eq('tabela_preco_id', tableId);

  if (error) throw error;

  for (const row of data || []) {
    const preco = Number(row.preco);
    if (!Number.isFinite(preco)) continue;
    priceByKey.set(buildCorTamanhoKey(row.produto_id, row.cor, row.tamanho), preco);
  }

  return priceByKey;
}

export function getSalePriceFromMap(priceByKey, produtoId, cor, tamanho) {
  return priceByKey.get(buildCorTamanhoKey(produtoId, cor, tamanho)) ?? null;
}
