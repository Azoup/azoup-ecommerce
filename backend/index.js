import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import billingRoutes from './routes/billingRoutes.js';
import passwordResetRoutes from './routes/passwordResetRoutes.js';
import storageRoutes from './routes/storageRoutes.js';
import { captureNuvemshopWebhookRawBody } from './lib/marketplaceWebhookBody.js';
import marketplaceRoutes from './routes/marketplaceRoutes.js';

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({
  limit: '1mb',
  verify: captureNuvemshopWebhookRawBody,
}));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/billing', billingRoutes);
app.use('/api/auth/password-reset', passwordResetRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/marketplace', marketplaceRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno do servidor' });
});

const server = app.listen(PORT, () => {
  console.log(`Azoup E-commerce backend running on http://localhost:${PORT}`);
  warnIfSupabaseServiceRoleInvalid();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n[ERRO] Porta ${PORT} já está em uso. `
      + 'Feche o outro processo Node ou defina PORT diferente no backend/.env.\n',
    );
    process.exit(1);
  }
  console.error('[server]', err);
  process.exit(1);
});

async function warnIfSupabaseServiceRoleInvalid() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const supabase = createClient(url, key);
  const { error } = await supabase.from('marketplace_integracao').insert({
    cliente_id: '00000000-0000-4000-8000-000000000001',
    marketplace: 'nuvemshop',
    store_id: '__startup_probe__',
    access_token: 'probe',
    status: 'connected',
  });

  if (!error) {
    await supabase.from('marketplace_integracao').delete().eq('store_id', '__startup_probe__');
    return;
  }

  if (error.code === '42501' || error.message.includes('row-level security')) {
    console.error(
      '\n[AVISO] SUPABASE_SERVICE_ROLE_KEY inválida (RLS bloqueou insert). '
      + 'OAuth Nuvemshop NÃO vai salvar conexões até corrigir no backend/.env '
      + '(Supabase → Settings → API → service_role secret).\n',
    );
  }
}
