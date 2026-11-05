"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { formatDateTime, formatETB } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorNote,
  InlineSpinner,
  PageNav,
  StatusBadge,
  TableSkeleton,
  errMsg,
} from "@/components/admin/admin-ui";

interface WdRow {
  id: string;
  amountCents: number;
  feeCents: number;
  method: string;
  accountName: string;
  accountNumber: string;
  bankName: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  processedAt: string | null;
  user: { id: string; phone: string; fullName: string; wallet: { balanceCents: number } };
}

type WdPage = { withdrawals: WdRow[]; total: number; page: number; totalPages: number };
type WdFilter = "PENDING" | "PROCESSING" | "PAID" | "REJECTED" | "ALL";

export function WithdrawalsTab() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<WdFilter>("PENDING");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["admin", "withdrawals", { filter, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (filter !== "ALL") params.set("status", filter);
      return api.get<WdPage>(`/api/admin/withdrawals?${params.toString()}`);
    },
  });

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WdRow | null>(null);
  const [note, setNote] = useState("");

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "withdrawals"] });

  async function act(id: string, action: "APPROVE" | "REJECT", rejectNote?: string) {
    setBusyId(id);
    try {
      await api.post(`/api/admin/withdrawals/${id}`, { action, note: rejectNote || undefined });
      toast.success(action === "APPROVE" ? t("admin.withdrawalApproved") : t("admin.withdrawalRejected"));
      invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  const rows = list.data?.withdrawals ?? [];
  const actionable = (w: WdRow) => w.status === "PENDING" || w.status === "PROCESSING";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={filter} onValueChange={(v) => { setFilter(v as WdFilter); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t("common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">{t("admin.st.PENDING")}</SelectItem>
            <SelectItem value="PROCESSING">{t("admin.st.PROCESSING")}</SelectItem>
            <SelectItem value="PAID">{t("admin.st.PAID")}</SelectItem>
            <SelectItem value="REJECTED">{t("admin.st.REJECTED")}</SelectItem>
            <SelectItem value="ALL">{t("common.all")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          {list.data && (
            <PageNav page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
          )}
        </div>
      </div>

      {list.isError ? (
        <ErrorNote message={errMsg(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.user")}</TableHead>
                <TableHead className="text-right">{t("common.amount")}</TableHead>
                <TableHead className="text-right">{t("admin.fee")}</TableHead>
                <TableHead>{t("admin.method")}</TableHead>
                <TableHead>{t("admin.account")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={8} className="p-2">
                    <TableSkeleton rows={6} cols={7} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <EmptyState colSpan={8} />
              ) : (
                rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{w.user.fullName}</span>
                        <span className="text-xs text-muted-foreground">{w.user.phone}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatETB(w.amountCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatETB(w.feeCents)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {w.method}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{w.accountName}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {w.bankName ? `${w.bankName} · ` : ""}
                          {w.accountNumber}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={w.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(w.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {actionable(w) ? (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={busyId !== null}
                            onClick={() => {
                              setRejectTarget(w);
                              setNote("");
                            }}
                          >
                            {t("admin.reject")}
                          </Button>
                          <Button size="sm" disabled={busyId !== null} onClick={() => void act(w.id, "APPROVE")}>
                            {busyId === w.id ? <InlineSpinner /> : null}
                            {t("admin.approve")}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("admin.withdrawalNote")}</p>

      {/* reject with note */}
      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.reject")}</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `${rejectTarget.user.fullName} · ${formatETB(rejectTarget.amountCents)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("admin.note")}
            rows={3}
            maxLength={300}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busyId !== null}
              onClick={() => {
                if (!rejectTarget) return;
                void act(rejectTarget.id, "REJECT", note.trim() || undefined);
                setRejectTarget(null);
              }}
            >
              {busyId !== null ? <InlineSpinner /> : null}
              {t("admin.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
