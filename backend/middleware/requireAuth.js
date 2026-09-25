import { requireSupabaseAdmin } from '../lib/supabaseAdmin.js';

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação obrigatório' });
  }

  let supabase;
  try {
    supabase = requireSupabaseAdmin();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('*')
    .eq('auth_id', user.id)
    .maybeSingle();

  if (profileError || !profile || profile.ativo === false) {
    return res.status(403).json({ error: 'Usuário sem permissão ou inativo' });
  }

  req.user = user;
  req.userData = profile;
  next();
}
