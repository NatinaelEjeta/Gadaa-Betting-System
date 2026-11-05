"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Check, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ErrorNote,
  InlineSpinner,
  PageNav,
  StatusBadge,
  can,
  errMsg,
  useDebounced,
} from "@/components/admin/admin-ui";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (raw prisma event rows from GET /api/admin/events)
// ---------------------------------------------------------------------------

interface AdminSelection {
  id: string;
  name: string;
  odds: number;
  prevOdds: number | null;
  status: string;
}

interface AdminMarket {
  id: string;
  key: string;
  name: string;
  line: number | null;
  status: string;
  resultName: string | null;
  selections: AdminSelection[];
}

interface AdminEvent {
  id: string;
  startTime: string;
  status: string;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  featured: boolean;
  sport: { key: string; name: string };
  league: { name: string };
  homeTeam: { name: string };
  awayTeam: { name: string };
  markets: AdminMarket[];
}

type EventsPage = { events: AdminEvent[]; total: number; page: number; totalPages: number };

const EVENT_STATUSES = ["SCHEDULED", "LIVE", "FINISHED", "POSTPONED", "CANCELLED"] as const;

// ---------------------------------------------------------------------------
// Market editor (one row per market with its selections)
// ---------------------------------------------------------------------------

function MarketRow({ market, canEdit }: { market: AdminMarket; canEdit: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [resultName, setResultName] = useState(market.resultName ?? "");

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "events"] });

  async function patchMarket(body: { status?: string; resultName?: string }, successMsg: string) {
    setBusy(true);
    try {
      await api.patch(`/api/admin/markets/${market.id}`, body);
      toast.success(successMsg);
      invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function patchSelection(id: string, body: { odds?: number; status?: string }, successMsg: string) {
    setBusy(true);
    try {
      await api.patch(`/api/admin/selections/${id}`, body);
      toast.success(successMsg);
      invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{market.name}</span>
        <Badge variant="secondary" className="font-normal">{market.key}</Badge>
        {market.line !== null && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {market.line}
          </Badge>
        )}
        {market.status === "SETTLED" ? (
          <StatusBadge status="SETTLED" />
        ) : (
          <Select
            value={market.status}
            onValueChange={(v) => void patchMarket({ status: v }, t("admin.marketStatusSaved"))}
            disabled={!canEdit || busy}
          >
            <SelectTrigger size="sm" className="w-32" aria-label={t("common.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">{t("admin.st.OPEN")}</SelectItem>
              <SelectItem value="SUSPENDED">{t("admin.st.SUSPENDED")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {market.resultName && (
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            {t("admin.result")}: {market.resultName}
          </Badge>
        )}
      </div>

      {canEdit && market.status !== "SETTLED" && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={resultName}
            onChange={(e) => setResultName(e.target.value)}
            placeholder={t("admin.resultPlaceholder")}
            className="h-8 max-w-56 text-xs"
            maxLength={20}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy || !resultName.trim()}
            onClick={() => void patchMarket({ status: "SETTLED", resultName: resultName.trim() }, t("admin.resultSaved"))}
          >
            {t("admin.result")}
          </Button>
        </div>
      )}

      <Separator className="my-3" />

      <div className="flex flex-wrap gap-2">
        {market.selections.map((sel) => (
          <SelectionChip
            key={sel.id}
            selection={sel}
            canEdit={canEdit}
            disabled={busy}
            onSave={(odds) => void patchSelection(sel.id, { odds }, t("admin.oddsSaved"))}
            onToggle={() =>
              void patchSelection(
                sel.id,
                { status: sel.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" },
                t("admin.selectionSaved")
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function SelectionChip({
  selection,
  canEdit,
  disabled,
  onSave,
  onToggle,
}: {
  selection: AdminSelection;
  canEdit: boolean;
  disabled: boolean;
  onSave: (odds: number) => void;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const [odds, setOdds] = useState(String(selection.odds));
  const parsed = Number.parseFloat(odds);
  const changed = parsed !== selection.odds;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1.5",
        selection.status === "SUSPENDED" && "opacity-60"
      )}
    >
      <span className="text-xs font-medium">{selection.name}</span>
      {canEdit ? (
        <>
          <Input
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            inputMode="decimal"
            className="h-6 w-16 px-1.5 text-center text-xs tabular-nums"
            aria-label={t("admin.odds")}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={disabled || !changed || !(parsed >= 1.01)}
            onClick={() => onSave(parsed)}
            aria-label={t("common.save")}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-xs"
            disabled={disabled}
            onClick={onToggle}
            aria-label={selection.status === "SUSPENDED" ? t("admin.activate") : t("admin.suspend")}
          >
            {selection.status === "SUSPENDED" ? "▶" : "⏸"}
          </Button>
        </>
      ) : (
        <span className="text-xs tabular-nums text-muted-foreground">{selection.odds.toFixed(2)}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event row (scores, status, settle, expandable market editor)
// ---------------------------------------------------------------------------

function EventRow({ event, canEdit }: { event: AdminEvent; canEdit: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  // drafts stay null until the admin edits them, so server-side score updates flow through
  const [homeDraft, setHomeDraft] = useState<string | null>(null);
  const [awayDraft, setAwayDraft] = useState<string | null>(null);
  const home = homeDraft ?? String(event.homeScore ?? 0);
  const away = awayDraft ?? String(event.awayScore ?? 0);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleHome, setSettleHome] = useState(String(event.homeScore ?? 0));
  const [settleAway, setSettleAway] = useState(String(event.awayScore ?? 0));

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "events"] });

  async function patchEvent(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      await api.patch(`/api/admin/events/${event.id}`, body);
      toast.success(successMsg);
      invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    setBusy(true);
    try {
      const res = await api.post<{ payouts: number }>(`/api/admin/events/${event.id}`, {
        homeScore: Math.max(0, Math.round(Number(settleHome) || 0)),
        awayScore: Math.max(0, Math.round(Number(settleAway) || 0)),
      });
      toast.success(t("admin.settleDone", { count: res.payouts }));
      setSettleOpen(false);
      invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const scoreDirty = Number(home) !== (event.homeScore ?? 0) || Number(away) !== (event.awayScore ?? 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold">
                {event.homeTeam.name} <span className="text-muted-foreground">vs</span> {event.awayTeam.name}
              </span>
              {event.featured && <Star className="h-3.5 w-3.5 fill-[var(--chart-2)] text-[var(--chart-2)]" />}
              <StatusBadge status={event.status} />
              {event.status === "LIVE" && event.minute !== null && (
                <span className="text-xs font-medium text-[var(--chart-2)]">{event.minute}′</span>
              )}
              {event.homeScore !== null && event.awayScore !== null && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums">
                  {event.homeScore}:{event.awayScore}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {event.league.name} · {event.sport.name} · {formatDateTime(event.startTime)}
            </p>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Input
                  value={home}
                  onChange={(e) => setHomeDraft(e.target.value)}
                  inputMode="numeric"
                  className="h-8 w-12 px-1.5 text-center text-sm tabular-nums"
                  aria-label={t("admin.homeTeam")}
                />
                <span className="text-muted-foreground">:</span>
                <Input
                  value={away}
                  onChange={(e) => setAwayDraft(e.target.value)}
                  inputMode="numeric"
                  className="h-8 w-12 px-1.5 text-center text-sm tabular-nums"
                  aria-label={t("admin.awayTeam")}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={busy || !scoreDirty}
                  onClick={() =>
                    void patchEvent(
                      {
                        homeScore: Math.max(0, Math.round(Number(home) || 0)),
                        awayScore: Math.max(0, Math.round(Number(away) || 0)),
                      },
                      t("admin.scoreSaved")
                    )
                  }
                >
                  <Check className="h-4 w-4" />
                  {t("admin.saveScore")}
                </Button>
              </div>

              <Select
                value={event.status}
                onValueChange={(v) => void patchEvent({ status: v }, t("admin.statusSaved"))}
                disabled={busy}
              >
                <SelectTrigger size="sm" className="w-36" aria-label={t("common.status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`admin.st.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button size="sm" disabled={busy || event.status === "FINISHED"} onClick={() => setSettleOpen(true)}>
                {busy ? <InlineSpinner /> : null}
                {t("admin.settle")}
              </Button>
            </div>
          )}
        </div>

        {event.markets.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {t("admin.markets")} ({event.markets.length})
            </button>
            {expanded && (
              <div className="mt-2 space-y-2">
                {event.markets.map((m) => (
                  <MarketRow key={m.id} market={m} canEdit={canEdit} />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* manual settlement */}
      <AlertDialog open={settleOpen} onOpenChange={setSettleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.settleTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.settleDesc")}
              <br />
              <span className="font-medium text-foreground">
                {event.homeTeam.name} vs {event.awayTeam.name}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center justify-center gap-3 py-2">
            <Input
              value={settleHome}
              onChange={(e) => setSettleHome(e.target.value)}
              inputMode="numeric"
              className="h-10 w-16 text-center text-lg font-bold tabular-nums"
              aria-label={t("admin.homeTeam")}
            />
            <span className="text-lg text-muted-foreground">:</span>
            <Input
              value={settleAway}
              onChange={(e) => setSettleAway(e.target.value)}
              inputMode="numeric"
              className="h-10 w-16 text-center text-lg font-bold tabular-nums"
              aria-label={t("admin.awayTeam")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void settle();
              }}
            >
              {busy ? <InlineSpinner /> : null}
              {t("admin.settle")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export function EventsTab({ role }: { role: string | null }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const canEdit = can(role, ["ADMIN", "SUPER_ADMIN"]);

  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [status, setStatus] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["admin", "events", { q, status, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      if (status !== "ALL") params.set("status", status);
      return api.get<EventsPage>(`/api/admin/events?${params.toString()}`);
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    sportKey: "football",
    leagueName: "",
    homeTeamName: "",
    awayTeamName: "",
    startTime: "",
    featured: false,
    withStandardMarkets: true,
  });

  const createValid = useMemo(
    () =>
      form.leagueName.trim().length >= 2 &&
      form.homeTeamName.trim().length >= 2 &&
      form.awayTeamName.trim().length >= 2 &&
      form.startTime !== "" &&
      !Number.isNaN(new Date(form.startTime).getTime()),
    [form]
  );

  async function createEvent() {
    setCreating(true);
    try {
      await api.post("/api/admin/events", {
        sportKey: form.sportKey,
        leagueName: form.leagueName.trim(),
        homeTeamName: form.homeTeamName.trim(),
        awayTeamName: form.awayTeamName.trim(),
        startTime: new Date(form.startTime).toISOString(),
        featured: form.featured,
        withStandardMarkets: form.withStandardMarkets,
      });
      toast.success(t("admin.eventCreated"));
      setCreateOpen(false);
      setForm({ sportKey: "football", leagueName: "", homeTeamName: "", awayTeamName: "", startTime: "", featured: false, withStandardMarkets: true });
      void queryClient.invalidateQueries({ queryKey: ["admin", "events"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCreating(false);
    }
  }

  const rows = list.data?.events ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t("admin.searchEvents")}
          className="sm:max-w-xs"
        />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-40" aria-label={t("common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("common.all")}</SelectItem>
            {EVENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`admin.st.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="sm:ml-auto flex items-center gap-3">
          {list.data && (
            <PageNav page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("admin.createEvent")}
            </Button>
          )}
        </div>
      </div>

      {list.isError ? (
        <ErrorNote message={errMsg(list.error)} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("admin.noResults")}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((e) => (
            <EventRow key={e.id} event={e} canEdit={canEdit} />
          ))}
        </div>
      )}

      {/* create event dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.createEvent")}</DialogTitle>
            <DialogDescription>{t("admin.withStandardMarkets")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-sport">{t("admin.sport")}</Label>
              <Select value={form.sportKey} onValueChange={(v) => setForm((f) => ({ ...f, sportKey: v }))}>
                <SelectTrigger id="ev-sport" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="football">Football</SelectItem>
                  <SelectItem value="basketball">Basketball</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-league">{t("admin.league")}</Label>
              <Input
                id="ev-league"
                value={form.leagueName}
                onChange={(e) => setForm((f) => ({ ...f, leagueName: e.target.value }))}
                maxLength={80}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ev-home">{t("admin.homeTeam")}</Label>
                <Input
                  id="ev-home"
                  value={form.homeTeamName}
                  onChange={(e) => setForm((f) => ({ ...f, homeTeamName: e.target.value }))}
                  maxLength={60}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ev-away">{t("admin.awayTeam")}</Label>
                <Input
                  id="ev-away"
                  value={form.awayTeamName}
                  onChange={(e) => setForm((f) => ({ ...f, awayTeamName: e.target.value }))}
                  maxLength={60}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-start">{t("admin.startTime")}</Label>
              <Input
                id="ev-start"
                type="datetime-local"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.featured}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, featured: v === true }))}
                />
                {t("admin.featured")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.withStandardMarkets}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, withStandardMarkets: v === true }))}
                />
                {t("admin.markets")}
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!createValid || creating} onClick={() => void createEvent()}>
              {creating ? <InlineSpinner /> : null}
              {t("admin.createEvent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
