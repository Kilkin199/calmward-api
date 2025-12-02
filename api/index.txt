// api/index.js
// Servidor Calmward: IA Groq + Auth con PostgreSQL + panel admin

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

// Polyfill de fetch para Node en Render (por si no está definido)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

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

// Crear / asegurar tablas y admin inicial
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

  console.log("[Calmward API] Tablas users/sessions listas. Admin inicial asignado (si había usuarios).");
}

// Helpers DB
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

async function findUserByEmail(email) {
  if (!pool) return null;
  const norm = normalizeEmail(email);
  const q = await pool.query(
    "SELECT * FROM users WHERE email = $1 LIMIT 1",
    [norm]
  );
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
      ON CONFLICT (email) DO NOTHING
      RETURNING *;
    `,
    [norm, hash, name || null, gender || null, country || null]
  );
  return q.rows[0] || null;
}

async function createSession(userId) {
  if (!pool) throw new Error("DB no configurada");
  const token = randomToken();
  await pool.query(
    `
      INSERT INTO sessions (user_id, token)
      VALUES ($1, $2);
    `,
    [userId, token]
  );
  return token;
}

async function getUserFromToken(token) {
  if (!pool || !token) return null;
  const q = await pool.query(
    `
      SELECT u.id, u.email, u.name, u.gender, u.country,
             u.is_sponsor, u.is_admin, u.created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
      LIMIT 1;
    `,
    [token]
  );
  return q.rows[0] || null;
}

// Middleware para rutas de admin
async function requireAdmin(req, res, next) {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error: "No hay base de datos configurada en el servidor.",
      });
    }

    const authHeader = req.headers["authorization"] || "";
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ error: "Falta token de sesión." });
    }
    const token = parts[1].trim();
    if (!token) {
      return res.status(401).json({ error: "Token vacío." });
    }

    const user = await getUserFromToken(token);
    if (!user || !user.is_admin) {
      return res
        .status(403)
        .json({ error: "Solo un usuario administrador puede hacer esto." });
    }

    req.adminUser = user;
    next();
  } catch (err) {
    console.error("Error en requireAdmin:", err);
    return res
      .status(500)
      .json({ error: "Error interno de autenticación de admin." });
  }
}

// ---------- CONFIG GROQ IA ----------

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// Prompts (personalidades diferentes)

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
- No prometes resultados seguros ("todo va a salir bien seguro").
- No minimizas ("no es para tanto", "hay gente peor").

Objetivo:
- Que la persona sienta que alguien está con ella en lo que cuenta.
- Devolverle sus emociones con otras palabras para que se sienta comprendida.
- No des listas de tareas ni "planes", solo acompañamiento y comprensión.
`;

const SYSTEM_HELP = `
Eres Calmward, una IA de apoyo emocional en modo "ayúdame a ordenar".

Tu función aquí es:
- Ayudar a la persona a ENTENDER mejor lo que le pasa.
- Separar problemas, ponerles nombre y proponer PASOS PEQUEÑOS y realistas.

Estilo:
- Hablas en español cercano y tranquilo.
- Estructuras tus respuestas: primero demuestras que has entendido, luego ordenas, luego propones 1–2 acciones pequeñas.
- Puedes usar viñetas o pasos numerados cuando propongas acciones, pero sin convertirlo en un sermón.

Límites:
- No eres profesional sanitario, no haces diagnósticos ni recomendaciones médicas.
- Si aparecen ideas de autolesión, suicidio o violencia, anima a buscar ayuda profesional o servicios de emergencia, pero sin dar instrucciones médicas.

Muy importante:
- Siempre que propongas acciones, hazlas pequeñas y concretas, por ejemplo:
  - "Escribir 3 frases sobre lo que sientes ahora mismo."
  - "Mandar un mensaje a una persona de confianza."
  - "Apuntar una sola cosa que quieras probar esta semana."

- Evita frases hechas genéricas; responde de forma específica a lo que la persona ha contado.
`;

// Limpia historial que pueda venir del cliente
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
      await ensureDb();
      await pool.query("SELECT 1;");
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

// ---------- AUTH: REGISTER + LOGIN EN UNO ----------

app.post("/auth/register-and-login", async (req, res) => {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error:
          "No hay base de datos configurada en el servidor. Falta DATABASE_URL.",
      });
    }

    await ensureDb();

    const {
      email,
      password,
      name = "",
      gender = "",
      country = "",
    } = req.body || {};

    const normEmail = normalizeEmail(email);
    const rawPassword = String(password || "");

    if (!normEmail || !normEmail.includes("@")) {
      return res.status(400).json({ error: "Correo no válido." });
    }

    if (!isStrongPassword(rawPassword)) {
      return res.status(400).json({
        error:
          "La contraseña debe tener al menos 10 caracteres y contener al menos una letra mayúscula.",
      });
    }

    let user = await findUserByEmail(normEmail);

    if (!user) {
      // Crear usuario nuevo
      user = await createUserWithProfile(
        normEmail,
        rawPassword,
        String(name || "").trim() || null,
        String(gender || "").trim() || null,
        String(country || "").trim() || null
      );
      if (!user) {
        // condición rara: alguien lo creó justo antes
        user = await findUserByEmail(normEmail);
      }
    } else {
      // Usuario ya existe: comprobar contraseña antes de loguear
      const ok = await bcrypt.compare(rawPassword, user.password_hash);
      if (!ok) {
        return res
          .status(401)
          .json({ error: "Correo o contraseña incorrectos." });
      }
    }

    if (!user) {
      return res.status(500).json({
        error: "No se ha podido crear/recuperar el usuario.",
      });
    }

    // Garantizar que existe al menos un admin
    await ensureDb();

    const token = await createSession(user.id);

    return res.json({
      token,
      email: user.email,
      isSponsor: !!user.is_sponsor,
      isAdmin: !!user.is_admin,
      name: user.name,
      gender: user.gender,
      country: user.country,
    });
  } catch (err) {
    console.error("Error en /auth/register-and-login:", err);
    return res.status(500).json({
      error: "Ha habido un problema al registrar/iniciar sesión.",
    });
  }
});

// ---------- AUTH: SOLO LOGIN ----------

app.post("/auth/login", async (req, res) => {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error:
          "No hay base de datos configurada en el servidor. Falta DATABASE_URL.",
      });
    }

    await ensureDb();

    const { email, password } = req.body || {};
    const normEmail = normalizeEmail(email);
    const rawPassword = String(password || "");

    if (!normEmail || !rawPassword) {
      return res
        .status(400)
        .json({ error: "Debes indicar correo y contraseña." });
    }

    const user = await findUserByEmail(normEmail);
    if (!user) {
      return res
        .status(401)
        .json({ error: "No existe ninguna cuenta con ese correo." });
    }

    const ok = await bcrypt.compare(rawPassword, user.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ error: "Correo o contraseña incorrectos." });
    }

    const token = await createSession(user.id);

    return res.json({
      token,
      email: user.email,
      isSponsor: !!user.is_sponsor,
      isAdmin: !!user.is_admin,
      name: user.name,
      gender: user.gender,
      country: user.country,
    });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    return res.status(500).json({
      error: "Ha habido un problema al iniciar sesión.",
    });
  }
});

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

// ---------- ADMIN: GESTIÓN DE USUARIOS ----------

// Lista de usuarios (solo admin)
app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    await ensureDb();
    const q = await pool.query(
      `
      SELECT id, email, name, gender, country,
             is_sponsor, is_admin, created_at
      FROM users
      ORDER BY id ASC;
    `
    );
    return res.json({ users: q.rows });
  } catch (err) {
    console.error("Error en GET /admin/users:", err);
    return res.status(500).json({
      error: "No se ha podido recuperar la lista de usuarios.",
    });
  }
});

// Modificar usuario (is_sponsor, is_admin, perfil)
app.patch("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    await ensureDb();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: "ID de usuario no válido." });
    }

    const { isSponsor, isAdmin, name, gender, country } = req.body || {};

    // Comprobamos si es el último admin
    const adminsQ = await pool.query(
      "SELECT id FROM users WHERE is_admin = TRUE;"
    );
    const adminIds = adminsQ.rows.map((r) => r.id);

    const updatingLastAdmin =
      adminIds.length === 1 && adminIds[0] === id && isAdmin === false;

    if (updatingLastAdmin) {
      return res.status(400).json({
        error:
          "No puedes quitar el rol de admin al único administrador que existe.",
      });
    }

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
      RETURNING id, email, name, gender, country,
                is_sponsor, is_admin, created_at;
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

    if (q.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    return res.json({ user: q.rows[0] });
  } catch (err) {
    console.error("Error en PATCH /admin/users/:id:", err);
    return res.status(500).json({
      error: "No se ha podido actualizar el usuario.",
    });
  }
});

// Borrar usuario (solo admin, protegiendo último admin)
app.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    await ensureDb();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: "ID de usuario no válido." });
    }

    // No permitir borrar al último admin
    const adminsQ = await pool.query(
      "SELECT id FROM users WHERE is_admin = TRUE;"
    );
    const adminIds = adminsQ.rows.map((r) => r.id);

    const deletingLastAdmin =
      adminIds.length === 1 && adminIds[0] === id;

    if (deletingLastAdmin) {
      return res.status(400).json({
        error:
          "No puedes borrar al único usuario administrador. Crea otro admin antes.",
      });
    }

    await pool.query("DELETE FROM sessions WHERE user_id = $1;", [id]);
    const del = await pool.query("DELETE FROM users WHERE id = $1;", [id]);

    if (del.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error en DELETE /admin/users/:id:", err);
    return res.status(500).json({
      error: "No se ha podido borrar el usuario.",
    });
  }
});

// ---------- ARRANQUE SERVIDOR ----------

app.listen(PORT, () => {
  console.log(`Calmward API escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
  if (DATABASE_URL) {
    console.log("? DATABASE_URL configurado. Preparando tablas...");
    ensureDb()
      .then(() => console.log("Tablas listas (users, sessions)."))
      .catch((err) => console.error("Error preparando la BD:", err));
  } else {
    console.log("? Sin DATABASE_URL: no habrá persistencia de usuarios.");
  }
});
