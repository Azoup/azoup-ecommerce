import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  getConfiguredRedirectUri,
  getFrontendOAuthRelayUri,
  isNuvemshopAppConfigured,
} from '../lib/marketplaceConfig.js';
import { createOAuthState, verifyOAuthState } from '../lib/oauthState.js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('=== Diagnóstico Nuvemshop OAuth ===\n');
console.log('App configurado (.env):', isNuvemshopAppConfigured() ? 'SIM' : 'NAO');
console.log('NUVEMSHOP_CLIENT_ID:', process.env.NUVEMSHOP_CLIENT_ID ? `set (${process.env.NUVEMSHOP_CLIENT_ID})` : 'VAZIO');
console.log('NUVEMSHOP_CLIENT_SECRET:', process.env.NUVEMSHOP_CLIENT_SECRET ? 'set' : 'VAZIO');
console.log('NUVEMSHOP_REDIRECT_URI:', getConfiguredRedirectUri());
console.log('FRONTEND relay URI:', getFrontendOAuthRelayUri());
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || '(default localhost:5173)');
console.log('TOKEN_ENCRYPTION_KEY:', process.env.TOKEN_ENCRYPTION_KEY ? 'set' : 'VAZIO');

const testCliente = '00000000-0000-4000-8000-000000000001';
try {
  const state = createOAuthState(testCliente);
  const verified = verifyOAuthState(state);
  console.log('\nOAuth state HMAC:', verified.clienteId === testCliente ? 'OK' : 'FALHOU');
} catch (e) {
  console.log('\nOAuth state HMAC: ERRO', e.message);
}

if (!url || !key) {
  console.log('\nSupabase: NAO CONFIGURADO');
  process.exit(1);
}

const supabase = createClient(url, key);
const { error: tableErr } = await supabase.from('marketplace_integracao').select('id').limit(1);
if (tableErr) {
  console.log('\nTabela marketplace_integracao:', 'ERRO -', tableErr.message);
  console.log('-> Execute database/marketplace_schema.sql no Supabase');
} else {
  console.log('\nTabela marketplace_integracao: OK');
  const { data: rows } = await supabase
    .from('marketplace_integracao')
    .select('cliente_id, store_id, store_name, status, connected_at')
    .order('connected_at', { ascending: false })
    .limit(5);
  console.log('Registros recentes:', rows?.length ? rows : '(nenhum)');

  const { error: insertErr } = await supabase.from('marketplace_integracao').insert({
    cliente_id: testCliente,
    marketplace: 'nuvemshop',
    store_id: 'diagnose-test',
    access_token: 'test',
    status: 'connected',
  });
  if (insertErr) {
    console.log('\nTeste INSERT (service role): FALHOU -', insertErr.message);
    if (insertErr.code === '42501' || insertErr.message.includes('row-level security')) {
      console.log('-> SUPABASE_SERVICE_ROLE_KEY está errada (provavelmente anon/publishable).');
      console.log('   Supabase → Project Settings → API → service_role (secret).');
    }
  } else {
    await supabase.from('marketplace_integracao').delete().eq('store_id', 'diagnose-test');
    console.log('\nTeste INSERT (service role): OK');
  }
}

console.log('\n=== Cadastre no app Nuvemshop (Redirect URI) ===');
console.log(getFrontendOAuthRelayUri());
