// api/index.js
// Servidor Calmward: IA Groq + Auth con PostgreSQL + Comunidad anónima

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

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
    ssl: { rejectUnauthorized: false }, // típico en Render
  });
}

// Crea/actualiza tablas de usuarios, sesiones y comunidad
async function ensureSchema() {
  if (!pool) return;

  const sql = `
    -- Tabla usuarios básica
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Campo de ban (si no existe)
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;

    -- Tabla de sesiones
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Posts anónimos
    CREATE TABLE IF NOT EXISTS community_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Likes (un usuario solo puede likear una vez cada post)
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
  `;

  try {
    await pool.query(sql);
    console.log("[Calmward API] Esquema OK (users, sessions, comunidad).");
  } catch (err) {
    console.error("[Calmward API] Error creando esquema:", err);
  }
}

if (pool) {
  ensureSchema().catch((e) =>
    console.error("[Calmward API] Error en ensureSchema:", e)
  );
}

// Helpers para tokens
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
// IMPORTANTE: este modelo debe existir en Groq
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// Prompts con dos modos bien diferenciados

const SYSTEM_LISTEN = `
Eres Calmward, una IA de apoyo emocional centrada en ESCUCHAR y ACOMPAÑAR.

Tu modo actual es: "solo escúchame".

Estilo:
- Hablas como una persona cercana, cálida y respetuosa.
- Usas español sencillo, sin tecnicismos.
- Te enfocas en validar las emociones, no en dar soluciones.
- Puedes hacer alguna pregunta suave para entender mejor, pero sin interrogar.

Límites:
- No eres psicólogo, psiquiatra ni médico. No haces diagnósticos ni das consejos médicos.
- No prometes resultados seguros ("todo va a salir bien").
- No minimizas ("no es para tanto", "hay gente peor").

Objetivo:
- Que la persona sienta que alguien está con ella en lo que cuenta.
- Devolverle sus emociones con otras palabras para que se sienta comprendida.
- No des listas de tareas ni planes; solo acompañamiento y comprensión.
`;

const SYSTEM_HELP = `
Eres Calmward, una IA de apoyo emocional en modo "ayúdame a ordenar".

Tu función aquí:
- Ayudar a la persona a ENTENDER mejor lo que le pasa.
- Separar problemas, ponerles nombre y proponer PASOS PEQUEÑOS y realistas.

Estilo:
- Hablas en español cercano y tranquilo.
- Estructuras tus respuestas: primero demuestras que has entendido, luego ordenas, luego propones 1-2 acciones pequeñas.
- Puedes usar viñetas o pasos numerados, pero sin soltar sermones.

Límites:
- No eres profesional sanitario, no haces diagnósticos ni recomendaciones médicas.
- Si aparecen ideas de autolesión, suicidio o violencia, anima a buscar ayuda profesional o servicios de emergencia, pero sin dar instrucciones médicas.

Muy importante:
- Las acciones deben ser concretas y pequeñas, por ejemplo:
  - "Escribir 3 frases sobre lo que sientes ahora mismo."
  - "Mandar un mensaje a una persona de confianza."
  - "Apuntar una sola cosa que quieras probar esta semana."

- Evita frases hechas genéricas; responde siempre de forma específica a lo que la persona ha contado.
`;

// Normaliza historial que pueda venir del cliente
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: typeof m?.content === "string" ? m.content : "",
    }))
    .filter((m) => m.content.trim().length > 0);
}

// ===================== HELPERS SESIÓN + BAN (para Comunidad) =====================

// Buscar usuario por token de sesión
async function getUserFromToken(token) {
  if (!pool || !token) return null;

  const q = await pool.query(
    `
      SELECT u.id, u.email, u.is_sponsor, u.is_banned
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

// Extraer token de Authorization o cabecera X-Session-Token
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

// Forzar que haya user y que no esté baneado
async function getUserFromRequestOrThrow(req, res) {
  if (!pool) {
    res.status(500).json({
      error: "No hay base de datos configurada en el servidor.",
    });
    return null;
  }

  const token = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: "Debes iniciar sesión para usar la comunidad." });
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
        error:
          "Tu cuenta ha sido bloqueada por incumplir las normas de la comunidad.",
      });
      return null;
    }

    return { user, token };
  } catch (err) {
    console.error("[Comunidad] Error en getUserFromRequestOrThrow:", err);
    res.status(500).json({ error: "Error interno validando la sesión." });
    return null;
  }
}

// Filtro básico anti-contenido tóxico
function isToxicContent(text) {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Lista básica, se puede ampliar cuando quieras
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

// Banear usuario y cerrar todas sus sesiones
async function blockUserAndKillSessions(userId) {
  if (!pool || !userId) return;

  await pool.query(
    `
      UPDATE users
      SET is_banned = TRUE
      WHERE id = $1
    `,
    [userId]
  );

  await pool.query(
    `
      DELETE FROM sessions
      WHERE user_id = $1
    `,
    [userId]
  );

  console.log(`[Comunidad] Usuario ${userId} bloqueado y sesiones cerradas.`);
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

// ===================== AUTH: REGISTER + LOGIN =====================

// POST /auth/register-and-login
// Crea usuario (si no existe) o hace login si ya existe
app.post("/auth/register-and-login", async (req, res) => {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error:
          "No hay base de datos configurada en el servidor. Falta DATABASE_URL.",
      });
    }

    const { email, password } = req.body || {};
    const normEmail = normalizeEmail(email);
    const plainPass = String(password || "");

    if (!normEmail || !normEmail.includes("@")) {
      return res.status(400).json({ error: "Correo no válido." });
    }

    // Reglas de contraseña: mínimo 10 y al menos 1 mayúscula
    if (plainPass.length < 10) {
      return res.status(400).json({
        error: "La contraseña debe tener al menos 10 caracteres.",
      });
    }
    if (!/[A-ZÁÉÍÓÚÑ]/.test(plainPass)) {
      return res.status(400).json({
        error: "La contraseña debe incluir al menos una letra mayúscula.",
      });
    }

    const existing = await pool.query(
      "SELECT id, email, password_hash, is_sponsor FROM users WHERE email = $1",
      [normEmail]
    );

    let userRow;

    if (existing.rows.length > 0) {
      // Ya existe: intentar login
      userRow = existing.rows[0];
      const ok = await bcrypt.compare(plainPass, userRow.password_hash);
      if (!ok) {
        return res
          .status(401)
          .json({ error: "Correo o contraseña incorrectos." });
      }
    } else {
      // No existe: crear usuario
      const hash = await bcrypt.hash(plainPass, 10);
      const inserted = await pool.query(
        `
          INSERT INTO users (email, password_hash)
          VALUES ($1, $2)
          RETURNING id, email, is_sponsor
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
    });
  } catch (err) {
    console.error("Error en /auth/register-and-login:", err);
    return res.status(500).json({
      error:
        "Ha habido un problema al crear o iniciar sesión. Inténtalo de nuevo en unos segundos.",
    });
  }
});

// POST /auth/login
// Login normal con email + password
app.post("/auth/login", async (req, res) => {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error:
          "No hay base de datos configurada en el servidor. Falta DATABASE_URL.",
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
      "SELECT id, email, password_hash, is_sponsor, is_banned FROM users WHERE email = $1",
      [normEmail]
    );

    if (q.rows.length === 0) {
      return res
        .status(401)
        .json({ error: "No existe ninguna cuenta con ese correo." });
    }

    const userRow = q.rows[0];

    if (userRow.is_banned) {
      return res.status(403).json({
        error:
          "Tu cuenta ha sido bloqueada por incumplir las normas de la comunidad.",
      });
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
    });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    return res.status(500).json({
      error:
        "Ha habido un problema al iniciar sesión. Inténtalo de nuevo en unos segundos.",
    });
  }
});

// ===================== COMUNIDAD ANÓNIMA =====================

// Crear post anónimo (requiere sesión; si es tóxico, ban y fuera)
app.post("/community/posts", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const { user } = auth;

    if (!pool) {
      return res.status(500).json({
        error: "No hay base de datos configurada.",
      });
    }

    let { text } = req.body || {};
    text = typeof text === "string" ? text.trim() : "";

    if (!text || text.length < 3) {
      return res
        .status(400)
        .json({ error: "El post es demasiado corto. Escribe un poco más." });
    }

    if (isToxicContent(text)) {
      await blockUserAndKillSessions(user.id);
      return res.status(403).json({
        error:
          "Tu cuenta ha sido bloqueada por incumplir las normas de la comunidad.",
      });
    }

    const insert = await pool.query(
      `
        INSERT INTO community_posts (user_id, body)
        VALUES ($1, $2)
        RETURNING id, body, created_at
      `,
      [user.id, text]
    );

    const row = insert.rows[0];

    return res.json({
      ok: true,
      post: {
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        likeCount: 0,
        commentCount: 0,
      },
    });
  } catch (err) {
    console.error("Error en POST /community/posts:", err);
    return res
      .status(500)
      .json({ error: "Error interno al crear el post anónimo." });
  }
});

// Listar posts recientes
app.get("/community/posts", async (_req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        error: "No hay base de datos configurada.",
      });
    }

    const limit = 50;

    const result = await pool.query(
      `
        SELECT p.id,
               p.body,
               p.created_at,
               COALESCE(l.cnt, 0)  AS like_count,
               COALESCE(c.cnt, 0)  AS comment_count
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
      likeCount: row.like_count,
      commentCount: row.comment_count,
    }));

    return res.json({ ok: true, posts });
  } catch (err) {
    console.error("Error en GET /community/posts:", err);
    return res
      .status(500)
      .json({ error: "Error interno al listar los posts." });
  }
});

// Like / unlike de un post (requiere sesión)
app.post("/community/posts/:id/like", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const { user } = auth;

    if (!pool) {
      return res.status(500).json({
        error: "No hay base de datos configurada.",
      });
    }

    const postId = parseInt(req.params.id, 10);
    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ error: "ID de post inválido." });
    }

    const existingLike = await pool.query(
      `
        SELECT id
        FROM community_likes
        WHERE post_id = $1 AND user_id = $2
      `,
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
        `
          INSERT INTO community_likes (post_id, user_id)
          VALUES ($1, $2)
        `,
        [postId, user.id]
      );
      liked = true;
    }

    const countRes = await pool.query(
      `
        SELECT COUNT(*)::int AS c
        FROM community_likes
        WHERE post_id = $1
      `,
      [postId]
    );

    const likeCount = countRes.rows[0]?.c ?? 0;

    return res.json({
      ok: true,
      liked,
      likeCount,
    });
  } catch (err) {
    console.error("Error en POST /community/posts/:id/like:", err);
    return res
      .status(500)
      .json({ error: "Error interno al registrar el like." });
  }
});

// Crear comentario (requiere sesión)
app.post("/community/posts/:id/comments", async (req, res) => {
  try {
    const auth = await getUserFromRequestOrThrow(req, res);
    if (!auth) return;
    const { user } = auth;

    if (!pool) {
      return res.status(500).json({
        error: "No hay base de datos configurada.",
      });
    }

    const postId = parseInt(req.params.id, 10);
    if (!postId || Number.isNaN(postId)) {
      return res.status(400).json({ error: "ID de post inválido." });
    }

    let { text } = req.body || {};
    text = typeof text === "string" ? text.trim() : "";

    if (!text || text.length < 2) {
      return res
        .status(400)
        .json({ error: "El comentario es demasiado corto." });
    }

    if (isToxicContent(text)) {
      await blockUserAndKillSessions(user.id);
      return res.status(403).json({
        error:
          "Tu cuenta ha sido bloqueada por incumplir las normas de la comunidad.",
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
      comment: {
        id: row.id,
        postId,
        body: row.body,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    console.error("Error en POST /community/posts/:id/comments:", err);
    return res
      .status(500)
      .json({ error: "Error interno al crear el comentario." });
  }
});

// Listar comentarios de un post
app.get("/community/posts/:id/comments", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        error: "No hay base de datos configurada.",
      });
    }

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
    console.error("Error en GET /community/posts/:id/comments:", err);
    return res
      .status(500)
      .json({ error: "Error interno al listar comentarios." });
  }
});

// ===================== IA: POST /ai/talk =====================

app.post("/ai/talk", async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      console.error("Falta GROQ_API_KEY en el servidor");
      return res.status(500).json({
        error: "Falta GROQ_API_KEY en el servidor. Configúrala en Render.",
      });
    }

    const { message, mode = "solo_escuchame", history = [] } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Falta 'message' en el cuerpo." });
    }

    const systemPrompt =
      mode === "ayudame_a_ordenar" ? SYSTEM_HELP : SYSTEM_LISTEN;

    const chatHistory = normalizeHistory(history);

    const messages = [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: message },
    ];

    const payload = {
      model: GROQ_MODEL,
      messages,
      temperature: 0.7,
    };

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
    return res.status(500).json({
      error:
        "Ha habido un problema al hablar con el modelo. Inténtalo de nuevo en unos segundos.",
    });
  }
});

// ===================== ARRANQUE SERVIDOR =====================

app.listen(PORT, () => {
  console.log(`Calmward API escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
  console.log(
    `? DB: ${DATABASE_URL ? "conectada (DATABASE_URL presente)" : "NO CONFIGURADA"}`
  );
});
