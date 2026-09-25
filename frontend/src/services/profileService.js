import { supabase } from './supabase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

export async function updateProfileName(userId, nome) {
  const { data, error } = await supabase
    .from('usuarios')
    .update({ nome: nome.trim() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfilePhotoUrl(userId, fotoPerfilUrl) {
  const { data, error } = await supabase
    .from('usuarios')
    .update({ foto_perfil_url: fotoPerfilUrl })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function uploadProfilePhoto(file) {
  const token = await getAccessToken();
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BACKEND_URL}/api/storage/upload-profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro no upload da foto');
  }
  return res.json();
}
