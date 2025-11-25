// api/index.js
// Servidor IA para Calmward usando Groq (Llama 3.1 en la nube)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

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

// Ruta de salud
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "calmward-api",
    provider: "groq",
    model: GROQ_MODEL,
    hasApiKey: !!GROQ_API_KEY,
  });
});

// ---------- POST /ai/talk ----------
// Body esperado:
// {
//   "message": "texto del usuario",
//   "mode": "solo_escuchame" | "ayudame_a_ordenar",
//   "history": [ { role: "user"|"assistant", content: "..." }, ... ]  (opcional)
// }
app.post("/ai/talk", async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
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

app.listen(PORT, () => {
  console.log(`Calmward API (Groq) escuchando en puerto ${PORT}`);
  console.log(`? GROQ_MODEL = ${GROQ_MODEL}`);
});
