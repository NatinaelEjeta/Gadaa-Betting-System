import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail } from "@/lib/api";
import { verifyAndCreditDeposit } from "@/lib/payments";
import { chapaTestMode, verifyTestCallback, APP_URL } from "@/lib/chapa";

/**
 * GET /api/deposits/mock-pay?tx_ref=&sig=
 *
 * TEST MODE ONLY — simulates the Chapa hosted checkout page. Completing it
 * marks the payment as paid at the "provider", then runs the exact same
 * verify → idempotent-credit pipeline a real Chapa callback would trigger.
 * Signature-protected so it can't be used to self-credit.
 */
export async function GET(req: NextRequest) {
  if (!chapaTestMode) {
    return NextResponse.redirect(`${APP_URL}/`);
  }
  const txRef = req.nextUrl.searchParams.get("tx_ref");
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!txRef || !verifyTestCallback(txRef, sig)) {
    return fail("Invalid mock payment signature", 400, "INVALID_SIGNATURE");
  }

  const deposit = await db.deposit.findUnique({ where: { txRef } });
  if (!deposit) return fail("Deposit not found", 404, "NOT_FOUND");

  // "provider side": record the simulated successful payment
  const meta = deposit.metaJson ? JSON.parse(deposit.metaJson) : {};
  await db.deposit.update({
    where: { txRef },
    data: { metaJson: JSON.stringify({ ...meta, mockPaid: true }) },
  });

  // gateway → our verify + credit pipeline (identical to a real webhook)
  await verifyAndCreditDeposit(txRef);

  // simulate Chapa returning the user to the app
  return NextResponse.redirect(`${APP_URL}/?deposit=success&tx_ref=${encodeURIComponent(txRef)}`);
}
