import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSupabaseAdmin } from '../lib/supabaseAdmin.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

async function verifyProductOwnership(produtoId, clienteId) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('produtos')
    .select('id')
    .eq('id', produtoId)
    .eq('cliente_id', clienteId)
    .maybeSingle();

  return !error && Boolean(data);
}

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const produtoId = req.body.produtoId;
    const bucket = req.body.bucket || 'produtos';

    if (!produtoId || !req.file) {
      return res.status(400).json({ error: 'produtoId e arquivo são obrigatórios' });
    }

    const owns = await verifyProductOwnership(produtoId, req.userData.cliente_id);
    if (!owns) {
      return res.status(403).json({ error: 'Produto não pertence ao seu tenant' });
    }

    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const path = `${req.userData.cliente_id}/${produtoId}/${Date.now()}.${ext}`;

    const supabase = requireSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

    return res.json({ url: urlData.publicUrl, path });
  } catch (err) {
    console.error('Storage upload error:', err);
    return res.status(500).json({ error: err.message || 'Erro no upload' });
  }
});

router.post('/upload-profile', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo é obrigatório' });
    }

    const bucket = 'avatars';
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const path = `${req.userData.cliente_id}/perfil/${req.userData.id}/${Date.now()}.${ext}`;

    const supabase = requireSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

    return res.json({ url: urlData.publicUrl, path });
  } catch (err) {
    console.error('Profile photo upload error:', err);
    return res.status(500).json({ error: err.message || 'Erro no upload da foto' });
  }
});

router.post('/delete', requireAuth, async (req, res) => {
  try {
    const { path, bucket = 'produtos', produtoId } = req.body;

    if (!path) {
      return res.status(400).json({ error: 'path é obrigatório' });
    }

    if (produtoId) {
      const owns = await verifyProductOwnership(produtoId, req.userData.cliente_id);
      if (!owns) {
        return res.status(403).json({ error: 'Produto não pertence ao seu tenant' });
      }
    } else if (!path.startsWith(`${req.userData.cliente_id}/`)) {
      return res.status(403).json({ error: 'Sem permissão para excluir este arquivo' });
    }

    const supabase = requireSupabaseAdmin();
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw error;

    return res.json({ ok: true });
  } catch (err) {
    console.error('Storage delete error:', err);
    return res.status(500).json({ error: err.message || 'Erro ao excluir arquivo' });
  }
});

export default router;
