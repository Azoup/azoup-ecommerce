import { createCategory, listAllCategories } from './nuvemshopClient.js';

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

export function getNuvemCategoryLabel(category) {
  if (!category?.name) return '';
  if (typeof category.name === 'string') return category.name;
  return category.name.pt || category.name.es || category.name.en || '';
}

function resolveParentId(category) {
  const parent = category?.parent;
  if (parent == null || parent === '' || parent === 0) return null;
  return String(parent);
}

function findCategory(categories, name, parentId) {
  const target = normalizeName(name);
  if (!target) return null;

  const expectedParent = parentId == null ? null : String(parentId);

  return categories.find((category) => {
    if (normalizeName(getNuvemCategoryLabel(category)) !== target) return false;
    return resolveParentId(category) === expectedParent;
  }) || null;
}

export async function resolveNuvemshopCategoryIdsForProduct({
  storeId,
  accessToken,
  creds,
  categoriaNome,
  subcategoriaNome,
  cache,
}) {
  const categoria = String(categoriaNome || '').trim();
  const subcategoria = String(subcategoriaNome || '').trim();

  if (!categoria && !subcategoria) {
    return [];
  }

  if (!cache.categories) {
    cache.categories = await listAllCategories(storeId, accessToken, creds);
  }

  const categories = cache.categories;
  let parentId = null;

  if (categoria) {
    let parentCategory = findCategory(categories, categoria, null);
    if (!parentCategory) {
      parentCategory = await createCategory(storeId, accessToken, {
        name: { pt: categoria },
      }, creds);
      categories.push(parentCategory);
    }
    parentId = parentCategory.id;
  }

  if (subcategoria) {
    let childCategory = findCategory(categories, subcategoria, parentId);
    if (!childCategory) {
      const payload = { name: { pt: subcategoria } };
      if (parentId) payload.parent = Number(parentId);
      childCategory = await createCategory(storeId, accessToken, payload, creds);
      categories.push(childCategory);
    }

    return parentId
      ? [Number(parentId), Number(childCategory.id)]
      : [Number(childCategory.id)];
  }

  return parentId ? [Number(parentId)] : [];
}
