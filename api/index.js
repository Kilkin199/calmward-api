// api/index.js
// Servidor Calmward: IA Groq + Auth con PostgreSQL + panel admin + Comunidad anónima

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

// Polyfill fetch si no existe (Render / Node antiguos)
const fetch =
  typeof global.fetch === "function"
    ? global.fetch
    : (...args) =>
        import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ---------- CONFIG DB (PostgreSQL) ----------

const DATABASE_URL = process.env.DATABASE_URL || null;
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log("[Calmward API] DATABASE_URL detectada, usando PostgreSQL.");
} else {
  console.warn(
    "[Calmward API] WARNING: No hay DATABASE_URL. Auth real NO funcionará."
  );
}

// ---------- HELPERS DB / AUTH ----------

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isStrongPassword(pwd) {
  if (typeof pwd !== "string") return false;
  if (pwd.length < 10) return false;
  if (!/[A-Z]/.test(pwd)) return false; // al menos una mayúscula
  return true;
}

function randomToken() {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

async function ensureDb() {
  if (!pool) return;

  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      gender TEXT,
      country TEXT,
      is_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
      is_admin  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Posts anónimos de Comunidad
    CREATE TABLE IF NOT EXISTS community_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS community_comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await pool.query(sql);

  // Si no hay ningún admin, marcamos al primer usuario como admin
  await pool.query(`
    UPDATE users
    SET is_admin = TRUE
    WHERE id = (
      SELECT id FROM users ORDER BY id ASC LIMIT 1
    )
    AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = TRUE);
  `);

  console.log(
    "[Calmward API] Tablas listas (users, sessions, community_*). Admin inicial asignado (si había usuarios)."
  );
}

async function findUserByEmail(email) {
  if (!pool) return null;
  const norm = normalizeEmail(email);
  const q = await pool.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [
    norm,
  ]);
  return q.rows[0] || null;
}

async function createUserWithProfile(email, password, name, gender, country) {
  if (!pool) throw new Error("DB no configurada.");
  const norm = normalizeEmail(email);
  const hash = await bcrypt.hash(password, 10);

  const q = await pool.query(
    `
    INSERT INTO users (email, password_hash, name, gender, country)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, email, name, gender, country, is_sponsor, is_admin, created_at
  `,
    [norm, hash, name || null, gender || null, country || null]
  );

  return q.rows[0];
}

async function createSession(userId) {
  if (!pool) throw new Error("DB no configurada.");
  const token = randomToken();
  await pool.query(
    `
    INSERT INTO sessions (user_id, token)
    VALUES ($1, $2)
  `,
    [userId, token]
  );
  return token;
}

async function getUserFromToken(token) {
  if (!pool || !token) return null;
  const q = await pool.query(
    `
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1
    LIMIT 1
  `,
    [token]
  );
  return q.rows[0] || null;
}

function getTokenFromRequest(req) {
  const header = req.headers["x-session-token"] || req.headers["authorization"];
  if (!header) return null;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  if (typeof header === "string") return header.trim();
  return null;
}

async function getUserFromRequest(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const user = await getUserFromToken(token);
  if (!user) return null;
  return { user, token };
}

function requireAuth(req, res, next) {
  getUserFromRequest(req)
    .then((ctx) => {
      if (!ctx) {
        return res.status(401).json({ error: "Sesión no válida." });
      }
      req.calmwardUser = ctx.user;
      req.calmwardToken = ctx.token;
      next();
    })
    .catch((err) => {
      console.error("Error requireAuth:", err);
      res.status(500).json({ error: "Error interno de autenticación." });
    });
}

function requireAdmin(req, res, next) {
  getUserFromRequest(req)
    .then((ctx) => {
      if (!ctx || !ctx.user.is_admin) {
        return res
          .status(403)
          .json({ error: "Solo administradores pueden usar esta ruta." });
      }
      req.calmwardUser = ctx.user;
      req.calmwardToken = ctx.token;
      next();
    })
    .catch((err) => {
      console.error("Error requireAdmin:", err);
      res.status(500).json({ error: "Error interno de autenticación." });
    });
}

// ---------- CONFIG IA (GROQ) ----------

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "mixtral-8x7b-32768";
const GROQ_API_URL =
  process.env.GROQ_API_URL ||
  "https://api.groq.com/openai/v1/chat/completions";

async function callGroqChat({ mode, message, history }) {
  if (!GROQ_API_KEY) {
    return {
      reply:
        "El servidor de Calmward no tiene configurada la clave de IA. Habla con quien mantiene la app.",
    };
  }

  const baseSystem =
    "Eres una IA de apoyo emocional llamada Calmward. Respondes en español, con tono empático, claro y sin dramatizar. No das consejos médicos ni legales. Si percibes riesgo de autolesión, recomiendas buscar ayuda profesional y servicios de emergencia, sin órdenes directas.";

  const systemExtra =
    mode === "ayudame_a_ordenar"
      ? "El usuario quiere ordenar ideas, tomar pequeñas decisiones y ver pasos concretos pero suaves. Ayuda a resumir, ordenar y proponer pasos pequeños."
      : "El usuario quiere principalmente ser escuchado. Prioriza validar emociones y reflejar lo que cuenta antes de sugerir nada.";

  const messages = [
    { role: "system", content: baseSystem + " " + systemExtra },
  ];

  if (Array.isArray(history)) {
    for (const m of history) {
      if (!m || typeof m.content !== "string") continue;
      if (m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }

  messages.push({
    role: "user",
    content: message || "",
  });

  const body = {
    model: GROQ_MODEL,
    messages,
    temperature: 0.7,
  };

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("Groq error status:", res.status, await res.text());
    return {
      reply:
        "Ahora mismo no puedo contactar con el servicio de IA. Inténtalo otra vez en unos minutos.",
    };
  }

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const text = choice?.message?.content || "";
  return { reply: text || "No he podido generar respuesta ahora mismo." };
}

// ---------- MODERACIÓN TEXTO COMUNIDAD ----------

const COMMUNITY_BANNED_PATTERNS = [
  /suicid(a|ate|arse)/i,
  /m[aá]tate/i,
  /matar(te|os)?/i,
  /nadie te va a? echar de menos/i,
  /eres una? mierda/i,
  /ojal[aá] te mueras/i,
  /insulta(r|do)/i,
  /gilipollas/i,
  /subnormal/i,
  /maric[oó]n/i,
  /put[ao]/i,
  /negr(o|a) de mierda/i,
];

function checkCommunityText(raw) {
  const body = String(raw || "").trim();

  if (!body) {
    return {
      ok: false,
      message: "Escribe algo antes de publicar.",
    };
  }

  if (body.length < 10) {
    return {
      ok: false,
      message:
        "El mensaje es muy corto. Intenta explicar un poco más lo que quieres compartir.",
    };
  }

  if (body.length > 1500) {
    return {
      ok: false,
      message:
        "El mensaje es muy largo. Intenta resumirlo un poco para que sea más fácil de leer.",
    };
  }

  for (const re of COMMUNITY_BANNED_PATTERNS) {
    if (re.test(body)) {
      return {
        ok: false,
        message:
          "Tu mensaje parece contener lenguaje dañino u ofensivo. Intenta escribirlo de forma que no ataque a nadie ni anime a hacerse daño.",
      };
    }
  }

  return { ok: true, message: null };
}

// ---------- ENDPOINTS BÁSICOS ----------

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Calmward API viva." });
});

// ---------- AUTH ----------

// Registro + login en un paso
app.post("/auth/register-and-login", async (req, res) => {
  try {
    if (!pool) {
      return res
        .status(500)
        .json({ error: "La base de datos no está configurada." });
    }

    let { email, password, name, gender, country } = req.body || {};

    email = normalizeEmail(email);
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Faltan correo o contraseña para registrarse." });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error:
          "La contraseña debe tener mínimo 10 caracteres y al menos una letra mayúscula.",
      });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res
        .status(400)
        .json({ error: "Ya existe una cuenta con ese correo." });
    }

    const user = await createUserWithProfile(
      email,
      password,
      name,
      gender,
      country
    );
    const token = await createSession(user.id);

    res.json({
      token,
      email: user.email,
      name: user.name,
      gender: user.gender,
      country: user.country,
      isSponsor: !!user.is_sponsor,
      isAdmin: !!user.is_admin,
    });
  } catch (err) {
    console.error("Error /auth/register-and-login:", err);
    res.status(500).json({ error: "Error interno al registrar." });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  try {
    if (!pool) {
      return res
        .status(500)
        .json({ error: "La base de datos no está configurada." });
    }

    let { email, password } = req.body || {};
    email = normalizeEmail(email);

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Faltan correo o contraseña para iniciar sesión." });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res
        .status(400)
        .json({ error: "Correo o contraseña no válidos." });
    }

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) {
      return res
        .status(400)
        .json({ error: "Correo o contraseña no válidos." });
    }

    const token = await createSession(user.id);

    res.json({
      token,
      email: user.email,
      name: user.name,
      gender: user.gender,
      country: user.country,
      isSponsor: !!user.is_sponsor,
      isAdmin: !!user.is_admin,
    });
  } catch (err) {
    console.error("Error /auth/login:", err);
    res.status(500).json({ error: "Error interno al iniciar sesión." });
  }
});

// Perfil
app.get("/auth/profile", requireAuth, async (req, res) => {
  const u = req.calmwardUser;
  res.json({
    email: u.email,
    name: u.name,
    gender: u.gender,
    country: u.country,
    isSponsor: !!u.is_sponsor,
    isAdmin: !!u.is_admin,
    createdAt: u.created_at,
  });
});

// ---------- IA TALK (Groq) ----------

app.post("/ai/talk", async (req, res) => {
  try {
    const { mode, message, history } = req.body || {};
    if (!message || typeof message !== "string") {
      return res
        .status(400)
        .json({ error: "Falta el campo 'message' en la petición." });
    }
    const safeMode =
      mode === "ayudame_a_ordenar" ? "ayudame_a_ordenar" : "solo_escuchame";

    const result = await callGroqChat({
      mode: safeMode,
      message,
      history: Array.isArray(history) ? history : [],
    });

    res.json({ reply: result.reply });
  } catch (err) {
    console.error("Error /ai/talk:", err);
    res.status(500).json({
      error:
        "No se ha podido obtener respuesta de la IA en este momento. Inténtalo de nuevo más tarde.",
    });
  }
});

// ---------- ADMIN: USUARIOS ----------

// Listar usuarios (admin)
app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const q = await pool.query(
      `
      SELECT id, email, name, gender, country, is_sponsor, is_admin, created_at
      FROM users
      ORDER BY id ASC
    `
    );
    res.json({ users: q.rows });
  } catch (err) {
    console.error("Error /admin/users:", err);
    res.status(500).json({ error: "Error interno al listar usuarios." });
  }
});

// Actualizar flags de usuario (sponsor/admin) o datos básicos
app.patch("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: "ID de usuario no válido." });
    }

    const { isSponsor, isAdmin, name, gender, country } = req.body || {};

    const q = await pool.query(
      `
      UPDATE users
      SET
        is_sponsor = COALESCE($2, is_sponsor),
        is_admin   = COALESCE($3, is_admin),
        name       = COALESCE($4, name),
        gender     = COALESCE($5, gender),
        country    = COALESCE($6, country)
      WHERE id = $1
      RETURNING id, email, name, gender, country, is_sponsor, is_admin, created_at
    `,
      [
        id,
        typeof isSponsor === "boolean" ? isSponsor : null,
        typeof isAdmin === "boolean" ? isAdmin : null,
        name ?? null,
        gender ?? null,
        country ?? null,
      ]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json({ user: q.rows[0] });
  } catch (err) {
    console.error("Error /admin/users/:id PATCH:", err);
    res.status(500).json({ error: "Error interno al actualizar usuario." });
  }
});

// Eliminar usuario (admin)
app.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: "ID de usuario no válido." });
    }

    const q = await pool.query("DELETE FROM users WHERE id = $1", [id]);
    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Error /admin/users/:id DELETE:", err);
    res.status(500).json({ error: "Error interno al eliminar usuario." });
  }
});

// ---------- COMUNIDAD ANÓNIMA ----------

// Crear post anónimo (requiere sesión, pero no mostramos nombre)
app.post("/community/posts", requireAuth, async (req, res) => {
  try {
    const user = req.calmwardUser;
    const { body } = req.body || {};

    const check = checkCommunityText(body);
    if (!check.ok) {
      return res.status(400).json({ error: check.message });
    }

    const q = await pool.query(
      `
      INSERT INTO community_posts (user_id, body)
      VALUES ($1, $2)
      RETURNING id, body, created_at
    `,
      [user.id, body.trim()]
    );

    const post = q.rows[0];
    res.json({
      id: post.id,
      body: post.body,
      createdAt: post.created_at,
      likes: 0,
      comments: 0,
      likedByMe: false,
    });
  } catch (err) {
    console.error("Error POST /community/posts:", err);
    res.status(500).json({
      error: "No se ha podido publicar el mensaje. Inténtalo más tarde.",
    });
  }
});

// Listar posts (últimos primero)
app.get("/community/posts", async (req, res) => {
  try {
    let userId = null;
    try {
      const ctx = await getUserFromRequest(req);
      if (ctx && ctx.user) userId = ctx.user.id;
    } catch {
      userId = null;
    }

    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 30)
    );
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const q = await pool.query(
      `
      SELECT
        p.id,
        p.body,
        p.created_at,
        COALESCE(lc.likes, 0) AS likes,
        COALESCE(cc.comments, 0) AS comments,
        CASE WHEN ul.user_id IS NULL THEN FALSE ELSE TRUE END AS liked_by_me
      FROM community_posts p
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS likes
        FROM community_likes
        GROUP BY post_id
      ) lc ON lc.post_id = p.id
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS comments
        FROM community_comments
        GROUP BY post_id
      ) cc ON cc.post_id = p.id
      LEFT JOIN community_likes ul
        ON ul.post_id = p.id AND ul.user_id = $1
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `,
      [userId || 0, limit, offset]
    );

    const posts = q.rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      likes: Number(row.likes || 0),
      comments: Number(row.comments || 0),
      likedByMe: !!row.liked_by_me,
    }));

    res.json({ posts });
  } catch (err) {
    console.error("Error GET /community/posts:", err);
    res.status(500).json({
      error: "No se han podido cargar los mensajes de la comunidad.",
    });
  }
});

// Like / Unlike (toggle) de un post
app.post("/community/posts/:id/like", requireAuth, async (req, res) => {
  try {
    const user = req.calmwardUser;
    const postId = parseInt(req.params.id, 10);
    if (!postId) {
      return res.status(400).json({ error: "ID de post no válido." });
    }

    // Comprobar existencia del post
    const exists = await pool.query(
      "SELECT id FROM community_posts WHERE id = $1",
      [postId]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "Post no encontrado." });
    }

    const existingLike = await pool.query(
      `
      SELECT id FROM community_likes
      WHERE post_id = $1 AND user_id = $2
      LIMIT 1
    `,
      [postId, user.id]
    );

    let liked = false;
    if (existingLike.rowCount > 0) {
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

    const countQ = await pool.query(
      `
      SELECT COUNT(*) AS likes
      FROM community_likes
      WHERE post_id = $1
    `,
      [postId]
    );
    const likes = Number(countQ.rows[0]?.likes || 0);

    res.json({ ok: true, liked, likes });
  } catch (err) {
    console.error("Error POST /community/posts/:id/like:", err);
    res.status(500).json({
      error: "No se ha podido actualizar el me gusta. Inténtalo de nuevo.",
    });
  }
});

// Crear comentario
app.post("/community/posts/:id/comments", requireAuth, async (req, res) => {
  try {
    const user = req.calmwardUser;
    const postId = parseInt(req.params.id, 10);
    const { body } = req.body || {};

    if (!postId) {
      return res.status(400).json({ error: "ID de post no válido." });
    }

    const exists = await pool.query(
      "SELECT id FROM community_posts WHERE id = $1",
      [postId]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "Post no encontrado." });
    }

    const check = checkCommunityText(body);
    if (!check.ok) {
      return res.status(400).json({ error: check.message });
    }

    const q = await pool.query(
      `
      INSERT INTO community_comments (post_id, user_id, body)
      VALUES ($1, $2, $3)
      RETURNING id, body, created_at
    `,
      [postId, user.id, body.trim()]
    );

    const comment = q.rows[0];

    const countQ = await pool.query(
      `
      SELECT COUNT(*) AS comments
      FROM community_comments
      WHERE post_id = $1
    `,
      [postId]
    );

    res.json({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      commentsCount: Number(countQ.rows[0]?.comments || 0),
    });
  } catch (err) {
    console.error("Error POST /community/posts/:id/comments:", err);
    res.status(500).json({
      error: "No se ha podido guardar el comentario.",
    });
  }
});

// Listar comentarios de un post
app.get("/community/posts/:id/comments", async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!postId) {
      return res.status(400).json({ error: "ID de post no válido." });
    }

    const q = await pool.query(
      `
      SELECT id, body, created_at
      FROM community_comments
      WHERE post_id = $1
      ORDER BY created_at ASC
    `,
      [postId]
    );

    const comments = q.rows.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
    }));

    res.json({ comments });
  } catch (err) {
    console.error("Error GET /community/posts/:id/comments:", err);
    res.status(500).json({
      error: "No se han podido cargar los comentarios.",
    });
  }
});

// Borrar post (solo admin)
app.delete("/admin/community/posts/:id", requireAdmin, async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!postId) {
      return res.status(400).json({ error: "ID de post no válido." });
    }

    const q = await pool.query(
      "DELETE FROM community_posts WHERE id = $1",
      [postId]
    );
    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Post no encontrado." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Error DELETE /admin/community/posts/:id:", err);
    res.status(500).json({
      error: "No se ha podido eliminar el post.",
    });
  }
});

// ---------- ARRANQUE ----------

ensureDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Calmward API escuchando en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Error inicializando DB:", err);
    app.listen(PORT, () => {
      console.log(
        `Calmward API escuchando en puerto ${PORT}, pero la DB ha fallado al iniciar.`
      );
    });
  });
