import { API_BASE_URL } from "../config";

function baseUrl() {
  // Nos aseguramos de no acabar con doble barra tipo: https://...//
  return API_BASE_URL.replace(/\/$/, "");
}

type UIMode = "LISTEN" | "HELP";

/**
 * Mapea el modo interno de la UI a lo que espera la API:
 *  - LISTEN -> "solo_escuchame"  (modo escucha, muy empático, sin estructura)
 *  - HELP   -> "ayudame_a_ordenar" (modo más guiado, pasos pequeños)
 */
function mapModeToApi(mode: UIMode): "solo_escuchame" | "ayudame_a_ordenar" {
  if (mode === "HELP") return "ayudame_a_ordenar";
  return "solo_escuchame";
}

export async function sendAIMessage(message: string, mode: UIMode) {
  const apiMode = mapModeToApi(mode);

  const res = await fetch(baseUrl() + "/ai/talk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      mode: apiMode,
      // De momento no mandamos historial; si quieres,
      // luego podemos enviar también los mensajes anteriores aquí.
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log("Error al llamar a /ai/talk:", res.status, text);
    throw new Error(
      "El servidor de Calmward ha devuelto un error. Inténtalo de nuevo en unos segundos."
    );
  }

  return res.json();
}
