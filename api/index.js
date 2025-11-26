// api/index.js
// Servidor IA + Auth para Calmward usando Groq (Llama 3.1 en la nube) + Postgres

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

// Polyfill de fetch para Node en Render (por si no está definido)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ---------- CONFIG DB (Postgres) ----------

const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

if (!DATABASE_URL) {
  console.warn(
    "[Calmward] No hay DATABASE_URL. El login/registro real NO funcionará."
  );
} else {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // típico en Render
    },
  });
}

async function initDb() {
  if (!pool) return;

  // Tabla de usuarios
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Tabla de sesiones (tokens)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("[Calmward] Tablas users/sessions OK");
}

if (pool) {
  initDb().catch((err) => {
    console.error("[Calmward] Error inicializando DB:", err);
  });
}

// Helpers DB
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function findUserByEmail(email) {
  if (!pool) return null;
  const norm = normalizeEmail(email);
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [
    norm,
  ]);
  return rows[0] || null;
}

async function createUser(email, password) {
  if (!pool) throw new Error("DB no configurada");
  const norm = normalizeEmail(email);
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (email) DO NOTHING
      RETURNING *;
    `,
    [norm, hash]
  );
  return rows[0] || null;
}

async function createSession(userId) {
  if (!pool) throw new Error("DB no configurada");
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `
      INSERT INTO sessions (user_id, token)
      VALUES ($1, $2);
    `,
    [userId, token]
  );
  return token;
}

// ---------- CONFIG GROQ IA ----------

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// ----- PROMPTS DEL MODELO -----

const SYSTEM_LISTEN = `
Eres una inteligencia artificial de apoyo emocional llamada Calmward.
Tu función es hablar con el usuario como un amigo o amiga de confianza,
con mucha empatía, calidez y sin juicios.

REGLAS IMPORTANTES:
- No eres psicólogo ni psiquiatra, no des diagnósticos ni hables como profesional sanitario.
- No prometas cosas imposibles ("todo va a ir bien seguro", "esto se va a arreglar sí o sí").
- Valida siempre la emoción de la persona ("tiene sentido que te sientas así", "no estás exagerando").
- Usa un tono cercano, en español, sencillo, sin tecnicismos.
- No minimices el problema ("no es para tanto", "hay gente peor").
- Si detectas riesgo serio (ideas de hacerse daño, etc.), anima a la persona a buscar ayuda profesional o de emergencia, sin dar instrucciones médicas.
`;

const SYSTEM_HELP = `
Eres Calmward, una IA de apoyo emocional que ayuda a ordenar ideas con calma.

REGLAS:
- Habla como una persona cercana, en español, tono tranquilo.
- Ayuda a la persona a separar problemas, verlos con perspectiva y elegir micro-acciones pequeñas.
- NO eres médico ni psicólogo, no hagas diagnósticos ni des recomendaciones médicas.
- No des listas gigantes de tareas; como máximo 1 o 2 pasos pequeños, muy concretos y realistas.
- Si aparece algo muy grave (autolesiones, suicidio, violencia), anima a la persona a pedir ayuda profesional o de emergencia.
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

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "calmward-api",
    provider: "groq",
    model: GROQ_MODEL,
    hasApiKey: !!GROQ_API_KEY,
    hasDatabase: !!DATABASE_URL,
  });
});

// ---------- AUTH: LOGIN / REGISTER ----------

// POST /auth/register-and-login
// Crea usuario (si no existe) y devuelve token
app.post("/auth/register-and-login", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        error: "DATABASE_URL no está configurada en el servidor.",
      });
    }

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Faltan 'email' o 'password' en el cuerpo." });
    }

    const normEmail = normalizeEmail(email);

    if (password.length < 6) {
      return res.status(400).json({
        error: "La contraseña debe tener al menos 6 caracteres.",
      });
    }

    let user = await findUserByEmail(normEmail);

    if (!user) {
      // Crear usuario nuevo
      user = await createUser(normEmail, password);
      if (!user) {
        // Raza de condición muy rara: alguien ha creado el user justo antes
        user = await findUserByEmail(normEmail);
      }
    } else {
      // Usuario ya existe: comprobar contraseña antes de loguear
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res
          .status(401)
          .json({ error: "Correo o contraseña incorrectos." });
      }
    }

    if (!user) {
      return res
        .status(500)
        .json({ error: "No se ha podido crear/recuperar el usuario." });
    }

    const token = await createSession(user.id);

    return res.json({
      token,
      isSponsor: !!user.is_sponsor,
    });
  } catch (err) {
    console.error("[Calmward] Error en /auth/register-and-login:", err);
    return res.status(500).json({
      error: "Ha habido un problema al registrar/iniciar sesión.",
    });
  }
});

// POST /auth/login
// Comprueba usuario + contraseña y devuelve token
app.post("/auth/login", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        error: "DATABASE_URL no está configurada en el servidor.",
      });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Faltan 'email' o 'password' en el cuerpo." });
    }

    const normEmail = normalizeEmail(email);
    const user = await findUserByEmail(normEmail);

    if (!user) {
      return res
        .status(401)
        .json({ error: "Correo o contraseña incorrectos." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ error: "Correo o contraseña incorrectos." });
    }

    const token = await createSession(user.id);

    return res.json({
      token,
      isSponsor: !!user.is_sponsor,
    });
  } catch (err) {
    console.error("[Calmward] Error en /auth/login:", err);
    return res
      .status(500)
      .json({ error: "Ha habido un problema al iniciar sesión." });
  }
});

// ---------- POST /ai/talk (IA EMOCIONAL) ----------

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

// ---------- ARRANQUE SERVIDOR ----------

app.listen(PORT, () => {
  console.log(`Calmward API escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
  console.log(
    `? DB: ${DATABASE_URL ? "conectada (DATABASE_URL presente)" : "NO CONFIGURADA"}`
  );
});
