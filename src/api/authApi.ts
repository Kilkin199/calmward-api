import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "../config";

const TOKEN_KEY = "calmward_token";
const USER_KEY = "calmward_user";

function baseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

export async function registerUser(data: {
  name: string;
  email: string;
  password: string;
  country?: string;
  acceptTerms?: boolean;
}) {
  const res = await fetch(baseUrl() + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function loginUser(email: string, password: string) {
  const res = await fetch(baseUrl() + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (data?.token) {
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
  }
  if (data?.user) {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
  }
  return data;
}

export async function recoverPassword(email: string) {
  const res = await fetch(baseUrl() + "/auth/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return res.json();
}

export async function logoutUser() {
  await AsyncStorage.removeItem(TOKEN_KEY);
  await AsyncStorage.removeItem(USER_KEY);
}

export async function getStoredToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredUser() {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}