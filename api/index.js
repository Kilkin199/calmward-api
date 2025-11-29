// api/index.js
// Calmward API: IA Groq + Auth con PostgreSQL + Admin básico

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

// Polyfill de fetch para Node en Render (por si no está definido)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ---------- CONFIG DB ----------

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || null;

let pool = null;

if (!DATABASE_URL) {
  console.warn(
    "[Calmward API] WARNING: No hay DATABASE_URL. Auth real no funcionará."
  );
} else {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // típico en Render
  });
}

// Crea/actualiza tablas básicas si no existen
async function ensureSchema() {
  if (!pool) return;

  const sql = `
    -- Tabla de usuarios
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
      is_admin  BOOLEAN NOT NULL DEFAULT FALSE,
      name      TEXT,
      gender    TEXT,
      country   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Asegurar columnas por si la tabla ya existía de antes
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS name      TEXT,
      ADD COLUMN IF NOT EXISTS gender    TEXT,
      ADD COLUMN IF NOT EXISTS country   TEXT,
      ADD COLUMN IF NOT EXISTS is_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_admin  BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    -- Tabla de sesiones (tokens simples)
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await pool.query(sql);
  console.log("[Calmward API] Tablas users/sessions listas");
}

if (pool) {
  ensureSchema().catch((e) =>
    console.error("[Calmward API] Error en ensureSchema:", e)
  );
}

// ---------- HELPERS DB / AUTH ----------

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function randomToken() {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

// Validación de contraseña: mínimo 10 caracteres y al menos 1 mayúscula
function isValidPassword(password) {
  if (typeof password !== "string") return false;
  if (password.length < 10) return false;
  // Mayúsculas normales y acentuadas / Ñ
  if (!/[A-ZÁÉÍÓÚÑ]/.test(password)) return false;
  return true;
}

// Middleware: autenticar por token de sesión (Authorization: Bearer <token>)
async function authMiddleware(req, res, next) {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "No hay base de datos configurada en el servidor." });
  }

  const authHeader = req.headers.authorization || "";
  const parts = authHeader.split(" ");
  const token =
    parts.length === 2 && parts[0] === "Bearer" ? parts[1].trim() : null;

  if (!token) {
    return res.status(401).json({
      error: "Falta token de sesión (usa Authorization: Bearer <token>).",
    });
  }

  try {
    await ensureSchema();

    const result = await pool.query(
      `
      SELECT 
        s.user_id,
        u.email,
        u.name,
        u.gender,
        u.country,
        u.is_sponsor,
        u.is_admin
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
    `,
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Sesión no válida o caducada." });
    }

    const row = result.rows[0];
    req.user = {
      id: row.user_id,
      email: row.email,
      name: row.name,
      gender: row.gender,
      country: row.country,
      isSponsor: row.is_sponsor,
      isAdmin: row.is_admin,
    };

    next();
  } catch (err) {
    console.error("Error en authMiddleware:", err);
    return res
      .status(500)
      .json({ error: "Error interno al validar la sesión." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res
      .status(403)
      .json({ error: "Solo el administrador puede hacer esta acción." });
  }
  next();
}

// ---------- CONFIG GROQ IA ----------

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// IMPORTANTE: este nombre de modelo debe existir en Groq
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// Prompts (dos personalidades distintas)

const SYSTEM_LISTEN = `
Eres una inteligencia artificial de apoyo emocional llamada Calmward.
Tu función es ESCUCHAR y ACOMPAÑAR.

Modo actual: "solo escúchame".

Estilo:
- Hablas como una persona cercana, cálida y respetuosa.
- Usas español sencillo, sin tecnicismos.
- Te enfocas en validar las emociones, no en dar soluciones.
- Puedes hacer alguna pregunta suave para entender mejor, pero sin interrogar.

Límites:
- No eres psicólogo ni psiquiatra ni médico. No haces diagnósticos ni das consejos médicos.
- No prometes resultados seguros ("todo va a salir bien").
- No minimizas ("no es para tanto", "hay gente peor").

Objetivo:
- Que la persona sienta que alguien está con ella en lo que cuenta.
- Devolverle sus emociones con otras palabras para que se sienta comprendida.
`;

const SYSTEM_HELP = `
Eres Calmward, una IA de apoyo emocional en modo "ayúdame a ordenar".

Tu función aquí es:
- Ayudar a la persona a ENTENDER mejor lo que le pasa.
- Separar problemas, ponerles nombre y proponer PASOS PEQUEÑOS y realistas.

Estilo:
- Hablas en español cercano y tranquilo.
- Estructuras tus respuestas: primero demuestras que has entendido, luego ordenas, luego propones 1-2 acciones pequeñas.
- Puedes usar viñetas o pasos numerados si ayuda, pero sin hacer un sermón.

Límites:
- No eres profesional sanitario, no haces diagnósticos ni recomendaciones médicas.
- Si aparecen ideas de autolesión, suicidio o violencia, anima a buscar ayuda profesional o servicios de emergencia, pero sin dar instrucciones médicas.

Importante:
- Siempre que propongas acciones, hazlas pequeñas y concretas, por ejemplo:
  - "Escribir 3 frases sobre lo que sientes ahora mismo."
  - "Mandar un mensaje a una persona de confianza."
  - "Apuntar una sola cosa que quieras probar esta semana."
- Evita frases hechas genéricas; responde de forma específica a lo que la persona ha contado.
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

// ---------- RUTA DE SALUD ----------

app.get("/", async (_req, res) => {
  let dbOk = false;
  if (pool) {
    try {
      await ensureSchema();
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

// ---------- AUTH: REGISTRO (CREAR CUENTA) ----------
// Usado desde la pestaña "Crear cuenta"

app.post("/auth/register-and-login", async (req, res) => {
  if (!pool || !DATABASE_URL) {
    return res.status(500).json({
      error:
        "No hay base de datos configurada en el servidor. Falta DATABASE_URL.",
    });
  }

  try {
    await ensureSchema();

    const { email, password, name, gender, country } = req.body || {};

    const normEmail = normalizeEmail(email);
    const rawPassword = String(password || "");

    if (!normEmail || !normEmail.includes("@")) {
      return res.status(400).json({ error: "Correo no válido." });
    }

    if (!isValidPassword(rawPassword)) {
      return res.status(400).json({
        error:
          "La contraseña debe tener al menos 10 caracteres y una letra mayúscula.",
      });
    }

    // ¿Ya existe el usuario?
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normEmail]
    );

    if (existing.rowCount > 0) {
      return res
        .status(400)
        .json({ error: "Ya existe una cuenta con ese correo." });
    }

    const hash = await bcrypt.hash(rawPassword, 10);

    // is_admin si coincide con ADMIN_EMAIL
    const isAdmin =
      ADMIN_EMAIL && normEmail === ADMIN_EMAIL.toLowerCase() ? true : false;

    const inserted = await pool.query(
      `
      INSERT INTO users (email, password_hash, name, gender, country, is_sponsor, is_admin)
      VALUES ($1, $2, $3, $4, $5, FALSE, $6)
      RETURNING id, email, name, gender, country, is_sponsor, is_admin
    `,
      [normEmail, hash, name || null, gender || null, country || null, isAdmin]
    );

    const user = inserted.rows[0];

    const token = randomToken();
    await pool.query(
      "INSERT INTO sessions (user_id, token) VALUES ($1, $2)",
      [user.id, token]
    );

    return res.json({
      token,
      email: user.email,
      name: user.name,
      gender: user.gender,
      country: user.country,
      isSponsor: user.is_sponsor,
      isAdmin: user.is_admin,
    });
  } catch (err) {
    console.error("Error en /auth/register-and-login:", err);
    return res.status(500).json({
      error: "Ha habido un problema al crear la cuenta. Inténtalo de nuevo.",
    });
  }
});

// ---------- AUTH: LOGIN (INICIAR SESIÓN) ----------
// Usado desde la pestaña "Iniciar sesión"

app.post("/auth/login", async (req, res) => {
  if (!pool || !DATABASE_URL) {
    return res.status(500).json({
      error:
        "No hay base de datos configurada en el servidor. Falta DATABASE_URL.",
    });
  }

  try {
    await ensureSchema();

    const { email, password } = req.body || {};

    const normEmail = normalizeEmail(email);
    const rawPassword = String(password || "");

    if (!normEmail || !rawPassword) {
      return res.status(400).json({
        error: "Debes indicar correo y contraseña.",
      });
    }

    const existing = await pool.query(
      `
      SELECT id, email, password_hash, name, gender, country, is_sponsor, is_admin
      FROM users
      WHERE email = $1
    `,
      [normEmail]
    );

    if (existing.rowCount === 0) {
      return res.status(401).json({
        error: "El correo o la contraseña no son correctos.",
      });
    }

    const user = existing.rows[0];

    const ok = await bcrypt.compare(rawPassword, user.password_hash);
    if (!ok) {
      return res.status(401).json({
        error: "El correo o la contraseña no son correctos.",
      });
    }

    const token = randomToken();
    await pool.query(
      "INSERT INTO sessions (user_id, token) VALUES ($1, $2)",
      [user.id, token]
    );

    return res.json({
      token,
      email: user.email,
      name: user.name,
      gender: user.gender,
      country: user.country,
      isSponsor: user.is_sponsor,
      isAdmin: user.is_admin,
    });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    return res.status(500).json({
      error: "Ha habido un problema al iniciar sesión.",
    });
  }
});

// ---------- ENDPOINTS ADMIN (panel de usuarios) ----------
// Más adelante podrás consumirlos desde una pantalla "Admin" en la app

// Listar usuarios
app.get("/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query(
      `
      SELECT id, email, name, gender, country, is_sponsor, is_admin, created_at
      FROM users
      ORDER BY created_at DESC
    `
    );
    return res.json({ users: result.rows });
  } catch (err) {
    console.error("Error en GET /admin/users:", err);
    return res
      .status(500)
      .json({ error: "No se ha podido obtener la lista de usuarios." });
  }
});

// Actualizar flags básicos (is_sponsor, is_admin)
app.patch(
  "/admin/users/:id",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await ensureSchema();

      const userId = parseInt(req.params.id, 10);
      if (!userId || userId <= 0) {
        return res.status(400).json({ error: "ID de usuario no válido." });
      }

      const { isSponsor, isAdmin } = req.body || {};

      const result = await pool.query(
        `
        UPDATE users
        SET
          is_sponsor = COALESCE($2, is_sponsor),
          is_admin   = COALESCE($3, is_admin)
        WHERE id = $1
        RETURNING id, email, name, gender, country, is_sponsor, is_admin, created_at
      `,
        [userId, typeof isSponsor === "boolean" ? isSponsor : null,
          typeof isAdmin === "boolean" ? isAdmin : null]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Usuario no encontrado." });
      }

      return res.json({ user: result.rows[0] });
    } catch (err) {
      console.error("Error en PATCH /admin/users/:id:", err);
      return res
        .status(500)
        .json({ error: "No se ha podido actualizar el usuario." });
    }
  }
);

// Eliminar usuario
app.delete(
  "/admin/users/:id",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await ensureSchema();

      const userId = parseInt(req.params.id, 10);
      if (!userId || userId <= 0) {
        return res.status(400).json({ error: "ID de usuario no válido." });
      }

      // Opcional: evitar que el admin se borre a sí mismo
      if (req.user && req.user.id === userId) {
        return res.status(400).json({
          error: "No puedes borrar la cuenta del administrador actual.",
        });
      }

      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      const result = await pool.query("DELETE FROM users WHERE id = $1", [
        userId,
      ]);

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Usuario no encontrado." });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error en DELETE /admin/users/:id:", err);
      return res
        .status(500)
        .json({ error: "No se ha podido eliminar el usuario." });
    }
  }
);

// ---------- IA: POST /ai/talk ----------

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

// ---------- ARRANQUE ----------

app.listen(PORT, () => {
  console.log(`Calmward API escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
  console.log(`? DB = ${DATABASE_URL ? "OK" : "NO CONFIGURADA"}`);
});
