import { API_BASE_URL } from "../config";

function baseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

export async function sendAIMessage(message: string, mode: "LISTEN" | "HELP") {
  const res = await fetch(baseUrl() + "/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode }),
  });
  return res.json();
}