import "server-only";
import { db } from "@/lib/db";

/** Append-only audit trail for every privileged / system action. */
export async function logAudit(entry: {
  actorId?: string | null;
  actorPhone?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  details?: unknown;
  ip?: string;
}) {
  try {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorPhone: entry.actorPhone ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        detailsJson: entry.details ? JSON.stringify(entry.details) : null,
        ip: entry.ip,
      },
    });
  } catch (err) {
    // auditing must never break the primary flow
    console.error("[audit] failed to write entry:", err);
  }
}

export async function notify(userId: string, type: string, title: string, body: string) {
  try {
    await db.notification.create({ data: { userId, type, title, body } });
  } catch (err) {
    console.error("[notify] failed:", err);
  }
}
