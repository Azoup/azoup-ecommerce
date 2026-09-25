export function toFriendlyErrorMessage(err) {
  if (!err) return 'Erro desconhecido';
  const msg = err.message || String(err);

  if (msg.includes('Invalid login credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
    return 'Registro duplicado. Verifique SKU ou campos únicos.';
  }
  if (msg.includes('foreign key') || msg.includes('violates foreign key')) {
    return 'Não é possível excluir: registro vinculado a outros dados.';
  }
  if (msg.includes('JWT') || msg.includes('session')) {
    return 'Sessão expirada. Faça login novamente.';
  }

  return msg;
}

export function validateNcm(ncm) {
  const digits = (ncm || '').replace(/\D/g, '');
  return digits.length === 8;
}

export function capitalizeWords(str) {
  if (!str) return '';
  return str.trim().replace(/\S+/g, (word) => {
    if (word.length <= 1) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

/** SKU da variação: SKU pai (dígitos) + sufixo cor/tamanho. */
export function generateSkuVariacao(parentSku, cor, tamanho) {
  const base = String(parentSku || '').replace(/\D/g, '');
  if (!base) return '';
  const corPart = String(cor || '').replace(/\s+/g, '').slice(0, 4).toUpperCase();
  const tamPart = String(tamanho || '').replace(/\s+/g, '').toUpperCase();
  return `${base}${corPart}${tamPart}`;
}

export function validateEan13(ean) {
  if (!ean) return true;
  const digits = ean.replace(/\D/g, '');
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(digits[12], 10);
}

/** Rótulo da variação cor/tamanho para listagens de integração. */
export function formatVariacaoLabel(cor, tamanho) {
  const c = String(cor || '').trim();
  const t = String(tamanho || '').trim();
  if (!c && !t) return '';
  if (c === 'Único' && t === 'Único') return '';
  if (c && t && c.toLowerCase() !== t.toLowerCase()) return `${c} - ${t}`;
  return c || t;
}

/** Chave estável para linhas da comparação integração (variação, não só produto pai). */
export function compareItemKey(item, index = 0) {
  if (item.map_id) return String(item.map_id);
  if (item.external_variant_id) return `nv-${item.external_variant_id}`;
  if (item.produto_cor_tamanho_id) return `az-${item.produto_cor_tamanho_id}`;
  if (item.external_product_id && item.produto_id) {
    return `${item.external_product_id}-${item.produto_id}`;
  }
  if (item.external_product_id) return `np-${item.external_product_id}`;
  if (item.produto_id) return `p-${item.produto_id}-${index}`;
  return `row-${index}`;
}

export function canAccessMenu(userData, menuKey) {
  if (!userData) return false;
  if (userData.eh_admin) return true;
  const perms = userData.permissoes_telas;
  if (Array.isArray(perms) && perms.length > 0) {
    return perms.includes(menuKey);
  }
  return true;
}
