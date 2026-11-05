import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, signTestCallback, verifyTestCallback, chapaTestMode } from "@/lib/chapa";

/**
 * Unit tests for Chapa webhook authenticity:
 * the x-chapa-signature header must be an HMAC-SHA256 (hex) of the RAW body
 * computed with CHAPA_WEBHOOK_SECRET, compared in constant time.
 */

const WEBHOOK_SECRET = process.env.CHAPA_WEBHOOK_SECRET as string;

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyWebhookSignature — configured secret", () => {
  const body = JSON.stringify({ event: "charge.success", tx_ref: "GAD-SIG-1", status: "success" });

  it("runs in live mode under the test env (secret + key configured)", () => {
    expect(chapaTestMode).toBe(false);
  });

  it("accepts a correct HMAC over the exact raw body", () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it("accepts a 'sha256=' prefixed signature (scheme-stripped comparison)", () => {
    expect(verifyWebhookSignature(body, `sha256=${sign(body)}`)).toBe(true);
  });

  it("rejects a signature produced with the wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "attacker-secret"))).toBe(false);
  });

  it("rejects a tampered body whose signature belongs to the original payload", () => {
    const tampered = body.replace("GAD-SIG-1", "GAD-SIG-2");
    expect(verifyWebhookSignature(tampered, sign(body))).toBe(false);
  });

  it("rejects a body that only differs in whitespace (raw bytes are signed)", () => {
    expect(verifyWebhookSignature(`${body} `, sign(body))).toBe(false);
  });

  it("rejects when the header is missing or empty", () => {
    expect(verifyWebhookSignature(body, null)).toBe(false);
    expect(verifyWebhookSignature(body, "")).toBe(false);
  });

  it("rejects a malformed signature of a different length without throwing", () => {
    expect(verifyWebhookSignature(body, "deadbeef")).toBe(false);
    expect(verifyWebhookSignature(body, "not-even-hex-🫠")).toBe(false);
  });
});

describe("verifyWebhookSignature — no secret configured (fallback policy)", () => {
  const body = JSON.stringify({ event: "charge.success", tx_ref: "GAD-SIG-2" });

  afterEach(() => {
    vi.resetModules();
  });

  /**
   * Re-imports the chapa module with the given env overrides applied FIRST
   * (module constants read the environment at import time).
   */
  async function importChapaWith(overrides: Record<string, string | undefined>) {
    const saved: Record<string, string | undefined> = {
      CHAPA_WEBHOOK_SECRET: process.env.CHAPA_WEBHOOK_SECRET,
      CHAPA_TEST_MODE: process.env.CHAPA_TEST_MODE,
      CHAPA_SECRET_KEY: process.env.CHAPA_SECRET_KEY,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    const mod = await import("@/lib/chapa");
    return {
      mod,
      restore() {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      },
    };
  }

  it("allows unsigned webhooks only when test mode is enabled (simulation)", async () => {
    const { mod, restore } = await importChapaWith({
      CHAPA_WEBHOOK_SECRET: undefined,
      CHAPA_TEST_MODE: undefined,
      CHAPA_SECRET_KEY: undefined, // empty key ⇒ chapaTestMode = true
    });
    try {
      expect(mod.chapaTestMode).toBe(true);
      expect(mod.verifyWebhookSignature(body, null)).toBe(true);
    } finally {
      restore();
    }
  });

  it("denies ALL webhooks when the secret is missing and test mode is off", async () => {
    const { mod, restore } = await importChapaWith({
      CHAPA_WEBHOOK_SECRET: undefined,
      CHAPA_TEST_MODE: "false",
      CHAPA_SECRET_KEY: "sk_something",
    });
    try {
      expect(mod.chapaTestMode).toBe(false);
      expect(mod.verifyWebhookSignature(body, null)).toBe(false);
      expect(mod.verifyWebhookSignature(body, sign(body))).toBe(false); // can't have been signed correctly
    } finally {
      restore();
    }
  });
});

describe("test-mode callback signing (mock checkout)", () => {
  it("signs and verifies its own simulated callbacks", () => {
    const sig = signTestCallback("GAD-MOCK-1");
    expect(verifyTestCallback("GAD-MOCK-1", sig)).toBe(true);
    expect(verifyTestCallback("GAD-MOCK-2", sig)).toBe(false); // bound to the tx_ref
    expect(verifyTestCallback("GAD-MOCK-1", "00".repeat(32))).toBe(false);
  });
});
