import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/chapa/route";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { makeUser, resetDb, balanceOf, ledgerOf } from "../helpers/world";

/**
 * Integration tests for POST /api/webhooks/chapa.
 *
 * Defense-in-depth pipeline under test:
 *   1. HMAC signature over the RAW body (401 on failure, nothing touched),
 *   2. server-side verify against the Chapa API (mocked here) — a valid
 *      webhook alone never credits a wallet,
 *   3. idempotent credit by tx_ref — replays can never double-credit.
 */

const WEBHOOK_SECRET = process.env.CHAPA_WEBHOOK_SECRET as string;

function sign(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex");
}

function webhookRequest(body: string, signature?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/webhooks/chapa", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature === undefined ? {} : { "x-chapa-signature": signature }),
    },
    body,
  });
}

/** A PENDING deposit + matching pending Transaction row, as createDeposit leaves them. */
async function makePendingDeposit(amountCents = 10_000) {
  const user = await makeUser();
  const txRef = `GAD-WH-${randomUUID().slice(0, 10)}`;
  await db.deposit.create({
    data: { userId: user.id, txRef, amountCents, status: "PENDING" },
  });
  await db.transaction.create({
    data: {
      userId: user.id,
      type: "DEPOSIT",
      status: "PENDING",
      amountCents,
      reference: txRef,
      provider: "CHAPA",
    },
  });
  return { user, txRef, amountCents };
}

function mockChapaVerify(opts: { success: boolean }) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      status: "success",
      data: {
        status: opts.success ? "success" : "failed",
        amount: "100.00",
        currency: "ETB",
        ref_id: "chapa_ref_42",
      },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  await resetDb();
  // isolate the credit math from the welcome/promo bonuses configured elsewhere
  await setSetting("platform.welcomeBonusPercent", 0);
  await setSetting("platform.referralBonusCents", 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/webhooks/chapa — valid signature", () => {
  it("credits the wallet after signature AND provider verification both pass", async () => {
    const { user, txRef, amountCents } = await makePendingDeposit();
    const fetchMock = mockChapaVerify({ success: true });
    const body = JSON.stringify({ event: "charge.success", tx_ref: txRef, status: "success" });

    const res = await POST(webhookRequest(body, sign(body)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, data: { credited: true } });

    // verify endpoint was consulted server-side before crediting
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetchMock).mock.calls[0][0])).toContain(`/transaction/verify/${txRef}`);

    // wallet credited exactly once, in real (stakeable) money
    expect((await balanceOf(user.id)).balanceCents).toBe(amountCents);

    // deposit + transaction rows flipped to SUCCESS
    const deposit = await db.deposit.findUniqueOrThrow({ where: { txRef } });
    expect(deposit.status).toBe("SUCCESS");
    expect(deposit.creditedAt).not.toBeNull();
    const txRow = await db.transaction.findFirstOrThrow({ where: { reference: txRef } });
    expect(txRow.status).toBe("SUCCESS");

    // auditable ledger entry against the payments counter-account
    const entries = await ledgerOf(user.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "DEPOSIT",
      direction: "CREDIT",
      amountCents,
      counterAccount: "PAYMENTS_CHAPA",
    });
  });

  it("answers 200 with credited:false when provider verification fails", async () => {
    const { user, txRef } = await makePendingDeposit();
    mockChapaVerify({ success: false });
    const body = JSON.stringify({ event: "charge.success", tx_ref: txRef });

    const res = await POST(webhookRequest(body, sign(body)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, data: { credited: false } });

    // webhook alone is never trusted: nothing was credited
    expect((await balanceOf(user.id)).balanceCents).toBe(0);
    expect((await db.deposit.findUniqueOrThrow({ where: { txRef } })).status).toBe("PENDING");
  });

  it("answers 200 processing_failed for a signed webhook with an unknown tx_ref", async () => {
    mockChapaVerify({ success: true });
    const body = JSON.stringify({ event: "charge.success", tx_ref: "GAD-DOES-NOT-EXIST" });

    const res = await POST(webhookRequest(body, sign(body)));
    expect(res.status).toBe(200); // never 5xx — Chapa would retry a hard failure forever
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "processing_failed" });
  });

  it("answers 400 for a correctly signed but malformed JSON body", async () => {
    const body = "{not-json";
    const res = await POST(webhookRequest(body, sign(body)));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "Invalid JSON" });
  });

  it("ignores signed payloads without a tx_ref", async () => {
    const body = JSON.stringify({ event: "charge.success" });
    const res = await POST(webhookRequest(body, sign(body)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, data: { ignored: "no tx_ref" } });
  });
});

describe("POST /api/webhooks/chapa — invalid signature", () => {
  it("rejects a wrong signature with 401 and credits nothing", async () => {
    const { user, txRef } = await makePendingDeposit();
    mockChapaVerify({ success: true }); // even a "successful" verify must never run
    const body = JSON.stringify({ event: "charge.success", tx_ref: txRef });

    const res = await POST(webhookRequest(body, sign(`${body}-tampered`)));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "Invalid signature" });

    expect((await balanceOf(user.id)).balanceCents).toBe(0);
    expect((await db.deposit.findUniqueOrThrow({ where: { txRef } })).status).toBe("PENDING");
    // the rejection itself is audited
    const audit = await db.auditLog.findFirst({ where: { action: "CHAPA_WEBHOOK_INVALID_SIG" } });
    expect(audit).not.toBeNull();
  });

  it("rejects a tampered body whose signature belongs to the original payload", async () => {
    const { txRef } = await makePendingDeposit();
    const legit = JSON.stringify({ event: "charge.success", tx_ref: txRef });
    const tampered = JSON.stringify({ event: "charge.success", tx_ref: txRef, status: "success" });

    const res = await POST(webhookRequest(tampered, sign(legit)));
    expect(res.status).toBe(401);
  });

  it("rejects when the signature header is missing entirely", async () => {
    const { txRef } = await makePendingDeposit();
    const body = JSON.stringify({ event: "charge.success", tx_ref: txRef });

    const res = await POST(webhookRequest(body));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/webhooks/chapa — replayed tx_ref", () => {
  it("credits a replayed webhook exactly once", async () => {
    const { user, txRef, amountCents } = await makePendingDeposit();
    mockChapaVerify({ success: true });
    const body = JSON.stringify({ event: "charge.success", tx_ref: txRef });
    const request = webhookRequest(body, sign(body)); // byte-identical delivery, twice

    const first = await POST(request);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ ok: true, data: { credited: true } });

    const replay = await POST(webhookRequest(body, sign(body)));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ ok: true, data: { credited: false } });

    // exactly one credit, one ledger row, one SUCCESS flip
    expect((await balanceOf(user.id)).balanceCents).toBe(amountCents);
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "DEPOSIT")).toHaveLength(1);
    expect((await db.deposit.findUniqueOrThrow({ where: { txRef } })).status).toBe("SUCCESS");
    expect((await db.transaction.findFirstOrThrow({ where: { reference: txRef } })).status).toBe("SUCCESS");
  });

  it("handles parallel duplicate deliveries without double-crediting", async () => {
    const { user, txRef, amountCents } = await makePendingDeposit();
    mockChapaVerify({ success: true });
    const body = JSON.stringify({ event: "charge.success", tx_ref: txRef });

    const responses = await Promise.all([
      POST(webhookRequest(body, sign(body))),
      POST(webhookRequest(body, sign(body))),
      POST(webhookRequest(body, sign(body))),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);

    const payloads = await Promise.all(responses.map((r) => r.json()));
    expect(payloads.filter((p) => p.data.credited === true)).toHaveLength(1);

    expect((await balanceOf(user.id)).balanceCents).toBe(amountCents);
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "DEPOSIT")).toHaveLength(1);
  });
});
