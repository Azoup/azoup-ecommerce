import { requireSupabaseAdmin } from './supabaseAdmin.js';
import { decryptToken } from './tokenCrypto.js';
import { isTrayIntegrationEnabled } from './trayConfig.js';

/** Carrega integração conectada (tokens decriptados). Usado por webhooks e sync de estoque. */
export async function getIntegrationById(clienteId, integracaoId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('marketplace_integracao')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('id', integracaoId)
    .eq('status', 'connected')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  if (data.marketplace === 'tray') {
    if (!isTrayIntegrationEnabled()) return null;
    const { resolveTrayIntegration } = await import('./trayClient.js');
    const resolved = await resolveTrayIntegration(data);
    return {
      ...resolved,
      access_token: resolved.access_token,
      refresh_token: resolved.refresh_token || null,
    };
  }

  return {
    ...data,
    access_token: decryptToken(data.access_token),
  };
}
