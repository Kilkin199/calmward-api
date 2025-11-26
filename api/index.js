// api/index.js
// Servidor Calmward: IA Groq + Auth con PostgreSQL

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

let pool = null;

if (!DATABASE_URL) {
  console.warn(
    "[Calmward API] WARNING: No hay DATABASE_URL. Auth real no funcionará."
  );
} else {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Render Postgres suele ir con SSL
  });
}

// Crea tablas básicas si no existen
async function ensureSchema() {
  if (!pool) return;

  const createSql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_sponsor BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  try {
    await pool.query(createSql);
    console.log("[Calmward API] Tablas users/sessions listas");
  } catch (err) {
    console.error("[Calmward API] Error creando tablas:", err);
  }
}

ensureSchema().catch((e) =>
  console.error("[Calmward API] Error en ensureSchema:", e)
);

// Helpers para tokens
function randomToken() {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

// ---------- CONFIG GROQ IA ----------

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// IMPORTANTE: este nombre de modelo debe existir en Groq
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// Prompts (personalidades distintas)

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
- Primero demuestra que has entendido lo que la persona cuenta (parafrasea un poco).
- Después, ayúdale a separar el problema en partes (por ejemplo: "lo que sientes", "lo que depende de ti", "lo que no depende de ti").
- Propón 1 o 2 acciones pequeñas y realistas, muy concretas, relacionadas con lo que ha dicho (por ejemplo: apuntar algo, mandar un mensaje, darse 10 minutos para algo sencillo, etc.).
- NO eres médico ni psicólogo, no hagas diagnósticos ni des recomendaciones médicas.
- No des listas gigantes de tareas; como máximo 1 o 2 pasos pequeños.
- Si aparece algo muy grave (autolesiones, suicidio, violencia), anima a la persona a pedir ayuda profesional o de emergencia.
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

// ---------- RUTA SALUD ----------

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

// ---------- AUTH: REGISTER + LOGIN EN UNO ----------

app.post("/auth/register-and-login", async (req, res) => {
  if (!pool) {
    return res.status(500).json({
      error: "No hay base de datos configurada. Falta DATABASE_URL.",
    });
  }

  try {
    const { email, password } = req.body || {};

    if (
      !email ||
      typeof email !== "string" ||
      !password ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        error: "Faltan 'email' o 'password'.",
      });
    }

    const normEmail = email.trim().toLowerCase();

    // ¿Existe ya el usuario?
    const existing = await pool.query(
      "SELECT id, password_hash, is_sponsor FROM users WHERE email = $1",
      [normEmail]
    );

    let userId;
    let isSponsor = false;

    if (existing.rows.length === 0) {
      // Crear nuevo usuario
      const hash = await bcrypt.hash(password, 10);
      const insert = await pool.query(
        "INSERT INTO users (email, password_hash, is_sponsor) VALUES ($1, $2, $3) RETURNING id, is_sponsor",
        [normEmail, hash, false]
      );
      userId = insert.rows[0].id;
      isSponsor = insert.rows[0].is_sponsor;
    } else {
      // Ya existe: comprobar contraseña
      const row = existing.rows[0];
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) {
        return res.status(401).json({
          error: "La contraseña no es correcta.",
        });
      }
      userId = row.id;
      isSponsor = row.is_sponsor;
    }

    // Crear sesión
    const token = randomToken();
    await pool.query(
      "INSERT INTO sessions (user_id, token) VALUES ($1, $2)",
      [userId, token]
    );

    return res.json({
      token,
      isSponsor,
    });
  } catch (err) {
    console.error("Error en /auth/register-and-login:", err);
    return res.status(500).json({
      error: "Error interno al registrar/iniciar sesión.",
    });
  }
});

// ---------- AUTH: SOLO LOGIN ----------

app.post("/auth/login", async (req, res) => {
  if (!pool) {
    return res.status(500).json({
      error: "No hay base de datos configurada. Falta DATABASE_URL.",
    });
  }

  try {
    const { email, password } = req.body || {};

    if (
      !email ||
      typeof email !== "string" ||
      !password ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        error: "Faltan 'email' o 'password'.",
      });
    }

    const normEmail = email.trim().toLowerCase();

    const q = await pool.query(
      "SELECT id, password_hash, is_sponsor FROM users WHERE email = $1",
      [normEmail]
    );

    if (q.rows.length === 0) {
      return res.status(401).json({
        error: "No existe ninguna cuenta con ese correo.",
      });
    }

    const user = q.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({
        error: "La contraseña no es correcta.",
      });
    }

    const token = randomToken();
    await pool.query(
      "INSERT INTO sessions (user_id, token) VALUES ($1, $2)",
      [user.id, token]
    );

    return res.json({
      token,
      isSponsor: user.is_sponsor,
    });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    return res.status(500).json({
      error: "Error interno al iniciar sesión.",
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

// ---------- ARRANQUE ----------

app.listen(PORT, () => {
  console.log(`Calmward API escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
  console.log(`? DB = ${DATABASE_URL ? "OK" : "NO CONFIGURADA"}`);
});
