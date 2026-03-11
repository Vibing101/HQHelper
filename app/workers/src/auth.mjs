const textEncoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importSigningKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function getSecret(env) {
  const secret = env.JWT_SECRET;
  if (secret) return secret;
  if (env.APP_ENV && env.APP_ENV !== "dev") {
    throw new Error("JWT_SECRET is not configured");
  }
  return "dev-secret-change-in-production";
}

function getNowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export async function signToken(env, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const issuedAt = getNowInSeconds();
  const fullPayload = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + 24 * 60 * 60,
  };

  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(fullPayload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const key = await importSigningKey(getSecret(env));
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(unsignedToken));

  return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyToken(env, token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const key = await importSigningKey(getSecret(env));
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(encodedSignature),
    textEncoder.encode(unsignedToken),
  );

  if (!isValid) {
    throw new Error("Invalid token");
  }

  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  if (typeof payload.exp === "number" && payload.exp < getNowInSeconds()) {
    throw new Error("Expired token");
  }

  return payload;
}

export async function requireToken(request, env, roles) {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return { error: { status: 401, body: { error: "Unauthorized: token required" } } };
  }

  try {
    const payload = await verifyToken(env, token);
    if (roles?.length && !roles.includes(payload.role)) {
      return { error: { status: 403, body: { error: "Forbidden: insufficient role" } } };
    }
    return { payload };
  } catch {
    return { error: { status: 401, body: { error: "Unauthorized: invalid or expired token" } } };
  }
}
