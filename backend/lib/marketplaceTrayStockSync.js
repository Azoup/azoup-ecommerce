import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { createEstoqueLedgerContext, applyStockTarget } from './estoqueLedger.js';
import { isIntegrationStockSyncEnabled } from './marketplaceIntegration.js';

export async function pullProductStockFromTray({
  clienteId,
  integration,
  map,
  targetStock,
  observacao = 'Tray — estoque atualizado via webhook',
}) {
  if (!isIntegrationStockSyncEnabled(integration)) {
    return { skipped: true, reason: 'sync_estoque_disabled' };
  }

  const supabase = requireSupabaseAdmin();
  const estoqueCtx = await createEstoqueLedgerContext(clienteId, null, {
    pontaEstoqueId: integration.ponta_estoque_id,
  });

  await applyStockTarget(clienteId, estoqueCtx, {
    produtoId: map.produto_id,
    variacaoId: map.produto_cor_tamanho_id,
    targetStock: Number(targetStock) || 0,
    observacao,
  });

  await supabase.from('marketplace_produto_map')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_direction: 'tray_to_azoup',
    })
    .eq('id', map.id);

  return { success: true, stock: targetStock };
}
