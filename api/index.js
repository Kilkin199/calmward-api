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
        return res.status(401).json({ error: "Correo o contraseña incorrectos." });
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
    return res.status(500).json({ error: "Problema al crear o iniciar sesión." });
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
      return res.status(400).json({ error: "Debes indicar correo y contraseña." });
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
      return res.status(401).json({ error: "No existe ninguna cuenta con ese correo." });
    }

    const userRow = q.rows[0];

    if (userRow.is_banned) {
      return res.status(403).json({ error: "Tu cuenta ha sido bloqueada." });
    }

    const ok = await bcrypt.compare(plainPass, userRow.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
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
      return res.status(403).json({ error: "Tu cuenta está bloqueada en Comunidad." });
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
      return res.status(403).json({ error: "Tu cuenta está bloqueada en Comunidad." });
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

    if (mode === "ayudame_a_ordenar") {
      const auth = await getUserFromRequestOrThrow(req, res);
      if (!auth) return;

      if (!isPremiumActive(auth.user)) {
        return res.status(403).json({
          error: "Esta función requiere Calmward Premium.",
        });
      }
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

    // helper para normalizar booleanos
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

/* ================= SPONSOR ADS (CARRUSEL) ================= */

// Anuncios que se mostrarán en el carrusel de Inicio
app.get("/sponsors/ads", async (_req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "Base de datos no disponible." });
    }

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
          a.created_at,
          a.updated_at,
          u.id AS user_id,
          u.email,
          u.is_sponsor
        FROM sponsor_ads a
        JOIN users u ON u.id = a.user_id
        WHERE a.is_active = TRUE
          AND u.is_sponsor = TRUE
        ORDER BY a.created_at DESC
      `
    );

    const ads = q.rows || [];
    return res.json({ ok: true, ads });
  } catch (err) {
    console.error("Error en GET /sponsors/ads", err);
    return res
      .status(500)
      .json({ error: "No se han podido cargar los anuncios patrocinados." });
  }
});

// Ver anuncio del patrocinador logueado
app.get("/sponsors/my-ad", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const u = auth.user;

    if (!u.is_sponsor) {
      return res.status(403).json({
        error:
          "Tu cuenta no tiene patrocinio activo. Contrata un plan de patrocinio para crear tu anuncio.",
      });
    }

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
          is_active,
          created_at,
          updated_at
        FROM sponsor_ads
        WHERE user_id = $1
        LIMIT 1
      `,
      [u.id]
    );

    if (!q.rows.length) {
      return res.json({ ok: true, ad: null });
    }

    return res.json({ ok: true, ad: q.rows[0] });
  } catch (err) {
    console.error("Error en GET /sponsors/my-ad", err);
    return res
      .status(500)
      .json({ error: "No se ha podido cargar tu anuncio." });
  }
});

// Crear / actualizar anuncio del patrocinador logueado
app.post("/sponsors/my-ad", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const u = auth.user;

    if (!u.is_sponsor) {
      return res.status(403).json({
        error:
          "Tu cuenta no tiene patrocinio activo. Contrata un plan de patrocinio para crear tu anuncio.",
      });
    }

    if (!pool) {
      return res.status(500).json({ error: "Base de datos no disponible." });
    }

    const body = req.body || {};
    const brandName = String(body.brandName || body.brand_name || "").trim();
    const tagline = String(body.tagline || "").trim();
    const description = String(body.description || "").trim();
    const cta = String(body.cta || "").trim();
    const url = String(body.url || "").trim();
    const imageUrl = String(body.imageUrl || body.image_url || "").trim();
    const isActive =
      body.isActive === false || body.is_active === false ? false : true;

    if (!brandName || !url) {
      return res.status(400).json({
        error:
          "Faltan datos obligatorios. Indica al menos nombre de marca y URL de destino.",
      });
    }

    const q = await pool.query(
      `
        INSERT INTO sponsor_ads (
          user_id,
          brand_name,
          tagline,
          description,
          cta,
          url,
          image_url,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          brand_name = EXCLUDED.brand_name,
          tagline = EXCLUDED.tagline,
          description = EXCLUDED.description,
          cta = EXCLUDED.cta,
          url = EXCLUDED.url,
          image_url = EXCLUDED.image_url,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
        RETURNING
          id,
          brand_name,
          tagline,
          description,
          cta,
          url,
          image_url,
          is_active,
          created_at,
          updated_at
      `,
      [u.id, brandName, tagline, description, cta, url, imageUrl, isActive]
    );

    return res.json({ ok: true, ad: q.rows[0] });
  } catch (err) {
    console.error("Error en POST /sponsors/my-ad", err);
    return res
      .status(500)
      .json({ error: "No se ha podido guardar tu anuncio." });
  }
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

app.get("/billing/plans", async (_req, res) => {
  const plans = Object.keys(PLAN_CATALOG).map((k) => ({
    planKey: k,
    label: PLAN_CATALOG[k].label,
    price: PLAN_CATALOG[k].price,
    hasPlanId: !!PLAN_ID_MAP[k],
  }));

  res.json({ ok: true, env: PAYPAL_ENV, plans });
});

app.post("/billing/paypal/create-subscription", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;

    const { planKey } = req.body || {};
    const key = String(planKey || "").trim();

    if (!key || !PLAN_CATALOG[key]) {
      return res.status(400).json({
        error:
          "Plan inválido. Usa sponsor_monthly, sponsor_yearly, premium_monthly o premium_yearly.",
      });
    }

    const planId = PLAN_ID_MAP[key];
    if (!planId) {
      return res.status(500).json({
        error: "Falta plan_id en el servidor. Revisa PAYPAL_PLAN_* en Render.",
      });
    }

    const accessToken = await getPayPalAccessToken();

    const body = {
      plan_id: planId,
      custom_id: key,
      application_context: {
        brand_name: "Calmward",
        user_action: "SUBSCRIBE_NOW",
        return_url: PAYPAL_RETURN_URL,
        cancel_url: PAYPAL_CANCEL_URL,
      },
    };

    const subRes = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!subRes.ok) {
      const text = await subRes.text().catch(() => "");
      console.error("Error creando Subscription:", subRes.status, text);
      return res.status(500).json({
        error: "No se ha podido crear la suscripción en PayPal.",
      });
    }

    const subData = await subRes.json().catch(() => ({}));
    const approveLink =
      (subData.links || []).find((l) => l.rel === "approve") || null;

    if (pool && subData.id) {
      await pool.query(
        `
          INSERT INTO paypal_subscriptions (user_id, plan_key, paypal_subscription_id, status)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (paypal_subscription_id) DO NOTHING
        `,
        [auth.user.id, key, subData.id, subData.status || "CREATED"]
      );
    }

    return res.json({
      ok: true,
      subscriptionId: subData.id || null,
      status: subData.status || null,
      approveUrl: approveLink ? approveLink.href : null,
      planKey: key,
      label: PLAN_CATALOG[key].label,
      price: PLAN_CATALOG[key].price,
    });
  } catch (err) {
    console.error("Error en create-subscription:", err);
    return res.status(500).json({
      error: "No se ha podido iniciar la suscripción con PayPal.",
    });
  }
});

app.post("/billing/paypal/confirm-subscription", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;

    const { subscriptionId, planKey } = req.body || {};
    const subId = String(subscriptionId || "").trim();
    const key = String(planKey || "").trim();

    if (!subId || !key || !PLAN_CATALOG[key]) {
      return res.status(400).json({
        error: "Datos inválidos. Falta subscriptionId o planKey.",
      });
    }

    const accessToken = await getPayPalAccessToken();

    const getRes = await fetch(
      `${PAYPAL_API_BASE}/v1/billing/subscriptions/${subId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!getRes.ok) {
      const text = await getRes.text().catch(() => "");
      console.error("Error leyendo Subscription:", getRes.status, text);
      return res.status(500).json({
        error: "No se pudo verificar la suscripción en PayPal.",
      });
    }

    const subData = await getRes.json().catch(() => ({}));
    const status = String(subData.status || "");

    if (pool) {
      await pool.query(
        `
          UPDATE paypal_subscriptions
          SET status = $1, updated_at = NOW()
          WHERE paypal_subscription_id = $2
        `,
        [status || "PENDING", subId]
      );
    }

    if (status !== "ACTIVE") {
      return res.status(400).json({
        error: "La suscripción aún no está activa en PayPal.",
        status,
      });
    }

    const validUntil = computeValidUntil(key);
    const isSponsor = key.startsWith("sponsor_");
    const isPremium = key.startsWith("premium_");

    // Actualiza flags + última compra
    // y SOLO la fecha específica del rol
    await pool.query(
      `
        UPDATE users
        SET
          is_sponsor = CASE WHEN $2 THEN TRUE ELSE is_sponsor END,
          is_premium = CASE WHEN $3 THEN TRUE ELSE is_premium END,
          subscription_type = $4,
          premium_valid_until = CASE WHEN $3 THEN $5 ELSE premium_valid_until END,
          sponsor_valid_until = CASE WHEN $2 THEN $5 ELSE sponsor_valid_until END
        WHERE id = $1
      `,
      [auth.user.id, isSponsor, isPremium, key, validUntil.toISOString()]
    );

    return res.json({
      ok: true,
      planKey: key,
      label: PLAN_CATALOG[key].label,
      price: PLAN_CATALOG[key].price,
      paypalStatus: status,
      validUntil: validUntil.toISOString(),
      isSponsor,
      isPremium,
    });
  } catch (err) {
    console.error("Error en confirm-subscription:", err);
    return res.status(500).json({
      error: "No se ha podido confirmar la suscripción.",
    });
  }
});

app.get("/billing/subscription", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const u = auth.user;

    return res.json({
      ok: true,
      email: u.email,
      isSponsor: !!u.is_sponsor,
      isSponsorActive: isSponsorActive(u),
      isPremium: !!u.is_premium,
      isPremiumActive: isPremiumActive(u),
      subscriptionType: u.subscription_type || null,
      premiumValidUntil: u.premium_valid_until || null,
      sponsorValidUntil: u.sponsor_valid_until || null,
    });
  } catch (err) {
    console.error("Error en /billing/subscription:", err);
    return res.status(500).json({
      error: "No se pudo cargar la información de suscripción.",
    });
  }
});

// ===================== WEBHOOK PAYPAL =====================

async function verifyPayPalWebhookSignature(req) {
  if (!PAYPAL_WEBHOOK_ID) {
    console.warn("[PayPal Webhook] Falta PAYPAL_WEBHOOK_ID.");
    return false;
  }

  const transmissionId = req.headers["paypal-transmission-id"];
  const transmissionTime = req.headers["paypal-transmission-time"];
  const certUrl = req.headers["paypal-cert-url"];
  const authAlgo = req.headers["paypal-auth-algo"];
  const transmissionSig = req.headers["paypal-transmission-sig"];

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    console.warn("[PayPal Webhook] Faltan headers de verificación.");
    return false;
  }

  const accessToken = await getPayPalAccessToken();

  const body = {
    transmission_id: transmissionId,
    transmission_time: transmissionTime,
    cert_url: certUrl,
    auth_algo: authAlgo,
    transmission_sig: transmissionSig,
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: req.body,
  };

  const res = await fetch(
    `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[PayPal Webhook] Error verificando firma:", res.status, text);
    return false;
  }

  const data = await res.json().catch(() => ({}));
  return data.verification_status === "SUCCESS";
}

app.post("/webhooks/paypal", async (req, res) => {
  try {
    if (!pool) return res.status(200).json({ ok: true, ignored: "no_db" });

    const ok = await verifyPayPalWebhookSignature(req);
    if (!ok) {
      return res.status(400).json({ ok: false, error: "Invalid signature" });
    }

    const event = req.body || {};
    const type = String(event.event_type || "");
    const resource = event.resource || {};

    const subscriptionId = String(resource.id || "").trim();
    if (!subscriptionId) {
      return res.status(200).json({ ok: true, ignored: "no_subscription_id" });
    }

    const subQ = await pool.query(
      `
        SELECT user_id, plan_key
        FROM paypal_subscriptions
        WHERE paypal_subscription_id = $1
        LIMIT 1
      `,
      [subscriptionId]
    );

    if (subQ.rows.length === 0) {
      await pool.query(
        `
          INSERT INTO paypal_subscriptions (user_id, plan_key, paypal_subscription_id, status)
          VALUES (NULL, 'unknown', $1, $2)
          ON CONFLICT (paypal_subscription_id) DO UPDATE
          SET status = EXCLUDED.status, updated_at = NOW()
        `,
        [subscriptionId, type || "UNKNOWN"]
      );
      return res.status(200).json({ ok: true, noted: "unknown_local_sub" });
    }

    const { user_id, plan_key } = subQ.rows[0];
    const key = String(plan_key || "").trim();

    await pool.query(
      `
        UPDATE paypal_subscriptions
        SET status = $1, updated_at = NOW()
        WHERE paypal_subscription_id = $2
      `,
      [type || "UPDATED", subscriptionId]
    );

    if (!key || key === "unknown" || !user_id) {
      return res.status(200).json({ ok: true, updated: "status_only" });
    }

    const isSponsor = key.startsWith("sponsor_");
    const isPremium = key.startsWith("premium_");

    if (
      type === "BILLING.SUBSCRIPTION.ACTIVATED" ||
      type === "BILLING.SUBSCRIPTION.RENEWED" ||
      type === "BILLING.SUBSCRIPTION.UPDATED"
    ) {
      const validUntil = computeValidUntil(key);

      await pool.query(
        `
          UPDATE users
          SET
            is_sponsor = CASE WHEN $2 THEN TRUE ELSE is_sponsor END,
            is_premium = CASE WHEN $3 THEN TRUE ELSE is_premium END,
            subscription_type = $4,
            premium_valid_until = CASE WHEN $3 THEN $5 ELSE premium_valid_until END,
            sponsor_valid_until = CASE WHEN $2 THEN $5 ELSE sponsor_valid_until END
          WHERE id = $1
        `,
        [user_id, isSponsor, isPremium, key, validUntil.toISOString()]
      );

      return res.status(200).json({ ok: true, applied: "activated/renewed" });
    }

    if (
      type === "BILLING.SUBSCRIPTION.CANCELLED" ||
      type === "BILLING.SUBSCRIPTION.SUSPENDED" ||
      type === "BILLING.SUBSCRIPTION.EXPIRED"
    ) {
      return res.status(200).json({ ok: true, applied: "stopped_status_only" });
    }

    return res.status(200).json({ ok: true, ignored: "unhandled_type" });
  } catch (err) {
    console.error("[PayPal Webhook] Error:", err);
    return res.status(200).json({ ok: false, logged: true });
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
