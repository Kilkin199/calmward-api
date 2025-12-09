import { API_BASE_URL } from "../config";

async function api(path: string, method: string, token?: string, body?: any) {
  const headers: any = { "Content-Type": "application/json" };
  if (token) headers.Authorization = Bearer \;

  const res = await fetch(\\, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "Error de red");
  }
  return data;
}

export async function getPlans() {
  return api("/billing/plans", "GET");
}

export async function createSubscription(token: string, planKey: string) {
  return api("/billing/paypal/create-subscription", "POST", token, { planKey });
}

export async function confirmSubscription(
  token: string,
  subscriptionId: string,
  planKey: string
) {
  return api("/billing/paypal/confirm-subscription", "POST", token, {
    subscriptionId,
    planKey,
  });
}

export async function getMySubscription(token: string) {
  return api("/billing/subscription", "GET", token);
}
