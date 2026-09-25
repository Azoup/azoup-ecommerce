import { supabase } from '../services/supabase';

export async function resolveSessionUserProfile(session) {
  if (!session?.user?.id) return null;

  const authId = session.user.id;
  const email = session.user.email?.trim().toLowerCase();

  let { data: profile, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('auth_id', authId)
    .maybeSingle();

  if (error) throw error;

  if (!profile && email) {
    const { data: legacy, error: legacyError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('usuario', email)
      .maybeSingle();

    if (legacyError) throw legacyError;

    if (legacy) {
      const { data: updated, error: updateError } = await supabase
        .from('usuarios')
        .update({ auth_id: authId })
        .eq('id', legacy.id)
        .select('*')
        .single();

      if (updateError) throw updateError;
      profile = updated;
    }
  }

  return profile;
}
