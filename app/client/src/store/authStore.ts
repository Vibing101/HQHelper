import { create } from "zustand";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClientIdentity = {
  campaignId: string;
  role: "gm" | "player";
  playerId?: string;
  heroId?: string;
  /** JWT expiry (seconds since epoch) */
  exp?: number;
};

// ─── Token storage ────────────────────────────────────────────────────────────
//
// GM tokens are kept in localStorage so they survive tab/browser restarts
// (GMs need to resume their campaign across sessions).
// Player tokens are kept in sessionStorage — scoped to the current tab.

const STORAGE_KEY = "hq_token";

function readStoredToken(): string | null {
  return localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
}

function persistToken(token: string, role: "gm" | "player"): void {
  if (role === "gm") {
    localStorage.setItem(STORAGE_KEY, token);
  } else {
    sessionStorage.setItem(STORAGE_KEY, token);
  }
}

function removeStoredToken(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

// ─── JWT payload parser (client-side, no verification) ───────────────────────

function parsePayload(token: string): ClientIdentity | null {
  try {
    const part = token.split(".")[1];
    return JSON.parse(atob(part)) as ClientIdentity;
  } catch {
    return null;
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface AuthState {
  /** Raw JWT string, or null when not authenticated. */
  token: string | null;
  /** Decoded claims from the token (not server-verified client-side). */
  identity: ClientIdentity | null;

  /** Store a new token (replaces previous). */
  setToken: (token: string) => void;
  /** Clear auth state and remove stored token. */
  clearAuth: () => void;
}

const storedToken = readStoredToken();

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  identity: storedToken ? parsePayload(storedToken) : null,

  setToken: (token: string) => {
    const identity = parsePayload(token);
    if (identity) persistToken(token, identity.role);
    set({ token, identity });
  },

  clearAuth: () => {
    removeStoredToken();
    set({ token: null, identity: null });
  },
}));

// ─── Convenience accessor (for non-React contexts like socket.ts) ─────────────

/** Returns the current token string without subscribing to the store. */
export function getStoredToken(): string | null {
  return readStoredToken();
}
