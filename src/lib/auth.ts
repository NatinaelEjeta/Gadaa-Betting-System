import "server-only";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

/**
 * Session management: stateless JWT (HS256) in an httpOnly cookie.
 * NextAuth-compatible pattern (credentials provider + JWT session), kept in-house
 * so every endpoint can enforce role checks without extra dependencies.
 */

export const SESSION_COOKIE = "gadaa_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  uid: string;
  phone: string;
  role: string; // USER | SUPPORT | FINANCE | ADMIN | SUPER_ADMIN
}

function secretKey(): Uint8Array {
  const secret =
    process.env.JWT_SECRET ??
    "gadaa-dev-secret-change-me-in-production-0123456789abcdef";
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  // bcrypt with cost 11 — argon2 is the alternative for production VPS deployments
  return bcrypt.hash(plain, 11);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("gadaa-betting")
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "gadaa-betting" });
    if (!payload.uid || !payload.role) return null;
    return { uid: payload.uid as string, phone: payload.phone as string, role: payload.role as string };
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Attach the session cookie to a response. */
export async function setSessionCookie(res: NextResponse, payload: SessionPayload) {
  const token = await signSession(payload);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}

/** Normalize Ethiopian phone numbers to +2519XXXXXXXX / +2517XXXXXXXX */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+251")) return digits;
  if (digits.startsWith("251")) return `+${digits}`;
  if (digits.startsWith("0")) return `+251${digits.slice(1)}`;
  if (/^9\d{8}$/.test(digits) || /^7\d{8}$/.test(digits)) return `+251${digits}`;
  return digits;
}

export function isValidEthiopianPhone(phone: string): boolean {
  return /^\+251(9|7)\d{8}$/.test(phone);
}
