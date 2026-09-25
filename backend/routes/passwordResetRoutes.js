import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { requireSupabaseAdmin } from '../lib/supabaseAdmin.js';

const router = Router();

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
});

function getMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/request', resetLimiter, async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'E-mail obrigatório' });
  }

  try {
    const supabase = requireSupabaseAdmin();
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, auth_id, nome')
      .eq('usuario', email)
      .maybeSingle();

    if (!usuario?.auth_id) {
      return res.json({ ok: true, message: 'Se o e-mail existir, um código será enviado.' });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabase.from('password_reset_challenges').upsert(
      {
        email,
        code,
        expires_at: expiresAt,
        used: false,
      },
      { onConflict: 'email' },
    );

    const mailer = getMailer();
    if (mailer) {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || 'noreply@azoup.com.br',
        to: email,
        subject: 'Azoup — Código de redefinição de senha',
        text: `Seu código de redefinição de senha é: ${code}\n\nVálido por 15 minutos.`,
        html: `<p>Seu código de redefinição de senha é: <strong>${code}</strong></p><p>Válido por 15 minutos.</p>`,
      });
    } else {
      console.log(`[DEV] Password reset code for ${email}: ${code}`);
    }

    return res.json({ ok: true, message: 'Se o e-mail existir, um código será enviado.' });
  } catch (err) {
    console.error('Password reset request error:', err);
    return res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

router.post('/complete', resetLimiter, async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const code = req.body.code?.trim();
  const newPassword = req.body.newPassword;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'E-mail, código e nova senha são obrigatórios' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
  }

  try {
    const supabase = requireSupabaseAdmin();
    const { data: challenge, error: challengeError } = await supabase
      .from('password_reset_challenges')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('used', false)
      .maybeSingle();

    if (challengeError || !challenge) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    if (new Date(challenge.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Código expirado' });
    }

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('auth_id')
      .eq('usuario', email)
      .maybeSingle();

    if (!usuario?.auth_id) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      usuario.auth_id,
      { password: newPassword },
    );

    if (updateError) throw updateError;

    await supabase
      .from('password_reset_challenges')
      .update({ used: true })
      .eq('email', email);

    return res.json({ ok: true, message: 'Senha redefinida com sucesso' });
  } catch (err) {
    console.error('Password reset complete error:', err);
    return res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

export default router;
