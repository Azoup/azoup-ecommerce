import { supabase } from './supabase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

export async function uploadProductImage(file, produtoId) {
  const token = await getAccessToken();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('produtoId', produtoId);
  formData.append('bucket', 'produtos');

  const res = await fetch(`${BACKEND_URL}/api/storage/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro no upload');
  }
  return res.json();
}

export async function deleteStorageFile(path, bucket = 'produtos') {
  const token = await getAccessToken();
  const res = await fetch(`${BACKEND_URL}/api/storage/delete`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, bucket }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro ao excluir arquivo');
  }
  return res.json();
}

export async function requestPasswordReset(email) {
  const res = await fetch(`${BACKEND_URL}/api/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro ao solicitar reset');
  }
  return res.json();
}

export async function completePasswordReset(email, code, newPassword) {
  const res = await fetch(`${BACKEND_URL}/api/auth/password-reset/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro ao redefinir senha');
  }
  return res.json();
}
