import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "../config";

const TOKEN_KEY = "calmward_token";

function baseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

export async function saveDay(level: number, note: string) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const res = await fetch(baseUrl() + "/stats/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({ level, note }),
  });
  return res.json();
}

export async function getSummary() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const res = await fetch(baseUrl() + "/stats/summary", {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  return res.json();
}