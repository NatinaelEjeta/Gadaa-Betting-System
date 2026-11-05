import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, requireAuth } from "@/lib/api";

/** GET /api/admin/kyc?status= — KYC review queue (includes document images). */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["SUPPORT", "ADMIN", "SUPER_ADMIN"]);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "PENDING";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));

  const where = status === "ALL" ? {} : { status };
  const [total, docs] = await Promise.all([
    db.kycDocument.count({ where }),
    db.kycDocument.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * 10,
      take: 10,
      include: { user: { select: { id: true, phone: true, fullName: true, dateOfBirth: true, createdAt: true } } },
    }),
  ]);

  return ok({
    documents: docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      docNumber: d.docNumber,
      dateOfBirth: d.dateOfBirth,
      status: d.status,
      reviewerNote: d.reviewerNote,
      createdAt: d.createdAt.toISOString(),
      frontImage: d.frontImage,
      backImage: d.backImage,
      user: d.user,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / 10)),
  });
});
