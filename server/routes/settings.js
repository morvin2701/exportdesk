const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const KEYS = ['company', 'branding', 'numbering', 'defaults', 'banks', 'terms'];
const MAX_IMAGE_CHARS = 2_800_000; // ~2MB base64 per image

const DEFAULTS = require('../defaults');

router.get('/', async (req, res) => {
  try {
    const out = {};
    for (const k of KEYS) {
      const v = await db.getSetting(k);
      out[k] = Array.isArray(DEFAULTS[k]) ? (Array.isArray(v) ? v : DEFAULTS[k]) : { ...DEFAULTS[k], ...(v || {}) };
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    for (const k of KEYS) {
      if (body[k] === undefined) continue;
      let value = body[k];
      if (k === 'branding') {
        for (const img of ['logo', 'stamp', 'signature']) {
          if (value[img] && String(value[img]).length > MAX_IMAGE_CHARS) {
            return res.status(400).json({ error: `The ${img} image is too large. Please use an image under 2MB.` });
          }
          if (value[img] && !/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(String(value[img]))) {
            return res.status(400).json({ error: `The ${img} must be a PNG, JPG, WEBP or SVG image.` });
          }
        }
      }
      if (k === 'banks' && !Array.isArray(value)) value = [];
      await db.setSetting(k, value);
    }
    await db.log(req.user.id, 'update', 'settings', null, Object.keys(body).join(','));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
