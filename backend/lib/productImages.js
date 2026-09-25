import crypto from 'crypto';
import { requireSupabaseAdmin } from './supabaseAdmin.js';

const IMAGE_BUCKET = 'produtos';
const NUVEm_IMG_OBS_PREFIX = 'Nuvemshop img:';

function extensionFromMime(contentType = '') {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

function extensionFromUrl(url) {
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function parseNuvemImageIdFromObservacao(observacao) {
  const match = String(observacao || '').match(/Nuvemshop img:(\d+)/);
  return match ? String(match[1]) : null;
}

export async function fetchProductImages(produtoId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('produto_imagem')
    .select('id, url_imagem, observacao')
    .eq('produto_id', produtoId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchAllProductImageUrls(produtoId) {
  const rows = await fetchProductImages(produtoId);
  return rows.map((row) => row.url_imagem).filter(Boolean);
}

export async function fetchFirstProductImageUrl(produtoId) {
  const urls = await fetchAllProductImageUrls(produtoId);
  return urls[0] || null;
}

async function downloadImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Falha ao baixar imagem (${res.status})`);
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw new Error('URL não é uma imagem válida');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('Imagem vazia');
  return {
    buffer,
    contentType,
    ext: extensionFromUrl(url) || extensionFromMime(contentType),
  };
}

export async function uploadProductImageBuffer(clienteId, produtoId, buffer, contentType, ext) {
  const supabase = requireSupabaseAdmin();
  const path = `${clienteId}/${produtoId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

export async function importImageUrlToProduto(clienteId, produtoId, imageUrl, observacao) {
  const supabase = requireSupabaseAdmin();
  const { buffer, contentType, ext } = await downloadImage(imageUrl);
  const publicUrl = await uploadProductImageBuffer(clienteId, produtoId, buffer, contentType, ext);

  const { error } = await supabase.from('produto_imagem').insert({
    produto_id: produtoId,
    url_imagem: publicUrl,
    observacao: observacao || 'Importado Nuvemshop',
  });

  if (error) throw error;
  return publicUrl;
}

export function extractNuvemshopImageUrls(nuvemProduct) {
  const images = [...(nuvemProduct?.images || [])];
  return images
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((img) => ({ id: img.id, src: img.src, position: img.position }))
    .filter((img) => img.src);
}

async function linkAzoupImageToNuvem(produtoId, azoupImageRowId, nuvemImageId) {
  const supabase = requireSupabaseAdmin();
  const { error } = await supabase
    .from('produto_imagem')
    .update({ observacao: `${NUVEm_IMG_OBS_PREFIX}${nuvemImageId}` })
    .eq('id', azoupImageRowId);

  if (error) throw error;
}

export async function importNuvemshopProductImages(clienteId, produtoId, nuvemProduct) {
  const existingRows = await fetchProductImages(produtoId);
  const importedNuvemIds = new Set(
    existingRows
      .map((row) => parseNuvemImageIdFromObservacao(row.observacao))
      .filter(Boolean),
  );

  const nuvemImages = extractNuvemshopImageUrls(nuvemProduct);
  let imported = 0;
  const errors = [];

  for (const image of nuvemImages) {
    if (image.id && importedNuvemIds.has(String(image.id))) continue;

    try {
      await importImageUrlToProduto(
        clienteId,
        produtoId,
        image.src,
        image.id
          ? `${NUVEm_IMG_OBS_PREFIX}${image.id}`
          : `Nuvemshop imagem ${image.position || imported + 1}`,
      );
      if (image.id) importedNuvemIds.add(String(image.id));
      imported += 1;
    } catch (err) {
      errors.push(err.message);
    }
  }

  return { imported, errors, skipped: imported === 0 && nuvemImages.length > 0 };
}

export async function linkCreatedNuvemImagesToAzoup(produtoId, nuvemProduct) {
  const azoupRows = await fetchProductImages(produtoId);
  const nuvemImages = extractNuvemshopImageUrls(nuvemProduct);
  const limit = Math.min(azoupRows.length, nuvemImages.length);

  for (let i = 0; i < limit; i += 1) {
    const azoupRow = azoupRows[i];
    const nuvemImage = nuvemImages[i];
    if (!azoupRow?.id || !nuvemImage?.id) continue;
    if (parseNuvemImageIdFromObservacao(azoupRow.observacao)) continue;
    await linkAzoupImageToNuvem(produtoId, azoupRow.id, nuvemImage.id);
  }
}

export async function exportProductImagesToNuvemshop({
  createProductImage,
  storeId,
  accessToken,
  externalProductId,
  produtoId,
  nuvemExistingImages,
  creds,
}) {
  const azoupRows = await fetchProductImages(produtoId);
  if (!azoupRows.length) return { uploaded: 0, imageUrls: [] };

  const imageUrls = azoupRows.map((row) => row.url_imagem).filter(Boolean);
  const linkedNuvemIds = new Set(
    azoupRows
      .map((row) => parseNuvemImageIdFromObservacao(row.observacao))
      .filter(Boolean),
  );

  const nuvemImages = [...(nuvemExistingImages || [])]
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  let uploaded = 0;
  const errors = [];

  for (let i = 0; i < azoupRows.length; i += 1) {
    const row = azoupRows[i];
    const linkedId = parseNuvemImageIdFromObservacao(row.observacao);
    if (linkedId && nuvemImages.some((img) => String(img.id) === linkedId)) {
      continue;
    }

    if (!linkedId && nuvemImages[i]?.id) {
      await linkAzoupImageToNuvem(produtoId, row.id, nuvemImages[i].id);
      continue;
    }

    const position = nuvemImages.length + uploaded + 1;
    try {
      const created = await createProductImage(
        storeId,
        accessToken,
        externalProductId,
        { src: row.url_imagem, position },
        creds,
      );
      if (created?.id && row.id) {
        await linkAzoupImageToNuvem(produtoId, row.id, created.id);
        linkedNuvemIds.add(String(created.id));
      }
      uploaded += 1;
    } catch (err) {
      errors.push(err.message);
    }
  }

  return { uploaded, errors, imageUrls };
}
