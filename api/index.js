// api/index.js
// Servidor Calmward: IA Groq + Auth con PostgreSQL + Comunidad anónima
// + PayPal Subscriptions reales + Webhook
// Planes: sponsor_monthly, sponsor_yearly, premium_monthly, premium_yearly
// Soporta Premium + Sponsor simultáneos con fechas separadas

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

// Polyfill de fetch para Node (Render)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ===================== CONFIG DB (PostgreSQL) =====================

const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

if (!DATABASE_URL) {
  console.warn(
    "[Calmward API] WARNING: No hay DATABASE_URL. Auth real y comunidad NO funcionarán."
  );
} else {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

// Crea/actualiza tablas
async function ensureSchema() {
  if (!pool) return;

  const sql = `
    -- Tabla usuarios
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS community_banned BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

    -- Suscripciones legacy
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS subscription_type TEXT;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS subscription_valid_until TIMESTAMPTZ;

    -- NUEVO: fechas separadas
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS premium_valid_until TIMESTAMPTZ;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS sponsor_valid_until TIMESTAMPTZ;

    -- Sesiones
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Posts de comunidad
    CREATE TABLE IF NOT EXISTS community_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Marca de patrocinio en posts
    ALTER TABLE community_posts
      ADD COLUMN IF NOT EXISTS is_sponsored BOOLEAN NOT NULL DEFAULT FALSE;

    -- Toxicidad posts
    ALTER TABLE community_posts
      ADD COLUMN IF NOT EXISTS toxicity_label TEXT;

    ALTER TABLE community_posts
      ADD COLUMN IF NOT EXISTS toxicity_score REAL;

    ALTER TABLE community_posts
      ADD COLUMN IF NOT EXISTS flagged_toxic BOOLEAN NOT NULL DEFAULT FALSE;

    -- Likes
    CREATE TABLE IF NOT EXISTS community_likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (post_id, user_id)
    );

    -- Comentarios
    CREATE TABLE IF NOT EXISTS community_comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Toxicidad comentarios
    ALTER TABLE community_comments
      ADD COLUMN IF NOT EXISTS toxicity_label TEXT;

    ALTER TABLE community_comments
      ADD COLUMN IF NOT EXISTS toxicity_score REAL;

    ALTER TABLE community_comments
      ADD COLUMN IF NOT EXISTS flagged_toxic BOOLEAN NOT NULL DEFAULT FALSE;

    -- Registro local de suscripciones PayPal
    CREATE TABLE IF NOT EXISTS paypal_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      plan_key TEXT NOT NULL,
      paypal_subscription_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Anuncios patrocinados (carrusel Inicio)
    CREATE TABLE IF NOT EXISTS sponsor_ads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand_name TEXT NOT NULL,
      tagline TEXT,
      description TEXT,
      cta TEXT,
      url TEXT,
      image_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- NUEVO: columna cta_label para alinearse con el SELECT a.cta_label
    ALTER TABLE sponsor_ads
      ADD COLUMN IF NOT EXISTS cta_label TEXT DEFAULT 'Ver más';

    CREATE UNIQUE INDEX IF NOT EXISTS sponsor_ads_user_id_idx
      ON sponsor_ads(user_id);
  `;

  try {
    await pool.query(sql);

    // Migración suave: si hay legacy subscription_valid_until,
    // lo copiamos a las columnas nuevas solo si están vacías.
    await pool.query(`
      UPDATE users
      SET
        premium_valid_until = COALESCE(premium_valid_until, subscription_valid_until),
        sponsor_valid_until = COALESCE(sponsor_valid_until, subscription_valid_until)
      WHERE subscription_valid_until IS NOT NULL
    `);

    console.log(
      "[Calmward API] Esquema OK (users, sessions, comunidad, billing, sponsor_ads)."
    );

    // Asegura que tu cuenta principal sea admin
    await pool.query(
      `
        UPDATE users
        SET is_admin = TRUE
        WHERE LOWER(email) = 'calmward.contact@gmail.com'
      `
    );
    console.log(
      "[Calmward API] Usuario calmward.contact@gmail.com marcado como admin (si existe)."
    );
  } catch (err) {
    console.error("[Calmward API] Error creando esquema:", err);
  }
}

if (pool) {
  ensureSchema().catch((e) =>
    console.error("[Calmward API] Error en ensureSchema:", e)
  );
}


// ===================== HELPERS GENERALES =====================

function randomToken() {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// ===================== CONFIG IA GROQ =====================

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

const SYSTEM_LISTEN = `
Eres Calmward, una IA de apoyo emocional centrada en ESCUCHAR y ACOMPAÑAR.
Hablas en español cercano, validas emociones, sin dar diagnósticos.
`;

const SYSTEM_HELP = `
Eres Calmward en modo "ayúdame a ordenar".
Ordenas lo que la persona siente y propones 1-2 pasos pequeños y realistas.
`;

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: typeof m?.content === "string" ? m.content : "",
    }))
    .filter((m) => m.content.trim().length > 0);
}

// ===================== HELPERS SESIÓN + BAN =====================

async function getUserFromToken(token) {
  if (!pool || !token) return null;

  const q = await pool.query(
    `
      SELECT
        u.id,
        u.email,
        u.is_sponsor,
        u.is_banned,
        u.community_banned,
        u.is_admin,
        u.is_premium,
        u.subscription_type,
        u.subscription_valid_until,
        u.premium_valid_until,
        u.sponsor_valid_until
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
      LIMIT 1
    `,
    [token]
  );

  if (q.rows.length === 0) return null;
  return q.rows[0];
}

function extractTokenFromRequest(req) {
  const auth = req.headers["authorization"];
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const alt = req.headers["x-session-token"];
  if (alt && typeof alt === "string") {
    return alt.trim();
  }
  return null;
}

async function getUserFromRequestOrThrow(req, res) {
  if (!pool) {
    res.status(500).json({ error: "No hay base de datos configurada." });
    return null;
  }

  const token = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: "Debes iniciar sesión." });
    return null;
  }

  try {
    const user = await getUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: "Sesión no válida o expirada." });
      return null;
    }

    if (user.is_banned) {
      res.status(403).json({
        error: "Tu cuenta ha sido bloqueada.",
      });
      return null;
    }

    return { user, token };
  } catch (err) {
    console.error("[Auth] Error:", err);
    res.status(500).json({ error: "Error interno validando sesión." });
    return null;
  }
}

function isToxicContent(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const badFragments = [
    "mierda",
    "puta",
    "gilipollas",
    "imbecil",
    "imbécil",
    "subnormal",
    "te voy a pegar",
    "te voy a hacer daño",
    "abusar de ti",
    "te manipulo",
  ];
  return badFragments.some((bad) => lower.includes(bad));
}

async function blockUserAndKillSessions(userId) {
  if (!pool || !userId) return;

  await pool.query(
    `UPDATE users SET community_banned = TRUE WHERE id = $1`,
    [userId]
  );
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);

  console.log(
    `[Comunidad] Usuario ${userId} bloqueado para Comunidad y sesiones cerradas.`
  );
}

// ===================== HELPERS DE SUSCRIPCIÓN =====================

function isPremiumActive(user) {
  if (!user || !user.is_premium) return false;
  const src = user.premium_valid_until || user.subscription_valid_until;
  if (!src) return true;
  const until = new Date(src).getTime();
  return Number.isFinite(until) && until > Date.now();
}

function isSponsorActive(user) {
  if (!user || !user.is_sponsor) return false;
  const src = user.sponsor_valid_until || user.subscription_valid_until;
  if (!src) return true;
  const until = new Date(src).getTime();
  return Number.isFinite(until) && until > Date.now();
}

// ===================== RUTA DE SALUD =====================

app.get("/", async (_req, res) => {
  let dbOk = false;
  if (pool) {
    try {
      await pool.query("SELECT 1");
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }

  res.json({
    ok: true,
    service: "calmward-api",
    provider: "groq",
    model: GROQ_MODEL,
    hasApiKey: !!GROQ_API_KEY,
    hasDatabase: !!pool,
    dbOk,
  });
});

// ===================== AUTH =====================

app.post("/auth/register-and-login", async (req, res) => {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error: "No hay base de datos configurada. Falta DATABASE_URL.",
      });
    }

    const { email, password } = req.body || {};
    const normEmail = normalizeEmail(email);
    const plainPass = String(password || "");

    if (!normEmail || !normEmail.includes("@")) {
      return res.status(400).json({ error: "Correo no válido." });
    }

    if (plainPass.length < 10) {
      return res.status(400).json({
        error: "La contraseña debe tener al menos 10 caracteres.",
      });
    }
    if (!/[A-ZÁÉÍÓÚÑ]/.test(plainPass)) {
      return res.status(400).json({
        error: "La contraseña debe incluir al menos una mayúscula.",
      });
    }

    const existing = await pool.query(
      `
        SELECT
          id, email, password_hash,
          is_sponsor, is_banned, community_banned, is_admin,
          is_premium, subscription_type,
          subscription_valid_until, premium_valid_until, sponsor_valid_until
        FROM users
        WHERE email = $1
      `,
      [normEmail]
    );

    let userRow;

    if (existing.rows.length > 0) {
      userRow = existing.rows[0];
      const ok = await bcrypt.compare(plainPass, userRow.password_hash);
      if (!ok) {
        return res
          .status(401)
          .json({ error: "Correo o contraseña incorrectos." });
      }
    } else {
      const hash = await bcrypt.hash(plainPass, 10);
      const inserted = await pool.query(
        `
          INSERT INTO users (email, password_hash)
          VALUES ($1, $2)
          RETURNING
            id, email, is_sponsor, is_banned, community_banned, is_admin,
            is_premium, subscription_type,
            subscription_valid_until, premium_valid_until, sponsor_valid_until
        `,
        [normEmail, hash]
      );
      userRow = inserted.rows[0];
    }

    const token = randomToken();
    await pool.query(
      "INSERT INTO sessions (user_id, token) VALUES ($1, $2)",
      [userRow.id, token]
    );

    return res.json({
      token,
      email: userRow.email,
      isSponsor: !!userRow.is_sponsor,
      isSponsorActive: isSponsorActive(userRow),
      isAdmin: !!userRow.is_admin,
      isPremium: !!userRow.is_premium,
      isPremiumActive: isPremiumActive(userRow),
      subscriptionType: userRow.subscription_type || null,
      subscriptionValidUntil: userRow.subscription_valid_until || null,
      premiumValidUntil: userRow.premium_valid_until || null,
      sponsorValidUntil: userRow.sponsor_valid_until || null,
    });
  } catch (err) {
    console.error("Error en /auth/register-and-login:", err);
    return res
      .status(500)
      .json({ error: "Problema al crear o iniciar sesión." });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error: "No hay base de datos configurada. Falta DATABASE_URL.",
      });
    }

    const { email, password } = req.body || {};
    const normEmail = normalizeEmail(email);
    const plainPass = String(password || "");

    if (!normEmail || !normEmail.includes("@") || !plainPass) {
      return res
        .status(400)
        .json({ error: "Debes indicar correo y contraseña." });
    }

    const q = await pool.query(
      `
        SELECT
          id, email, password_hash,
          is_sponsor, is_banned, community_banned, is_admin,
          is_premium, subscription_type,
          subscription_valid_until, premium_valid_until, sponsor_valid_until
        FROM users
        WHERE email = $1
      `,
      [normEmail]
    );

    if (q.rows.length === 0) {
      return res.status(401).json({
        error: "No existe ninguna cuenta con ese correo.",
      });
    }

    const userRow = q.rows[0];

    if (userRow.is_banned) {
      return res.status(403).json({ error: "Tu cuenta ha sido bloqueada." });
    }

    const ok = await bcrypt.compare(plainPass, userRow.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ error: "Correo o contraseña incorrectos." });
    }

    const token = randomToken();
    await pool.query(
      "INSERT INTO sessions (user_id, token) VALUES ($1, $2)",
      [userRow.id, token]
    );

    return res.json({
      token,
      email: userRow.email,
      isSponsor: !!userRow.is_sponsor,
      isSponsorActive: isSponsorActive(userRow),
      isAdmin: !!userRow.is_admin,
      isPremium: !!userRow.is_premium,
      isPremiumActive: isPremiumActive(userRow),
      subscriptionType: userRow.subscription_type || null,
      subscriptionValidUntil: userRow.subscription_valid_until || null,
      premiumValidUntil: userRow.premium_valid_until || null,
      sponsorValidUntil: userRow.sponsor_valid_until || null,
    });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    return res.status(500).json({ error: "Problema al iniciar sesión." });
  }
});

// ===================== COMUNIDAD =====================

app.post("/community/posts", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const { user } = auth;

    if (user.community_banned) {
      return res.status(403).json({
        error: "Tu cuenta ha sido bloqueada para la zona Comunidad.",
      });
    }

    let { text, sponsored } = req.body || {};
    text = typeof text === "string" ? text.trim() : "";
    sponsored = !!sponsored;

    if (!text || text.length < 3) {
      return res.status(400).json({ error: "El post es demasiado corto." });
    }

    if (sponsored && !isSponsorActive(user)) {
      return res.status(403).json({
        error: "Este tipo de publicación requiere Calmward Sponsor.",
      });
    }

    if (isToxicContent(text)) {
      await blockUserAndKillSessions(user.id);
      return res.status(403).json({
        error: "Tu cuenta ha sido bloqueada para la zona Comunidad por normas.",
      });
    }

    const insert = await pool.query(
      `
        INSERT INTO community_posts (user_id, body, is_sponsored)
        VALUES ($1, $2, $3)
        RETURNING id, body, created_at, is_sponsored
      `,
      [user.id, text, sponsored]
    );

    const row = insert.rows[0];

    return res.json({
      ok: true,
      post: {
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        isSponsored: !!row.is_sponsored,
        likeCount: 0,
        commentCount: 0,
      },
    });
  } catch (err) {
    console.error("Error en POST /community/posts:", err);
    return res.status(500).json({ error: "Error interno al crear el post." });
  }
});

app.get("/community/posts", async (_req, res) => {
  try {
    const limit = 50;

    const result = await pool.query(
      `
        SELECT p.id,
               p.body,
               p.created_at,
               p.is_sponsored,
               COALESCE(l.cnt, 0) AS like_count,
               COALESCE(c.cnt, 0) AS comment_count
        FROM community_posts p
        LEFT JOIN (
          SELECT post_id, COUNT(*)::int AS cnt
          FROM community_likes
          GROUP BY post_id
        ) l ON l.post_id = p.id
        LEFT JOIN (
          SELECT post_id, COUNT(*)::int AS cnt
          FROM community_comments
          GROUP BY post_id
        ) c ON c.post_id = p.id
        ORDER BY p.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      isSponsored: !!row.is_sponsored,
      likeCount: row.like_count,
      commentCount: row.comment_count,
    }));

    return res.json({ ok: true, posts });
  } catch (err) {
    console.error("Error en GET /community/posts:", err);
    return res.status(500).json({ error: "Error interno al listar posts." });
  }
});

app.post("/community/posts/:id/like", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const { user } = auth;

    if (user.community_banned) {
      return res
        .status(403)
        .json({ error: "Tu cuenta está bloqueada en Comunidad." });
    }

    const postId = parseInt(req.params.id, 10);
    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ error: "ID de post inválido." });
    }

    const existingLike = await pool.query(
      `SELECT id FROM community_likes WHERE post_id = $1 AND user_id = $2`,
      [postId, user.id]
    );

    let liked;

    if (existingLike.rows.length > 0) {
      await pool.query("DELETE FROM community_likes WHERE id = $1", [
        existingLike.rows[0].id,
      ]);
      liked = false;
    } else {
      await pool.query(
        `INSERT INTO community_likes (post_id, user_id) VALUES ($1, $2)`,
        [postId, user.id]
      );
      liked = true;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM community_likes WHERE post_id = $1`,
      [postId]
    );

    return res.json({ ok: true, liked, likeCount: countRes.rows[0]?.c ?? 0 });
  } catch (err) {
    console.error("Error en like:", err);
    return res.status(500).json({ error: "Error interno al registrar like." });
  }
});

app.post("/community/posts/:id/comments", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const { user } = auth;

    if (user.community_banned) {
      return res
        .status(403)
        .json({ error: "Tu cuenta está bloqueada en Comunidad." });
    }

    const postId = parseInt(req.params.id, 10);
    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ error: "ID de post inválido." });
    }

    let { text } = req.body || {};
    text = typeof text === "string" ? text.trim() : "";

    if (!text || text.length < 2) {
      return res.status(400).json({ error: "El comentario es demasiado corto." });
    }

    if (isToxicContent(text)) {
      await blockUserAndKillSessions(user.id);
      return res.status(403).json({
        error: "Tu cuenta ha sido bloqueada para Comunidad por normas.",
      });
    }

    const insert = await pool.query(
      `
        INSERT INTO community_comments (post_id, user_id, body)
        VALUES ($1, $2, $3)
        RETURNING id, body, created_at
      `,
      [postId, user.id, text]
    );

    const row = insert.rows[0];

    return res.json({
      ok: true,
      comment: { id: row.id, postId, body: row.body, createdAt: row.created_at },
    });
  } catch (err) {
    console.error("Error en comment:", err);
    return res.status(500).json({ error: "Error interno al comentar." });
  }
});

app.get("/community/posts/:id/comments", async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ error: "ID de post inválido." });
    }

    const result = await pool.query(
      `
        SELECT id, body, created_at
        FROM community_comments
        WHERE post_id = $1
        ORDER BY created_at ASC
      `,
      [postId]
    );

    const comments = result.rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
    }));

    return res.json({ ok: true, comments });
  } catch (err) {
    console.error("Error listando comments:", err);
    return res.status(500).json({ error: "Error interno al listar comentarios." });
  }
});

// ===================== IA =====================

app.post("/ai/talk", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;

    if (!GROQ_API_KEY) {
      return res.status(500).json({
        error: "Falta GROQ_API_KEY en el servidor. Configúrala en Render.",
      });
    }

    const { message, mode = "solo_escuchame", history = [] } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Falta 'message'." });
    }

    if (mode === "ayudame_a_ordenar" && !isPremiumActive(auth.user)) {
      return res.status(403).json({
        error: "Esta función requiere Calmward Premium.",
      });
    }

    const systemPrompt =
      mode === "ayudame_a_ordenar" ? SYSTEM_HELP : SYSTEM_LISTEN;

    const chatHistory = normalizeHistory(history);

    const messages = [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: message },
    ];

    const payload = { model: GROQ_MODEL, messages, temperature: 0.7 };

    const groqRes = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!groqRes.ok) {
      const text = await groqRes.text().catch(() => "");
      console.error("Error Groq:", groqRes.status, text);
      return res.status(500).json({
        error: "No se pudo obtener respuesta de Calmward (Groq).",
        status: groqRes.status,
      });
    }

    const data = await groqRes.json().catch(() => ({}));
    const replyText =
      data?.choices?.[0]?.message?.content ??
      "No he podido generar una respuesta ahora mismo.";

    return res.json({ reply: replyText });
  } catch (err) {
    console.error("Error en /ai/talk:", err);
    return res.status(500).json({ error: "Problema al hablar con el modelo." });
  }
});

/* ================= ADMIN PANEL ================= */

function isAdminUser(u) {
  if (!u) return false;
  if (u.is_admin) return true;
  const email = String(u.email || "").trim().toLowerCase();
  return email === "calmward.contact@gmail.com";
}

app.get("/admin/users", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return res.status(403).json({ error: "No autorizado." });
  }

  const q = await pool.query(
    `
      SELECT
        id, email,
        is_banned, community_banned, is_admin,
        is_sponsor, is_premium,
        subscription_type,
        subscription_valid_until,
        premium_valid_until,
        sponsor_valid_until,
        created_at
      FROM users
      ORDER BY id DESC
    `
  );
  res.json({ users: q.rows });
});

/**
 * PATCH /admin/users/:id
 * Permite al admin modificar flags de cualquier usuario:
 * - is_admin
 * - is_sponsor
 * - is_premium
 * - is_banned
 * - community_banned
 *
 * Devuelve el usuario actualizado en { ok: true, user: {...} }
 */
app.patch("/admin/users/:id", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    if (!isAdminUser(auth.user)) {
      return res.status(403).json({ error: "No autorizado." });
    }

    const userId = parseInt(req.params.id, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ error: "ID de usuario inválido." });
    }

    const body = req.body || {};

    function toBool(v) {
      return v === true || v === "true" || v === 1 || v === "1";
    }

    const allowedKeys = [
      "is_admin",
      "is_sponsor",
      "is_premium",
      "is_banned",
      "community_banned",
    ];

    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(toBool(body[key]));
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        error:
          "No se ha enviado ningún campo modificable. Usa is_admin, is_sponsor, is_premium, is_banned o community_banned.",
      });
    }

    values.push(userId);

    const q = await pool.query(
      `
        UPDATE users
        SET ${setClauses.join(", ")}
        WHERE id = $${idx}
        RETURNING
          id, email,
          is_banned, community_banned, is_admin,
          is_sponsor, is_premium,
          subscription_type,
          subscription_valid_until,
          premium_valid_until,
          sponsor_valid_until,
          created_at
      `,
      values
    );

    if (!q.rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    return res.json({ ok: true, user: q.rows[0] });
  } catch (err) {
    console.error("Error en PATCH /admin/users/:id", err);
    return res
      .status(500)
      .json({ error: "No se ha podido actualizar el usuario." });
  }
});

app.get("/admin/posts", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return res.status(403).json({ error: "No autorizado." });
  }

  const q = await pool.query(
    `SELECT p.id, p.body, p.created_at, p.flagged_toxic, p.is_sponsored, p.user_id, u.email
     FROM community_posts p
     LEFT JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC`
  );
  res.json({ posts: q.rows });
});

app.post("/admin/ban/:id", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return res.status(403).json({ error: "No autorizado." });
  }

  await pool.query("UPDATE users SET community_banned = TRUE WHERE id = $1", [
    req.params.id,
  ]);
  res.json({ ok: true });
});

app.post("/admin/unban/:id", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return res.status(403).json({ error: "No autorizado." });
  }

  await pool.query("UPDATE users SET community_banned = FALSE WHERE id = $1", [
    req.params.id,
  ]);
  res.json({ ok: true });
});

app.delete("/admin/posts/:id", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return res.status(403).json({ error: "No autorizado." });
  }

  await pool.query("DELETE FROM community_posts WHERE id = $1", [
    req.params.id,
  ]);
  res.json({ ok: true });
});

/* ================= BILLING / PAYPAL (SUBSCRIPTIONS + WEBHOOK) ================= */

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_ENV = (process.env.PAYPAL_ENV || "live").toLowerCase();

const PAYPAL_API_BASE =
  PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const PAYPAL_WEBHOOK_ID =
  process.env.PAYPAL_WEBHOOK_ID || "7LE24430DE7608012";

const PAYPAL_RETURN_URL =
  process.env.PAYPAL_RETURN_URL || "https://example.com/paypal-success";
const PAYPAL_CANCEL_URL =
  process.env.PAYPAL_CANCEL_URL || "https://example.com/paypal-cancel";

const PLAN_CATALOG = {
  sponsor_monthly: { price: "3.99", label: "Patrocinio Calmward (mensual)" },
  sponsor_yearly: { price: "39.00", label: "Patrocinio Calmward (anual)" },
  premium_monthly: { price: "1.99", label: "Calmward Premium (mensual)" },
  premium_yearly: { price: "19.00", label: "Calmward Premium (anual)" },
};

const PLAN_ID_MAP = {
  sponsor_monthly:
    process.env.PAYPAL_PLAN_SPONSOR_MONTHLY ||
    process.env.PAYPAL_PLAN_SPONSOR_MENSUAL ||
    "",
  sponsor_yearly:
    process.env.PAYPAL_PLAN_SPONSOR_YEARLY ||
    process.env.PAYPAL_PLAN_SPONSOR_ANNUAL ||
    "",
  premium_monthly:
    process.env.PAYPAL_PLAN_PREMIUM_MONTHLY ||
    process.env.PAYPAL_PLAN_PREMIUM_MENSUAL ||
    "",
  premium_yearly:
    process.env.PAYPAL_PLAN_PREMIUM_YEARLY ||
    process.env.PAYPAL_PLAN_PREMIUM_ANNUAL ||
    "",
};

async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal no está configurado.");
  }

  const basic = Buffer.from(
    PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET
  ).toString("base64");

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Error token PayPal:", res.status, text);
    throw new Error("No se pudo obtener token de PayPal.");
  }

  const data = await res.json();
  return data.access_token;
}

function computeValidUntil(planKey) {
  const now = new Date();
  const d = new Date(now.getTime());

  if (String(planKey).endsWith("_monthly")) {
    d.setMonth(d.getMonth() + 1);
  } else if (String(planKey).endsWith("_yearly")) {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }

  return d;
}

/* ================= SPONSOR ADS (CARRUSEL DE ANUNCIOS) ================= */

// Anuncios visibles en el carrusel de Inicio
// - Solo anuncios marcados como is_active = TRUE
// - Solo usuarios con patrocinio activo (is_sponsor + sponsor_valid_until)
app.get("/sponsor/ads", async (_req, res) => {
  if (!pool) {
    // Sin DB devolvemos lista vacía para no romper el front
    return res.json({ ads: [] });
  }

  try {
    const q = await pool.query(
      `
      SELECT
        a.id,
        a.brand_name,
        a.tagline,
        a.description,
        a.cta,
        a.url,
        a.image_url,
        a.is_active,
        a.updated_at,
        u.is_sponsor,
        u.sponsor_valid_until
      FROM sponsor_ads a
      JOIN users u ON u.id = a.user_id
      WHERE a.is_active = TRUE
        AND u.is_sponsor = TRUE
        AND (
          u.sponsor_valid_until IS NULL
          OR u.sponsor_valid_until > NOW()
        )
      ORDER BY a.updated_at DESC
      LIMIT 50
      `
    );

    // Adaptamos al formato que espera el front:
    // { id, name, tagline, description, cta, url, imageUrl }
    const items = (q.rows || []).map((row) => ({
      id: row.id,
      name: row.brand_name,
      tagline: row.tagline,
      description: row.description,
      cta: row.cta,
      url: row.url,
      imageUrl: row.image_url,
    }));

    return res.json({ ads: items });
  } catch (err) {
    console.error("Error en /sponsor/ads:", err);
    return res
      .status(500)
      .json({ error: "No se han podido cargar los anuncios." });
  }
});

// Devuelve el anuncio del usuario actual (si es sponsor activo)
app.get("/sponsor/my-ad", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;

  if (!isSponsorActive(auth.user)) {
    return res.status(403).json({
      error: "Necesitas tener un patrocinio activo para gestionar tu anuncio.",
    });
  }

  try {
    const q = await pool.query(
      `
      SELECT
        id,
        brand_name,
        tagline,
        description,
        cta,
        url,
        image_url,
        is_active
      FROM sponsor_ads
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [auth.user.id]
    );

    if (!q.rows.length) {
      return res.json({ ad: null });
    }

    const row = q.rows[0];
    return res.json({
      ad: {
        id: row.id,
        brandName: row.brand_name,
        tagline: row.tagline,
        description: row.description,
        ctaLabel: row.cta,
        targetUrl: row.url,
        imageUrl: row.image_url,
        isActive: row.is_active,
      },
    });
  } catch (err) {
    console.error("Error en /sponsor/my-ad:", err);
    return res
      .status(500)
      .json({ error: "No se ha podido cargar tu anuncio." });
  }
});

// Crea o actualiza el anuncio del usuario sponsor.
// - El usuario sponsor puede editar los datos (texto, imagen, url).
// - La ACTIVACIÓN la dejamos en manos del admin: por defecto is_active = false,
//   salvo que el usuario actual sea admin.
app.post("/sponsor/my-ad", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;

  if (!isSponsorActive(auth.user)) {
    return res.status(403).json({
      error:
        "Necesitas tener un patrocinio activo para crear o modificar tu anuncio.",
    });
  }

  const {
    brandName,
    tagline,
    description,
    ctaLabel,
    targetUrl,
    imageUrl,
    isActive,
  } = req.body || {};

  const bName = String(brandName || "").trim();
  const tag = String(tagline || "").trim();
  const desc = String(description || "").trim();
  const cta = String(ctaLabel || "").trim() || "Más información";
  const url = String(targetUrl || "").trim();
  const img = String(imageUrl || "").trim();

  // Solo un admin puede activar directamente el anuncio
  const isAdmin = !!auth.user.is_admin;
  const active = isAdmin && isActive === true ? true : false;

  if (!bName || !desc) {
    return res.status(400).json({
      error:
        "Faltan datos obligatorios: al menos nombre de marca y descripción.",
    });
  }

  try {
    const existing = await pool.query(
      `
      SELECT id
      FROM sponsor_ads
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [auth.user.id]
    );

    let adId;

    if (existing.rows.length) {
      adId = existing.rows[0].id;
      await pool.query(
        `
        UPDATE sponsor_ads
        SET
          brand_name = $1,
          tagline = $2,
          description = $3,
          cta = $4,
          url = $5,
          image_url = $6,
          is_active = $7,
          updated_at = NOW()
        WHERE id = $8
        `,
        [bName, tag, desc, cta, url, img, active, adId]
      );
    } else {
      const insert = await pool.query(
        `
        INSERT INTO sponsor_ads
          (user_id, brand_name, tagline, description, cta, url, image_url, is_active)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        `,
        [auth.user.id, bName, tag, desc, cta, url, img, active]
      );
      adId = insert.rows[0].id;
    }

    return res.json({
      ok: true,
      id: adId,
      isActive: active,
      note: isAdmin
        ? "Anuncio actualizado. Activación aplicada por admin."
        : "Anuncio guardado. Debe ser aprobado por un administrador para mostrarse en el carrusel.",
    });
  } catch (err) {
    console.error("Error en POST /sponsor/my-ad:", err);
    return res
      .status(500)
      .json({ error: "No se ha podido guardar tu anuncio." });
  }
});

// Lista anuncios pendientes (is_active = FALSE) con datos básicos
app.get("/admin/sponsor/pending", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;
  if (!auth.user.is_admin) {
    return res
      .status(403)
      .json({ error: "Solo un administrador puede ver esto." });
  }

  try {
    const q = await pool.query(
      `
      SELECT
        a.id,
        a.brand_name,
        a.tagline,
        a.description,
        a.cta,
        a.url,
        a.image_url,
        a.created_at,
        u.email AS user_email
      FROM sponsor_ads a
      JOIN users u ON u.id = a.user_id
      WHERE a.is_active = FALSE
      ORDER BY a.created_at DESC
      `
    );

    return res.json({ pending: q.rows || [] });
  } catch (err) {
    console.error("Error en /admin/sponsor/pending:", err);
    return res
      .status(500)
      .json({ error: "No se han podido cargar los anuncios pendientes." });
  }
});

// Aprueba o desactiva un anuncio concreto
app.post("/admin/sponsor/set-status", async (req, res) => {
  const auth = await getUserFromRequestOrThrow(req, res);
  if (!auth) return;
  if (!auth.user.is_admin) {
    return res
      .status(403)
      .json({ error: "Solo un administrador puede cambiar el estado." });
  }

  const { adId, status } = req.body || {};
  const idNum = Number(adId);

  if (!idNum || !status) {
    return res.status(400).json({ error: "Faltan adId o status." });
  }

  const isActive = status === "approved";

  try {
    await pool.query(
      `
      UPDATE sponsor_ads
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [isActive, idNum]
    );

    return res.json({ ok: true, adId: idNum, isActive });
  } catch (err) {
    console.error("Error en /admin/sponsor/set-status:", err);
    return res
      .status(500)
      .json({ error: "No se ha podido actualizar el estado del anuncio." });
  }
});

// ===================== ARRANQUE =====================

app.listen(PORT, () => {
  console.log(`Calmward API escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
  console.log(`? DB: ${DATABASE_URL ? "conectada" : "NO CONFIGURADA"}`);
  console.log(
    `? PayPal: ${
      PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET
        ? `configurado en modo ${process.env.PAYPAL_ENV || "live"}`
        : "NO CONFIGURADO"
    }`
  );
});
