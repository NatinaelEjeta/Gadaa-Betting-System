import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { kycSchema } from "@/lib/validation";
import { ageFromDob } from "@/lib/money";
import { logAudit } from "@/lib/audit";

/** GET /api/kyc — my KYC documents & status. */
export const GET = route(async (req: NextRequest) => {
  const session = await requireAuth(req);
  const docs = await db.kycDocument.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, docType: true, docNumber: true, dateOfBirth: true,
      status: true, reviewerNote: true, reviewedAt: true, createdAt: true,
    },
  });
  return ok({ documents: docs });
});

/** POST /api/kyc — submit an ID document (Fayda / national ID / passport). */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const data = kycSchema.parse(await readJson(req));

  const pending = await db.kycDocument.findFirst({
    where: { userId: session.uid, status: "PENDING" },
  });
  if (pending) return fail("You already have a document under review", 409, "KYC_IN_PROGRESS");

  const age = ageFromDob(data.dateOfBirth);
  // Underage submissions are auto-rejected (18+ requirement)
  const status = age >= 18 ? "PENDING" : "REJECTED";

  const doc = await db.kycDocument.create({
    data: {
      userId: session.uid,
      docType: data.docType,
      docNumber: data.docNumber,
      dateOfBirth: data.dateOfBirth,
      frontImage: data.frontImage,
      backImage: data.backImage,
      status,
      reviewerNote: status === "REJECTED" ? "Applicant is under 18" : null,
      reviewedAt: status === "REJECTED" ? new Date() : null,
    },
  });

  await logAudit({
    actorId: session.uid,
    action: "KYC_SUBMIT",
    entity: "kyc",
    entityId: doc.id,
    ip: clientIp(req),
    details: { docType: data.docType, age },
  });

  return ok({
    id: doc.id,
    status: doc.status,
    message:
      status === "REJECTED"
        ? "Verification failed: you must be 18 or older."
        : "Document submitted — review usually completes within 24h.",
  });
});
