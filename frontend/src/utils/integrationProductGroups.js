import { formatVariacaoLabel } from './helpers';

export function buildExportProductGroups(items) {
  const map = new Map();

  for (const item of items || []) {
    if (item.status !== 'only_azoup' || !item.produto_id || !item.produto_cor_tamanho_id) continue;

    if (!map.has(item.produto_id)) {
      map.set(item.produto_id, {
        productId: item.produto_id,
        nome: item.azoup?.nome || '—',
        sku: item.azoup?.sku || '',
        variations: [],
      });
    }

    const group = map.get(item.produto_id);
    group.variations.push({
      variationId: item.produto_cor_tamanho_id,
      label: formatVariacaoLabel(item.azoup?.cor, item.azoup?.tamanho) || '—',
      sku: item.azoup?.sku || '',
      estoque: item.azoup?.estoque,
    });
  }

  return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function buildImportProductGroups(items) {
  const map = new Map();

  for (const item of items || []) {
    if (item.status !== 'only_nuvemshop' || !item.external_product_id || !item.external_variant_id) continue;

    const productId = String(item.external_product_id);
    if (!map.has(productId)) {
      map.set(productId, {
        productId,
        nome: item.nuvemshop?.nome || '—',
        sku: item.nuvemshop?.sku || '',
        variations: [],
      });
    }

    const group = map.get(productId);
    group.variations.push({
      variationId: String(item.external_variant_id),
      label: formatVariacaoLabel(item.nuvemshop?.cor, item.nuvemshop?.tamanho) || '—',
      sku: item.nuvemshop?.sku || '',
      estoque: item.nuvemshop?.estoque,
      price: item.nuvemshop?.price,
    });
  }

  return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function buildExportPayload(groups, selectedVariationIds) {
  const byProduct = new Map();

  for (const group of groups) {
    const variationIds = group.variations
      .map((v) => v.variationId)
      .filter((id) => selectedVariationIds.has(id));
    if (variationIds.length > 0) {
      byProduct.set(group.productId, variationIds);
    }
  }

  return [...byProduct.entries()].map(([produtoId, variationIds]) => ({
    produtoId,
    variationIds,
  }));
}

export function buildImportPayload(groups, selectedVariationIds) {
  const byProduct = new Map();

  for (const group of groups) {
    const externalVariantIds = group.variations
      .map((v) => v.variationId)
      .filter((id) => selectedVariationIds.has(id));
    if (externalVariantIds.length > 0) {
      byProduct.set(group.productId, externalVariantIds);
    }
  }

  return [...byProduct.entries()].map(([externalProductId, externalVariantIds]) => ({
    externalProductId,
    externalVariantIds,
  }));
}

export function countSelectedInGroup(group, selectedVariationIds) {
  return group.variations.filter((v) => selectedVariationIds.has(v.variationId)).length;
}

export function isGroupFullySelected(group, selectedVariationIds) {
  return group.variations.length > 0
    && group.variations.every((v) => selectedVariationIds.has(v.variationId));
}

export function isGroupPartiallySelected(group, selectedVariationIds) {
  const count = countSelectedInGroup(group, selectedVariationIds);
  return count > 0 && count < group.variations.length;
}

function normalizeSearchTerm(query) {
  return String(query || '').trim().toLowerCase();
}

function groupMatchesSearch(group, query) {
  if (!query) return true;

  if (group.nome?.toLowerCase().includes(query)) return true;
  if (group.sku?.toLowerCase().includes(query)) return true;

  return group.variations.some((variation) => {
    if (variation.sku?.toLowerCase().includes(query)) return true;
    if (variation.label?.toLowerCase().includes(query)) return true;
    return false;
  });
}

export function filterProductGroups(groups, query) {
  const normalized = normalizeSearchTerm(query);
  if (!normalized) return groups;
  return groups.filter((group) => groupMatchesSearch(group, normalized));
}

export function collectVariationIdsFromGroups(groups) {
  const ids = new Set();
  for (const group of groups) {
    for (const variation of group.variations) {
      ids.add(variation.variationId);
    }
  }
  return ids;
}

export function areAllGroupsSelected(groups, selectedVariationIds) {
  const ids = collectVariationIdsFromGroups(groups);
  return ids.size > 0 && [...ids].every((id) => selectedVariationIds.has(id));
}

function getEcommerceItem(item) {
  return item?.external ?? item?.nuvemshop ?? null;
}

function resolveCompareGroupKey(item, index) {
  if (item.produto_id) return `p:${item.produto_id}`;
  if (item.external_product_id) return `e:${item.external_product_id}`;
  const ecommerce = getEcommerceItem(item);
  const nome = (item.azoup?.nome || ecommerce?.nome || '').trim().toLowerCase();
  if (nome) return `n:${nome}`;
  return `row:${index}`;
}

export function buildCompareProductGroups(items) {
  const map = new Map();

  (items || []).forEach((item, index) => {
    const groupKey = resolveCompareGroupKey(item, index);
    const ecommerce = getEcommerceItem(item);
    const nome = item.azoup?.nome || ecommerce?.nome || '—';

    if (!map.has(groupKey)) {
      map.set(groupKey, {
        productId: groupKey,
        nome,
        variations: [],
      });
    }

    map.get(groupKey).variations.push({
      item,
      variationKey: item.produto_cor_tamanho_id
        || item.external_variant_id
        || `${groupKey}:${index}`,
      label: formatVariacaoLabel(
        item.azoup?.cor ?? ecommerce?.cor,
        item.azoup?.tamanho ?? ecommerce?.tamanho,
      ) || '—',
    });
  });

  return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function summarizeCompareGroupStatus(variations) {
  const counts = {};
  for (const variation of variations) {
    const status = variation.item?.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

/** Status único do grupo quando todas as variações compartilham o mesmo status. */
export function resolveCompareGroupStatus(variations) {
  if (!variations?.length) return null;

  const statuses = [...new Set(
    variations.map((v) => v.item?.status).filter(Boolean),
  )];

  if (statuses.length === 1) {
    return { type: 'uniform', status: statuses[0] };
  }

  return {
    type: 'mixed',
    counts: summarizeCompareGroupStatus(variations),
  };
}
