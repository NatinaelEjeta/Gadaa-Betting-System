"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { formatDateTime, formatETB, formatOdds, timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { EmptyState, ErrorNote, InlineSpinner, PageNav, StatusBadge, TableSkeleton, can, errMsg } from "@/components/admin/admin-ui";

interface AdminBetLeg {
  eventName: string;
  marketName: string;
  selectionName: string;
  odds: number;
  status: string;
}

interface AdminBetRow {
  id: string;
  type: string;
  systemK: number | null;
  stakeCents: number;
  totalOdds: number;
  potentialWinCents: number;
  status: string;
  createdAt: string;
  settledAt: string | null;
  user: { id: string; phone: string; fullName: string };
  legs: AdminBetLeg[];
}

type BetsPage = { bets: AdminBetRow[]; total: number; page: number; totalPages: number };

const BET_FILTERS = ["ALL", "OPEN", "PENDING_ACCEPTANCE", "WON", "LOST", "CASHED_OUT", "VOID"] as const;
const OUTCOMES = ["WON", "LOST", "VOID"] as const;

export function BetsTab({ role }: { role: string | null }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const canSettle = can(role, ["ADMIN", "SUPER_ADMIN"]);

  const [filter, setFilter] = useState<(typeof BET_FILTERS)[number]>("ALL");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["admin", "bets", { filter, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (filter !== "ALL") params.set("status", filter);
      return api.get<BetsPage>(`/api/admin/bets?${params.toString()}`);
    },
  });

  const [legsView, setLegsView] = useState<AdminBetRow | null>(null);
  const [settleTarget, setSettleTarget] = useState<AdminBetRow | null>(null);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>("WON");
  const [payout, setPayout] = useState("");
  const [settling, setSettling] = useState(false);

  async function settleBet() {
    if (!settleTarget) return;
    setSettling(true);
    try {
      const body: { outcome: (typeof OUTCOMES)[number]; payoutCents?: number } = { outcome };
      if (outcome === "WON" && payout.trim() !== "") {
        const cents = Math.round(Number(payout) * 100);
        if (Number.isFinite(cents) && cents > 0) body.payoutCents = cents;
      }
      await api.post(`/api/admin/bets/${settleTarget.id}/settle`, body);
      toast.success(t("admin.betSettled"));
      setSettleTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "bets"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSettling(false);
    }
  }

  const legsSummary = (bet: AdminBetRow): string => {
    const first = bet.legs[0];
    if (!first) return "—";
    const label = `${first.eventName} · ${first.selectionName}`;
    return bet.legs.length > 1 ? `${label} +${bet.legs.length - 1}` : label;
  };

  const rows = list.data?.bets ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={filter} onValueChange={(v) => { setFilter(v as (typeof BET_FILTERS)[number]); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t("common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BET_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {f === "ALL" ? t("common.all") : t(`admin.st.${f}`)}
              </SelectItem>
            ))}
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
                <TableHead>ID</TableHead>
                <TableHead>{t("admin.user")}</TableHead>
                <TableHead>{t("admin.type")}</TableHead>
                <TableHead className="text-right">{t("slip.stake")}</TableHead>
                <TableHead className="text-right">{t("slip.totalOdds")}</TableHead>
                <TableHead className="text-right">{t("slip.potentialWin")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("bets.placedAt")}</TableHead>
                <TableHead>{t("admin.legs")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={10} className="p-2">
                    <TableSkeleton rows={6} cols={9} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <EmptyState colSpan={10} />
              ) : (
                rows.map((b) => {
                  const settleable = b.status === "OPEN" || b.status === "PENDING_ACCEPTANCE";
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs">{b.id.slice(0, 8)}…</TableCell>
                      <TableCell className="text-xs">{b.user.phone}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {b.type}
                          {b.type === "SYSTEM" && b.systemK ? ` ${b.systemK}/${b.legs.length}` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatETB(b.stakeCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatOdds(b.totalOdds)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatETB(b.potentialWinCents)}</TableCell>
                      <TableCell>
                        <StatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <span title={formatDateTime(b.createdAt)}>{timeAgo(b.createdAt)}</span>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="max-w-52 truncate text-left text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
                          onClick={() => setLegsView(b)}
                          title={legsSummary(b)}
                        >
                          {legsSummary(b)}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        {settleable && canSettle ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7"
                            onClick={() => {
                              setSettleTarget(b);
                              setOutcome("WON");
                              setPayout("");
                            }}
                          >
                            {t("admin.manualSettle")}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* legs detail dialog */}
      <Dialog open={legsView !== null} onOpenChange={(open) => !open && setLegsView(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{legsView?.id.slice(0, 12)}…</DialogTitle>
            <DialogDescription>
              {legsView ? `${legsView.user.fullName} · ${legsView.user.phone}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {legsView?.legs.map((leg, i) => (
              <div key={i} className="rounded-md border p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{leg.eventName}</span>
                  <StatusBadge status={leg.status} className="h-5 px-1.5 text-[10px]" />
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {leg.marketName} → <span className="font-medium text-foreground">{leg.selectionName}</span>{" "}
                  @{formatOdds(leg.odds)}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* manual settle dialog */}
      <Dialog open={settleTarget !== null} onOpenChange={(open) => !open && setSettleTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("admin.manualSettle")}</DialogTitle>
            <DialogDescription>
              {settleTarget
                ? `${settleTarget.user.phone} · ${formatETB(settleTarget.stakeCents)} @ ${formatOdds(settleTarget.totalOdds)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bet-outcome">{t("admin.outcome")}</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as (typeof OUTCOMES)[number])}>
                <SelectTrigger id="bet-outcome" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {t(`admin.st.${o}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {outcome === "WON" && (
              <div className="grid gap-1.5">
                <Label htmlFor="bet-payout">{t("admin.payoutEtb")}</Label>
                <Input
                  id="bet-payout"
                  value={payout}
                  onChange={(e) => setPayout(e.target.value)}
                  inputMode="decimal"
                  placeholder={(settleTarget ? settleTarget.potentialWinCents / 100 : 0).toFixed(2)}
                />
                <p className="text-xs text-muted-foreground">{t("admin.payoutHint")}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={settling} onClick={() => void settleBet()}>
              {settling ? <InlineSpinner /> : null}
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
