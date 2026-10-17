import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

// Resolved on first use, not at import: the custom server imports this module
// before it has loaded .env, and a secret frozen at that point would differ
// from the one Next uses, so every socket handshake would be rejected.
let secretKey: Uint8Array | null = null;
function secret(): Uint8Array {
  secretKey ??= new TextEncoder().encode(
    process.env.JWT_SECRET ?? "cipher-war-dev-secret-change-me-in-production",
  );
  return secretKey;
}

export const SESSION_COOKIE = "cw_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

export interface SessionPayload {
  sub: string;
  username: string;
  displayName: string;
  role: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secret());
}

export async function readToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      username: String(payload.username ?? ""),
      displayName: String(payload.displayName ?? ""),
      role: String(payload.role ?? "PLAYER"),
    };
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SEC,
  secure: process.env.NODE_ENV === "production",
};
