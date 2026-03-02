import type { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "../auth";

// ─── Extend Express Request ───────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      /** Verified JWT payload attached by requireToken middleware. */
      tokenPayload?: TokenPayload;
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that validates the Bearer token from the Authorization header.
 *
 * On success: attaches the decoded payload to req.tokenPayload and calls next().
 * On failure: returns 401 (missing/invalid token) or 403 (wrong role).
 *
 * @param roles  Optional allowlist of roles. Omit to permit any authenticated role.
 */
export function requireToken(roles?: Array<"gm" | "player">) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized: token required" });
    }

    try {
      const payload = verifyToken(token);
      if (roles && !roles.includes(payload.role)) {
        return res.status(403).json({ error: "Forbidden: insufficient role" });
      }
      req.tokenPayload = payload;
      next();
    } catch {
      return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
    }
  };
}

/**
 * Convenience guard: verifies the token's campaignId matches a route param.
 * Call after requireToken() to prevent cross-campaign mutations.
 *
 * Usage:  router.patch("/:id/...", requireToken(["gm"]), ownsCampaign("id"), ...)
 */
export function ownsCampaign(paramName = "id") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.tokenPayload?.campaignId !== req.params[paramName]) {
      return res.status(403).json({ error: "Forbidden: token is for a different campaign" });
    }
    next();
  };
}
