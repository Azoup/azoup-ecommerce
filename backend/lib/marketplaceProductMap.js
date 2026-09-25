import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { logIntegracaoEvent } from './integracaoEventLog.js';

const MARKETPLACE = 'nuvemshop';

function buildAzoupIndexes(azoupRows = []) {
  const variationIds = new Set();
  const produtoIds = new Set();

  for (const row of azoupRows) {
    if (row.produto_id) produtoIds.add(row.produto_id);
    if (row.produto_cor_tamanho_id) variationIds.add(row.produto_cor_tamanho_id);
  }

  return { variationIds, produtoIds };
}

function buildNuvemIndexes(nuvemRows = []) {
  return new Set(nuvemRows.map((row) => String(row.external_variant_id)));
}

export function isMarketplaceMapAzoupSideMissing(map, azoupIndexes) {
  if (!map?.produto_id || !azoupIndexes.produtoIds.has(map.produto_id)) {
    return true;
  }
  if (!map.produto_cor_tamanho_id) {
    return true;
  }
  return !azoupIndexes.variationIds.has(map.produto_cor_tamanho_id);
}

export function isMarketplaceMapNuvemSideMissing(map, nuvemVariantIds) {
  return !nuvemVariantIds.has(String(map.external_variant_id));
}

export async function unlinkMarketplaceProductMapsByIds({
  clienteId,
  mapIds = [],
  reason,
  integracaoId = null,
  integracaoNome = null,
  usuarioId = null,
  payload = {},
}) {
  const ids = [...new Set(mapIds.filter(Boolean))];
  if (!ids.length) return { removed: 0 };

  const supabase = requireSupabaseAdmin();
  const { error } = await supabase
    .from('marketplace_produto_map')
    .delete()
    .eq('cliente_id', clienteId)
    .in('id', ids);

  if (error) throw error;

  await logIntegracaoEvent(clienteId, {
    categoria: 'produto',
    nivel: 'info',
    acao: 'unlink_maps',
    titulo: `Vínculo removido (${ids.length} variação(ões))`,
    integracaoId,
    lojaNome: integracaoNome,
    mensagem: reason,
    payload: { removed: ids.length, ...payload },
    usuarioId,
  });

  return { removed: ids.length };
}

export async function unlinkMarketplaceMapsByExternalProduct({
  clienteId,
  integracaoId,
  externalProductId,
  reason = 'Produto removido do e-commerce.',
  integracaoNome = null,
  usuarioId = null,
}) {
  const supabase = requireSupabaseAdmin();
  const { data: maps, error } = await supabase
    .from('marketplace_produto_map')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integracaoId)
    .eq('external_product_id', String(externalProductId));

  if (error) throw error;
  if (!maps?.length) return { removed: 0 };

  return unlinkMarketplaceProductMapsByIds({
    clienteId,
    mapIds: maps.map((map) => map.id),
    reason,
    integracaoId,
    integracaoNome,
    usuarioId,
    payload: { external_product_id: String(externalProductId) },
  });
}

export async function pruneStaleMarketplaceProductMaps({
  clienteId,
  integracaoId,
  azoupRows = [],
  nuvemRows = [],
  integracaoNome = null,
  usuarioId = null,
}) {
  const supabase = requireSupabaseAdmin();
  const { data: maps, error } = await supabase
    .from('marketplace_produto_map')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('marketplace', MARKETPLACE)
    .eq('integracao_id', integracaoId);

  if (error) throw error;
  if (!maps?.length) return { removed: 0, details: [] };

  const azoupIndexes = buildAzoupIndexes(azoupRows);
  const nuvemVariantIds = buildNuvemIndexes(nuvemRows);

  const staleIds = [];
  const details = [];

  for (const map of maps) {
    const azMissing = isMarketplaceMapAzoupSideMissing(map, azoupIndexes);
    const nvMissing = isMarketplaceMapNuvemSideMissing(map, nuvemVariantIds);
    if (!azMissing && !nvMissing) continue;

    staleIds.push(map.id);
    details.push({
      map_id: map.id,
      produto_id: map.produto_id,
      produto_cor_tamanho_id: map.produto_cor_tamanho_id,
      external_product_id: map.external_product_id,
      external_variant_id: map.external_variant_id,
      azoup_missing: azMissing,
      nuvemshop_missing: nvMissing,
    });
  }

  if (!staleIds.length) return { removed: 0, details: [] };

  await unlinkMarketplaceProductMapsByIds({
    clienteId,
    mapIds: staleIds,
    reason: 'Produto ou variação não existe mais em um dos lados; vínculo removido para permitir novo envio/importação.',
    integracaoId,
    integracaoNome,
    usuarioId,
    payload: { stale: details.slice(0, 50) },
  });

  return { removed: staleIds.length, details };
}
