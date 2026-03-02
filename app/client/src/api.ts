import { getStoredToken } from "./store/authStore";

/**
 * Wraps fetch() and automatically attaches the Bearer token from the auth store.
 *
 * Use this for every REST mutation (POST / PATCH / DELETE) that requires auth.
 * Read-only GETs that don't require auth can use plain fetch().
 *
 * The Content-Type header is set to application/json automatically when a body
 * is provided and the caller has not already set it.
 */
export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}
