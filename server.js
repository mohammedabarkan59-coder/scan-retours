/**
 * Scan Retours — serveur
 * Express + PostgreSQL. Stocke code-barres, format, date/heure et photo (bytea).
 * Variables d'environnement attendues :
 *   DATABASE_URL  (fourni automatiquement par le module PostgreSQL de Railway)
 *   PORT          (fourni automatiquement par Railway ; 3000 en local par défaut)
 *   PGSSL=true    (uniquement si tu te connectes via l'URL PUBLIQUE de la base)
 */
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Connexion PostgreSQL ----
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('⚠️  DATABASE_URL absent — définis-le (Railway le fournit automatiquement avec le module PostgreSQL).');
}
const useSSL = process.env.PGSSL === 'true' || /sslmode=require/.test(connectionString || '');
const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 5,
});

// ---- Initialisation de la table (avec quelques tentatives, la base peut démarrer après le serveur) ----
async function initDb(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scans (
          id          BIGSERIAL PRIMARY KEY,
          code        TEXT        NOT NULL,
          code_norm   TEXT        NOT NULL,
          format      TEXT,
          scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          image       BYTEA       NOT NULL,
          image_mime  TEXT        NOT NULL DEFAULT 'image/jpeg'
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_scans_code_norm ON scans (code_norm);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans (scanned_at DESC);`);
      await pool.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS agence TEXT;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_scans_agence ON scans (agence);`);
      console.log('✅ Base prête.');
      return;
    } catch (e) {
      console.log(`Base pas encore disponible (tentative ${i + 1}/${retries})…`, e.code || e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('❌ Impossible d\'initialiser la base après plusieurs tentatives.');
}

// ---- Utilitaires ----
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function parseImage(dataUrl) {
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  if (m) return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
  return { mime: 'image/jpeg', buf: Buffer.from(String(dataUrl || ''), 'base64') };
}

// ---- Middlewares ----
app.use(express.json({ limit: '25mb' })); // les photos arrivent en base64 dans le JSON
app.use(express.static(path.join(__dirname, 'public')));

// ---- API ----

// Créer un colis (code + format + photo)
app.post('/api/scans', async (req, res) => {
  try {
    const { code, format, image, scanned_at, agence } = req.body || {};
    if (!code || !image) return res.status(400).json({ error: 'code et image requis' });
    const { mime, buf } = parseImage(image);
    if (!buf.length) return res.status(400).json({ error: 'image vide' });
    const when = scanned_at ? new Date(scanned_at) : new Date();
    const r = await pool.query(
      `INSERT INTO scans (code, code_norm, format, agence, scanned_at, image, image_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, code, format, agence, scanned_at`,
      [String(code).trim(), norm(code), format || null, (agence || '').trim() || null, when, buf, mime]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error('POST /api/scans', e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

// Lister / rechercher (renvoie les métadonnées, pas les octets de l'image)
app.get('/api/scans', async (req, res) => {
  try {
    const q = norm(req.query.q);
    const agence = (req.query.agence || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const totalR = await pool.query('SELECT COUNT(*)::int AS n FROM scans');
    const total = totalR.rows[0].n;

    const where = [], params = [];
    if (q)      { params.push(q);      where.push(`code_norm LIKE '%' || $${params.length} || '%'`); }
    if (agence) { params.push(agence); where.push(`agence = $${params.length}`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    params.push(limit);
    const r = await pool.query(
      `SELECT id, code, format, agence, scanned_at FROM scans
       ${whereSql} ORDER BY scanned_at DESC LIMIT $${params.length}`, params);

    res.json({ total, items: r.rows });
  } catch (e) {
    console.error('GET /api/scans', e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

// Récupérer la photo d'un colis
app.get('/api/scans/:id/image', async (req, res) => {
  try {
    const r = await pool.query('SELECT image, image_mime FROM scans WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).end();
    res.set('Content-Type', r.rows[0].image_mime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(r.rows[0].image);
  } catch (e) {
    console.error('GET image', e);
    res.status(500).end();
  }
});

// Corriger le code d'un colis
app.put('/api/scans/:id', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'code requis' });
    const r = await pool.query(
      `UPDATE scans SET code=$1, code_norm=$2 WHERE id=$3
       RETURNING id, code, format, agence, scanned_at`,
      [String(code).trim(), norm(code), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'introuvable' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PUT /api/scans/:id', e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

// Supprimer un colis
app.delete('/api/scans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM scans WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/scans/:id', e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

// Tout effacer
app.delete('/api/scans', async (_req, res) => {
  try {
    await pool.query('TRUNCATE scans RESTART IDENTITY');
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE all', e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

// Export CSV
app.get('/api/export.csv', async (_req, res) => {
  try {
    const r = await pool.query('SELECT code, format, agence, scanned_at, id FROM scans ORDER BY scanned_at DESC');
    let csv = '\uFEFFCode;Agence;Format;Date;Heure;ID\r\n';
    for (const row of r.rows) {
      const d = new Date(row.scanned_at);
      const p = n => String(n).padStart(2, '0');
      const date = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
      const heure = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      csv += `"${(row.code || '').replace(/"/g, '""')}";"${(row.agence || '').replace(/"/g, '""')}";"${row.format || ''}";"${date}";"${heure}";"${row.id}"\r\n`;
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="colis_retours_${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error('export.csv', e);
    res.status(500).end();
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

initDb().finally(() => {
  app.listen(PORT, () => console.log(`🚀 Scan Retours sur le port ${PORT}`));
});
