import "server-only";
import { createHash, timingSafeEqual } from "crypto";

export function hashCode(code: string): string {
  return createHash("sha256").update(code + (process.env.JWT_SECRET ?? "")).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function maskPhone(phone: string): string {
  return phone.slice(0, 4) + " *** " + phone.slice(-3);
}