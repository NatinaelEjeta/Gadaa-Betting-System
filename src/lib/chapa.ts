import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Chapa payment gateway client (https://developer.chapa.co).
 *
 *  CHAPA_TEST_MODE=true (or no secret key): built-in simulator, no Chapa account needed.
 *  CHAPA_TEST_MODE=false + CHAPA_SECRET_KEY=CHASECK_TEST-...: the real Chapa API in
 *  Chapa's own test mode (no real money moves).
 */

const CHAPA_BASE = process.env.CHAPA_BASE_URL ?? "https://api.chapa.co/v1";
const SECRET_KEY = process.env.CHAPA_SECRET_KEY ?? "";
const EXPLICIT_WEBHOOK_SECRET = process.env.CHAPA_WEBHOOK_SECRET ?? "";
export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** true = built-in simulator. false = real Chapa API. */
export const chapaTestMode =
  (process.env.CHAPA_TEST_MODE ?? "true") !== "false" || SECRET_KEY.length === 0;

const WEBHOOK_SECRET = EXPLICIT_WEBHOOK_SECRET || (chapaTestMode ? "" : SECRET_KEY);
const LIVE_KEY = SECRET_KEY.length > 0 && !/TEST/i.test(SECRET_KEY);

export interface ChapaInitResult {
  checkoutUrl: string;
  providerRef?: string;
}

export interface ChapaVerifyResult {
  success: boolean;
  amountETB?: number;
  currency?: string;
  providerRef?: string;
  txRef?: string;
  mode?: string;
}

function assertConfigured() {
  if (chapaTestMode) return;
  if (!SECRET_KEY) throw new Error("CHAPA_SECRET_KEY missing");
  if (LIVE_KEY && process.env.NODE_ENV !== "production" && process.env.CHAPA_ALLOW_LIVE !== "true") {
    throw new Error("Refusing to use a LIVE Chapa key in development. Use a CHASECK_TEST key.");
  }
}

function errText(message: unknown): string {
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(message);
  } catch {
    return "unknown";
  }
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Sign our simulated checkout callback (simulator only). */
export function signTestCallback(txRef: string): string {
  return createHmac("sha256", WEBHOOK_SECRET || "gadaa-test-webhook-secret")
    .update(`mock-pay:${txRef}`)
    .digest("hex");
}

export function verifyTestCallback(txRef: string, sig: string): boolean {
  return sameHex(signTestCallback(txRef), sig ?? "");
}

/**
 * Validate a webhook signature. Chapa sends x-chapa-signature (HMAC-SHA256 of the
 * payload) and chapa-signature (HMAC-SHA256 of the secret). Either is accepted;
 * the credit path still re-verifies the payment with Chapa before paying anything.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET) return chapaTestMode;
  if (!signature) return false;
  const provided = (signature.startsWith("sha256=") ? signature.slice(7) : signature).toLowerCase();
  const candidates = [
    createHmac("sha256", WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex"),
    createHmac("sha256", WEBHOOK_SECRET).update(WEBHOOK_SECRET, "utf8").digest("hex"),
  ];
  return candidates.some((c) => sameHex(c, provided));
}

/** Initialize a deposit and return the hosted checkout URL. */
export async function initializeTransaction(params: {
  txRef: string;
  amountCents: number;
  phone: string;
  fullName: string;
  email?: string;
  callbackUrl: string;
  returnUrl: string;
}): Promise<ChapaInitResult> {
  assertConfigured();
  const amountETB = (params.amountCents / 100).toFixed(2);

  if (chapaTestMode) {
    const sig = signTestCallback(params.txRef);
    return {
      checkoutUrl: `/api/deposits/mock-pay?tx_ref=${encodeURIComponent(params.txRef)}&sig=${sig}`,
      providerRef: `sim_${params.txRef.slice(0, 12)}`,
    };
  }

  const digits = params.phone.replace(/\D/g, "");
  const localPhone = digits.startsWith("251") ? "0" + digits.slice(3) : digits;
  const [firstName, ...rest] = params.fullName.trim().split(/\s+/);

  const res = await fetch(`${CHAPA_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountETB,
      currency: "ETB",
      ...((params.email ?? process.env.CHAPA_FALLBACK_EMAIL) ? { email: params.email ?? process.env.CHAPA_FALLBACK_EMAIL } : {}),
      first_name: firstName || "Gadaa",
      last_name: rest.join(" ") || "User",
      phone_number: localPhone,
      tx_ref: params.txRef,
      callback_url: params.callbackUrl,
      return_url: params.returnUrl,
      customization: { title: "Gadaa Betting", description: "Wallet deposit" },
    }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as
    | { status?: string; message?: unknown; data?: { checkout_url?: string; reference?: string } }
    | null;

  if (!res.ok || !json?.data?.checkout_url) {
    throw new Error(`Chapa initialize failed (${res.status}): ${errText(json?.message)}`);
  }
  return { checkoutUrl: json.data.checkout_url, providerRef: json.data.reference };
}

/** Verify a transaction server-side. Always called before crediting a wallet. */
export async function verifyTransaction(txRef: string): Promise<ChapaVerifyResult> {
  assertConfigured();

  if (chapaTestMode) {
    const { db } = await import("@/lib/db");
    const deposit = await db.deposit.findUnique({ where: { txRef } });
    if (!deposit) return { success: false };
    const meta = safeParse(deposit.metaJson);
    return {
      success: meta?.mockPaid === true,
      amountETB: deposit.amountCents / 100,
      currency: deposit.currency,
      providerRef: deposit.providerRef ?? undefined,
    };
  }

  const res = await fetch(`${CHAPA_BASE}/transaction/verify/${encodeURIComponent(txRef)}`, {
    headers: { Authorization: `Bearer ${SECRET_KEY}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | {
        status?: string;
        data?: {
          status?: string;
          amount?: number | string;
          currency?: string;
          reference?: string;
          ref_id?: string;
          tx_ref?: string;
          mode?: string;
        };
      }
    | null;
  if (!res.ok || !json?.data) return { success: false };
  const d = json.data;
  const amount = typeof d.amount === "string" ? Number.parseFloat(d.amount) : d.amount;
  const refOk = !d.tx_ref || d.tx_ref === txRef;
  return {
    success: json.status === "success" && d.status === "success" && refOk,
    amountETB: amount,
    currency: d.currency,
    providerRef: d.reference ?? d.ref_id,
    txRef: d.tx_ref,
    mode: d.mode,
  };
}

export type TransferMethod = "TELEBIRR" | "CBE_BIRR" | "BANK";

// ---- bank list (Chapa transfers need a numeric bank_code) ----
let banksCache: { at: number; list: Array<{ id: number; name: string }> } | null = null;

async function getBanks(): Promise<Array<{ id: number; name: string }>> {
  if (banksCache && Date.now() - banksCache.at < 6 * 3600_000) return banksCache.list;
  const res = await fetch(`${CHAPA_BASE}/banks`, {
    headers: { Authorization: `Bearer ${SECRET_KEY}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: Array<{ id?: number; name?: string }> }
    | null;
  const list = (json?.data ?? [])
    .filter((b): b is { id: number; name: string } => typeof b?.id === "number" && typeof b?.name === "string");
  if (!res.ok || list.length === 0) throw new Error("Could not load the Chapa bank list");
  banksCache = { at: Date.now(), list };
  return list;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function resolveBankCode(method: TransferMethod, bankName?: string): Promise<number | null> {
  const banks = await getBanks();
  if (method === "TELEBIRR") return banks.find((b) => norm(b.name).includes("telebirr"))?.id ?? null;
  if (method === "CBE_BIRR") return banks.find((b) => norm(b.name).includes("cbebirr"))?.id ?? null;
  const want = norm(bankName ?? "");
  if (!want) return null;
  const banksOnly = banks.filter((b) => !/telebirr|cbebirr/.test(norm(b.name)));
  const exact = banksOnly.find((b) => norm(b.name) === want);
  if (exact) return exact.id;
  return banksOnly.find((b) => norm(b.name).includes(want) || want.includes(norm(b.name)))?.id ?? null;
}

/** Chapa wants digits only (4-18). Mobile money is written as 09xxxxxxxx unless CHAPA_MOBILE_FORMAT=intl. */
function formatAccountNumber(method: TransferMethod, raw: string): string {
  if (method === "BANK") return raw.replace(/[\s-]/g, "");
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("251")) d = "0" + d.slice(3);
  else if (d.length === 9 && /^[79]/.test(d)) d = "0" + d;
  if (process.env.CHAPA_MOBILE_FORMAT === "intl" && d.startsWith("0")) d = "251" + d.slice(1);
  return d;
}

/** Payout via Chapa Transfers (telebirr, CBE Birr, or bank account). Queued = accepted by Chapa. */
export async function initiateTransfer(params: {
  reference: string;
  amountCents: number;
  method: TransferMethod;
  accountName: string;
  accountNumber: string;
  bankName?: string;
}): Promise<{ success: boolean; providerRef?: string; message?: string }> {
  assertConfigured();

  if (chapaTestMode) {
    return { success: true, providerRef: `simtr_${params.reference}` };
  }

  try {
    const bankCode = await resolveBankCode(params.method, params.bankName);
    if (bankCode === null) {
      return { success: false, message: "Bank not found in Chapa's bank list. Check the bank name." };
    }

    const res = await fetch(`${CHAPA_BASE}/transfers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_name: params.accountName,
        account_number: formatAccountNumber(params.method, params.accountNumber),
        amount: (params.amountCents / 100).toFixed(2),
        currency: "ETB",
        reference: params.reference,
        bank_code: bankCode,
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as
      | { status?: string; message?: unknown; data?: string | { reference?: string; id?: string } | null }
      | null;
    const data = json?.data;
    const providerRef =
      typeof data === "string" ? data : data && typeof data === "object" ? (data.reference ?? data.id) : undefined;
    return {
      success: res.ok && json?.status === "success",
      providerRef,
      message: errText(json?.message),
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Transfer request failed" };
  }
}

function safeParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}