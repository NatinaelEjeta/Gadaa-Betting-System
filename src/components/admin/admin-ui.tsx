"use client";

/**
 * Shared building blocks for the admin panel: role helpers, error helpers,
 * status badges, stat cards, pagination, skeletons and empty states.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { DictKey } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n";
import { ApiClientError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

export const ADMIN_ROLES = ["SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"] as const;
export const EDITOR_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export function can(role: string | null | undefined, roles: readonly string[]): boolean {
  return !!role && roles.includes(role);
}

/** Extract a human-readable message from a thrown value (ApiClientError etc.). */
export function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const KNOWN_STATUSES = new Set([
  "ACTIVE", "SUSPENDED", "BANNED", "NONE", "PENDING", "APPROVED", "REJECTED",
  "PROCESSING", "PAID", "FAILED", "SCHEDULED", "LIVE", "FINISHED", "POSTPONED",
  "CANCELLED", "PENDING_ACCEPTANCE", "OPEN", "WON", "LOST", "CASHED_OUT", "VOID", "SETTLED",
]);

type Toner = (k: DictKey, vars?: Record<string, string | number>) => string;

export function statusLabel(status: string, t: Toner): string {
  if (KNOWN_STATUSES.has(status)) return t(`admin.st.${status}` as DictKey);
  return status.replaceAll("_", " ");
}

const TONE_CLASSES: Record<string, string> = {
  good: "border-primary/30 bg-primary/10 text-primary",
  warn: "border-[var(--chart-2)]/50 bg-[var(--chart-2)]/10 text-[var(--chart-2)]",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "text-muted-foreground",
};

const STATUS_TONE: Record<string, keyof typeof TONE_CLASSES> = {
  ACTIVE: "good", APPROVED: "good", PAID: "good", WON: "good", LIVE: "good", OPEN: "good",
  PENDING: "warn", PENDING_ACCEPTANCE: "warn", PROCESSING: "warn", SCHEDULED: "warn",
  SUSPENDED: "bad", BANNED: "bad", REJECTED: "bad", LOST: "bad", FAILED: "bad", POSTPONED: "bad",
  CANCELLED: "muted", VOID: "muted", FINISHED: "muted", CASHED_OUT: "muted", SETTLED: "muted", NONE: "muted",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  const tone = STATUS_TONE[status] ?? "muted";
  return (
    <Badge variant="outline" className={cn("font-medium", TONE_CLASSES[tone], className)}>
      {statusLabel(status, t)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      )}
      {hint ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PageNav({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">
        {t("admin.page", { page, totalPages })}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={t("admin.prev")}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label={t("admin.next")}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cn("h-6 flex-1", c === 0 && "max-w-[140px]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function EmptyState({ colSpan, label }: { colSpan: number; label?: string }) {
  const { t } = useI18n();
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
        {label ?? t("admin.noResults")}
      </td>
    </tr>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <span className="text-destructive">{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden />;
}

/** Human-readable age from a YYYY-MM-DD date of birth. */
export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}
