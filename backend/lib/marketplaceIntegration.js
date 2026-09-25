/** Estoque sincronizado por padrão; só desativa quando sync_estoque === false. */
export function isIntegrationStockSyncEnabled(integration) {
  return integration?.sync_estoque !== false;
}

export function normalizeIntegrationStockSyncFlag(value) {
  if (value === undefined || value === null) return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return Boolean(value);
}

export const INTEGRATION_STOCK_SYNC_MIGRATION_HINT =
  'Execute database/marketplace_stock_sync_config_migration.sql no Supabase para salvar esta opção.';

export const INTEGRATION_PUBLIC_COLUMNS =
  'id, marketplace, store_id, store_name, nome, status, connected_at, updated_at, tabela_preco_id, ponta_estoque_id';

export function isMissingDbColumn(error, columnName = '') {
  const message = String(error?.message || '').toLowerCase();
  const missing = error?.code === '42703'
    || message.includes('does not exist')
    || message.includes('could not find');
  if (!missing) return false;
  if (!columnName) return true;
  return message.includes(String(columnName).toLowerCase());
}

export async function listConnectedIntegrationsRows(supabase, clienteId) {
  const base = INTEGRATION_PUBLIC_COLUMNS;
  const attempts = [
    `${base}, import_order_statuses, sync_estoque`,
    `${base}, sync_estoque`,
    `${base}, import_order_statuses`,
    base,
  ];

  let rows = [];
  for (const select of attempts) {
    const { data, error } = await supabase
      .from('marketplace_integracao')
      .select(select)
      .eq('cliente_id', clienteId)
      .eq('status', 'connected')
      .order('nome');

    if (!error) {
      rows = data || [];
      break;
    }
    if (!isMissingDbColumn(error)) throw error;
  }

  return enrichIntegrationsWithSyncEstoque(supabase, clienteId, rows);
}

async function readSyncEstoqueByIds(supabase, clienteId, integracaoIds) {
  if (!integracaoIds.length) return new Map();

  const { data, error } = await supabase
    .from('marketplace_integracao')
    .select('id, sync_estoque')
    .eq('cliente_id', clienteId)
    .in('id', integracaoIds);

  if (error) {
    if (isMissingDbColumn(error, 'sync_estoque')) return new Map();
    throw error;
  }

  return new Map((data || []).map((row) => [row.id, row.sync_estoque]));
}

async function enrichIntegrationsWithSyncEstoque(supabase, clienteId, rows) {
  if (!rows.length) return rows;
  if (rows.every((row) => row.sync_estoque !== undefined && row.sync_estoque !== null)) {
    return rows;
  }

  const syncById = await readSyncEstoqueByIds(
    supabase,
    clienteId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    ...row,
    sync_estoque: syncById.has(row.id) ? syncById.get(row.id) : row.sync_estoque,
  }));
}

async function readSyncEstoqueForIntegration(supabase, clienteId, integracaoId) {
  const { data, error } = await supabase
    .from('marketplace_integracao')
    .select('sync_estoque')
    .eq('cliente_id', clienteId)
    .eq('id', integracaoId)
    .maybeSingle();

  if (error) {
    if (isMissingDbColumn(error, 'sync_estoque')) return null;
    throw error;
  }

  return data?.sync_estoque;
}

async function selectIntegrationSettingsRow(supabase, clienteId, integracaoId) {
  const attempts = [
    'nome, import_order_statuses, sync_estoque',
    'nome, sync_estoque',
    'nome, import_order_statuses',
    'nome',
  ];

  for (const select of attempts) {
    const { data, error } = await supabase
      .from('marketplace_integracao')
      .select(select)
      .eq('cliente_id', clienteId)
      .eq('id', integracaoId)
      .maybeSingle();

    if (!error) return data;
    if (!isMissingDbColumn(error)) throw error;
  }

  return null;
}

async function updateIntegrationRow(supabase, clienteId, integracaoId, patch) {
  const stockPatch = patch.sync_estoque;
  const attempts = [
    'id, marketplace, store_id, store_name, nome, status, connected_at, tabela_preco_id, ponta_estoque_id, import_order_statuses, sync_estoque',
    `${INTEGRATION_PUBLIC_COLUMNS}, sync_estoque`,
    `${INTEGRATION_PUBLIC_COLUMNS}, import_order_statuses`,
    INTEGRATION_PUBLIC_COLUMNS,
  ];

  let lastError = null;
  for (const select of attempts) {
    const { data, error } = await supabase
      .from('marketplace_integracao')
      .update(patch)
      .eq('cliente_id', clienteId)
      .eq('id', integracaoId)
      .eq('status', 'connected')
      .select(select)
      .maybeSingle();

    if (!error) {
      if (stockPatch !== undefined) {
        if (data && data.sync_estoque !== undefined && data.sync_estoque !== null) {
          return data;
        }
        const fresh = await readSyncEstoqueForIntegration(supabase, clienteId, integracaoId);
        return {
          ...data,
          sync_estoque: fresh ?? stockPatch,
        };
      }
      return data;
    }

    lastError = error;
    if (isMissingDbColumn(error, 'sync_estoque') && stockPatch !== undefined) {
      throw new Error(INTEGRATION_STOCK_SYNC_MIGRATION_HINT);
    }
    if (!isMissingDbColumn(error)) throw error;
  }

  if (lastError) throw lastError;
  throw new Error('Não foi possível atualizar a loja vinculada.');
}

export { selectIntegrationSettingsRow, updateIntegrationRow };
