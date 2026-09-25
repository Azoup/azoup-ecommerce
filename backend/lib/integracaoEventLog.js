import { requireSupabaseAdmin } from './supabaseAdmin.js';

export const EVENT_CATEGORIES = {
  conexao: 'Conexão',
  produto: 'Produto',
  estoque: 'Estoque',
  pedido: 'Pedido',
  configuracao: 'Configuração',
  webhook: 'Webhook',
  sistema: 'Sistema',
};

export const EVENT_LEVELS = {
  info: 'Info',
  success: 'Sucesso',
  warning: 'Aviso',
  error: 'Erro',
};

const LEGACY_SYNC_ACTIONS = {
  import: {
    acao: 'product_pull',
    categoria: 'produto',
    tituloOk: 'Produto puxado do e-commerce',
    tituloErr: 'Erro ao puxar produto do e-commerce',
  },
  export: {
    acao: 'product_push',
    categoria: 'produto',
    tituloOk: 'Produto enviado para o e-commerce',
    tituloErr: 'Erro ao enviar produto para o e-commerce',
  },
  sync_stock: {
    acao: 'stock_push',
    categoria: 'estoque',
    tituloOk: 'Estoque enviado para o e-commerce',
    tituloErr: 'Erro ao enviar estoque para o e-commerce',
  },
  sync_price: {
    acao: 'price_push',
    categoria: 'produto',
    tituloOk: 'Preço sincronizado no e-commerce',
    tituloErr: 'Erro ao sincronizar preço no e-commerce',
  },
  import_order: {
    acao: 'order_import',
    categoria: 'pedido',
    tituloOk: 'Pedido importado como Pedido Aprovado',
    tituloErr: 'Erro ao importar pedido',
  },
};

function mapLegacyLevel(status) {
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'warning') return 'warning';
  return 'info';
}

export async function logIntegracaoEvent(clienteId, event = {}) {
  if (!clienteId || !event.titulo) return null;

  try {
    const supabase = requireSupabaseAdmin();
    const { data, error } = await supabase
      .from('integracao_event_log')
      .insert({
        cliente_id: clienteId,
        categoria: event.categoria || 'sistema',
        nivel: event.nivel || 'info',
        acao: event.acao || 'event',
        marketplace: event.marketplace || 'nuvemshop',
        integracao_id: event.integracaoId || null,
        loja_nome: event.lojaNome || null,
        titulo: String(event.titulo).slice(0, 300),
        mensagem: event.mensagem || null,
        referencia_tipo: event.referenciaTipo || null,
        referencia_id: event.referenciaId != null ? String(event.referenciaId) : null,
        usuario_id: event.usuarioId || null,
        payload: event.payload || null,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[integracaoEventLog]', error.message);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error('[integracaoEventLog]', err.message);
    return null;
  }
}

export async function logLegacyMarketplaceSync(clienteId, action, status, extra = {}) {
  const meta = LEGACY_SYNC_ACTIONS[action] || {
    acao: action,
    categoria: 'sistema',
    tituloOk: action,
    tituloErr: `Erro: ${action}`,
  };
  const isError = status === 'error';
  const productLabel = extra.payload?.external_product_id
    || extra.external_product_id
    || extra.payload?.external_order_id
    || extra.payload?.produto_id
    || '';

  return logIntegracaoEvent(clienteId, {
    categoria: meta.categoria,
    nivel: mapLegacyLevel(status),
    acao: meta.acao,
    marketplace: extra.marketplace || 'nuvemshop',
    integracaoId: extra.integracao_id || extra.integracaoId || null,
    lojaNome: extra.loja_nome || extra.lojaNome || null,
    titulo: isError ? meta.tituloErr : meta.tituloOk,
    mensagem: extra.error_message || extra.mensagem || null,
    referenciaTipo: action === 'import_order' ? 'pedido' : 'produto',
    referenciaId: productLabel || null,
    usuarioId: extra.usuario_id || extra.usuarioId || null,
    payload: extra.payload || {
      external_product_id: extra.external_product_id || null,
      produto_id: extra.produto_id || null,
      error_message: extra.error_message || null,
    },
  });
}

export function formatIntegracaoEventRow(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    categoria: row.categoria,
    categoriaLabel: EVENT_CATEGORIES[row.categoria] || row.categoria,
    nivel: row.nivel,
    nivelLabel: EVENT_LEVELS[row.nivel] || row.nivel,
    acao: row.acao,
    marketplace: row.marketplace,
    integracaoId: row.integracao_id,
    lojaNome: row.loja_nome || row.integracao?.nome || row.integracao?.store_name || null,
    titulo: row.titulo,
    mensagem: row.mensagem,
    referenciaTipo: row.referencia_tipo,
    referenciaId: row.referencia_id,
    payload: row.payload,
  };
}

export async function listIntegracaoEvents(clienteId, options = {}) {
  const supabase = requireSupabaseAdmin();
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  const offset = Math.max(Number(options.offset) || 0, 0);

  let query = supabase
    .from('integracao_event_log')
    .select(`
      *,
      integracao:integracao_id ( id, nome, store_name, marketplace )
    `, { count: 'exact' })
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.categoria) {
    query = query.eq('categoria', String(options.categoria));
  }
  if (options.nivel) {
    query = query.eq('nivel', String(options.nivel));
  }
  if (options.integracaoId) {
    query = query.eq('integracao_id', String(options.integracaoId));
  }
  if (options.acao) {
    query = query.eq('acao', String(options.acao));
  }

  const { data, error, count } = await query;

  if (error) {
    const missingTable = error.message?.includes('integracao_event_log')
      || error.code === '42P01';
    if (missingTable) {
      return {
        events: [],
        total: 0,
        limit,
        offset,
        tableMissing: true,
      };
    }
    throw error;
  }

  return {
    events: (data || []).map(formatIntegracaoEventRow),
    total: count ?? (data || []).length,
    limit,
    offset,
  };
}
