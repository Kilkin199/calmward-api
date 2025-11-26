// api/index.js
// Servidor Calmward: IA (Groq) + Auth con base de datos (PostgreSQL en Render)

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const crypto = require("crypto");

// Polyfill de fetch para Node en Render (por si no está definido)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ----------- CONFIG IA (GROQ) -------------

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// ----------- CONFIG BD (POSTGRES) ----------

const DATABASE_URL = process.env.DATABASE_URL || null;
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Render PostgreSQL
  });
} else {
  console.warn(
    "?? No hay DATABASE_URL configurado. Las cuentas no se guardarán en BD."
  );
}

// Crea tablas si no existen
async function ensureDb() {
  if (!pool) return;

  // Tabla de usuarios
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_sponsor BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Tabla de sesiones simples
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// Generar token aleatorio para la sesión
function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ----------- PROMPTS DEL MODELO (PERSONALIDADES) -----------

const SYSTEM_LISTEN = `
Eres Calmward, una IA de apoyo emocional centrada solo en ESCUCHAR y ACOMPAÑAR.

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
- No des listas de tareas ni "planes", solo acompañamiento y comprensión.
`;

const SYSTEM_HELP = `
Eres Calmward, una IA de apoyo emocional en modo "ayúdame a ordenar".

Tu función aquí es:
- Ayudar a la persona a ENTENDER mejor lo que le pasa.
- Separar problemas, ponerles nombre y proponer PASOS PEQUEÑOS y realistas.

Estilo:
- Hablas en español, cercano y tranquilo.
- Estructuras tus respuestas: primero entiendes, luego ordenas, luego propones 1–2 acciones pequeñas.
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

// ----------- RUTA DE SALUD -----------

app.get("/", async (_req, res) => {
  let dbOk = false;
  if (pool) {
    try {
      await ensureDb();
      await pool.query("SELECT 1");
      dbOk = true;
    } catch (e) {
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

// ----------- AUTH: REGISTER + LOGIN EN UNO -----------

app.post("/auth/register-and-login", async (req, res) => {
  try {
    if (!pool || !DATABASE_URL) {
      return res.status(500).json({
        error:
          "No hay base de datos configurada en el servidor. Falta DATABASE_URL.",
      });
    }

    await ensureDb();

    const { email, password } = req.body || {};
    const rawEmail = String(email || "").trim().toLowerCase();
    const rawPassword = String(password || "");

    if (!rawEmail || !rawEmail.includes("@")) {
      return res.status(400).json({ error: "Correo no válido." });
    }
    if (!rawPassword || rawPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "La contraseña debe tener al menos 6 caracteres." });
    }

    // ¿Existe ya el usuario?
    const existing = await pool.query(
      "SELECT id, email, password_hash, is_sponsor FROM users WHERE email = $1",
      [rawEmail]
    );

    let userRow;

    if (existing.rowCount > 0) {
      // Ya existe: comprobamos contraseña y logeamos
      userRow = existing.rows[0];
      const ok = await bcrypt.compare(rawPassword, userRow.password_hash);
      if (!ok) {
        return res
          .status(401)
          .json({ error: "Correo o contraseña incorrectos." });
      }
    } else {
      // No existe: lo creamos
      const hash = await bcrypt.hash(rawPassword, 10);
      const inserted = await pool.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, is_sponsor",
        [rawEmail, hash]
      );
      userRow = inserted.rows[0];
    }

    const token = createToken();
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

// ----------- AUTH: SOLO LOGIN -----------

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
    const rawEmail = String(email || "").trim().toLowerCase();
    const rawPassword = String(password || "");

    if (!rawEmail || !rawPassword) {
      return res
        .status(400)
        .json({ error: "Debes indicar correo y contraseña." });
    }

    const existing = await pool.query(
      "SELECT id, email, password_hash, is_sponsor FROM users WHERE email = $1",
      [rawEmail]
    );

    if (existing.rowCount === 0) {
      return res
        .status(401)
        .json({ error: "No existe ninguna cuenta con ese correo." });
    }

    const userRow = existing.rows[0];
    const ok = await bcrypt.compare(rawPassword, userRow.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ error: "Correo o contraseña incorrectos." });
    }

    const token = createToken();
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

// ----------- IA: POST /ai/talk -----------

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

// ----------- ARRANCAR SERVIDOR -----------

app.listen(PORT, () => {
  console.log(`Calmward API escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
  if (DATABASE_URL) {
    console.log("? DATABASE_URL configurado. Intentando preparar tablas...");
    ensureDb()
      .then(() => console.log("Tablas listas (users, sessions)."))
      .catch((err) => console.error("Error preparando la BD:", err));
  } else {
    console.log("?? Sin DATABASE_URL: no habrá persistencia de usuarios.");
  }
});
