import jwt from "jsonwebtoken";

// ─── Token Payload ────────────────────────────────────────────────────────────

/**
 * The identity claims embedded in every signed token.
 *
 * role: "gm"    → issued on POST /api/campaigns (campaign creator)
 * role: "player" → issued on GET /api/campaigns/join/:code
 *                  updated with heroId after POST /api/heroes or POST /api/heroes/:id/claim
 */
export type TokenPayload = {
  campaignId: string;
  role: "gm" | "player";
  playerId?: string;
  heroId?: string;
};

// ─── Secret ───────────────────────────────────────────────────────────────────

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[auth] JWT_SECRET environment variable is required in production. " +
        "Set it in your .env or systemd environment."
      );
    }
    console.warn(
      "[auth] JWT_SECRET is not set — using insecure dev fallback. " +
      "Set JWT_SECRET in .env before deploying."
    );
    return "dev-secret-change-in-production";
  }
  return secret;
}

// ─── Sign / Verify ────────────────────────────────────────────────────────────

/** Issue a signed 24-hour JWT for a given identity payload. */
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "24h" });
}

/**
 * Verify and decode a JWT.
 * Throws a JsonWebTokenError if the token is invalid or expired.
 */
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, getSecret()) as TokenPayload;
}
