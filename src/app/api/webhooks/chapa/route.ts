import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/chapa";
import { verifyAndCreditDeposit } from "@/lib/payments";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/webhooks/chapa — Chapa payment webhook.
 *
 * Pipeline (defense in depth):
 *   1. validate the HMAC signature over the RAW body (x-chapa-signature)
 *   2. call the verify endpoint server-side (never trust the webhook alone)
 *   3. credit the wallet idempotently by tx_ref
 *
 * Always answer 200 quickly for valid events (Chapa retries non-2xx).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-chapa-signature") ?? req.headers.get("chapa-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    await logAudit({ action: "CHAPA_WEBHOOK_INVALID_SIG", entity: "webhook" });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: { event?: string; tx_ref?: string; status?: string; reference?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const txRef = payload.tx_ref ?? payload.reference;
  if (!txRef) {
    return NextResponse.json({ ok: true, data: { ignored: "no tx_ref" } });
  }

  try {
    const result = await verifyAndCreditDeposit(txRef);
    await logAudit({
      action: "CHAPA_WEBHOOK",
      entity: "deposit",
      entityId: txRef,
      details: { event: payload.event, credited: result.credited },
    });
    return NextResponse.json({ ok: true, data: { credited: result.credited } });
  } catch (err) {
    console.error("[chapa-webhook] processing failed:", err);
    // 200 with error info so Chapa doesn't infinitely retry a hard failure;
    // the deposit stays PENDING and can be re-verified manually.
    return NextResponse.json({ ok: false, error: "processing_failed" }, { status: 200 });
  }
}
