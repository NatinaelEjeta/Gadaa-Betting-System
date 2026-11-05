"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Loader2, Receipt, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useSession, useBets } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import { formatETB, formatOdds, timeAgo } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/en";
import type { BetDTO, BetLegDTO } from "@/lib/serialize";
import { cn } from "@/lib/utils";

/** Gold badge for CASHED_OUT / VOID / PENDING_ACCEPTANCE states. */
function statusBadge(bet: BetDTO, t: (k: DictKey) => string) {
  switch (bet.status) {
    case "WON":
      return <Badge>{t("bets.won")}</Badge>;
    case "LOST":
      return <Badge variant="destructive">{t("bets.lost")}</Badge>;
    case "OPEN":
      return <Badge variant="outline">{t("bets.open")}</Badge>;
    case "PENDING_ACCEPTANCE":
      return (
        <Badge className="border-gold/50 bg-gold/15 text-gold-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {t("bets.pendingAcceptance")}
        </Badge>
      );
    case "CASHED_OUT":
      return <Badge className="border-gold/50 bg-gold/15 text-gold-foreground">{t("bets.cashedOut")}</Badge>;
    case "VOID":
      return <Badge className="border-gold/50 bg-gold/15 text-gold-foreground">{t("bets.void")}</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">{t("bets.rejected")}</Badge>;
  }
}

function legIcon(status: BetLegDTO["status"]) {
  if (status === "WON") return <Check className="h-3.5 w-3.5 text-primary" aria-label="won" />;
  if (status === "LOST") return <X className="h-3.5 w-3.5 text-destructive" aria-label="lost" />;
  return <span className="w-3.5 text-center text-xs text-muted-foreground" aria-label="pending">–</span>;
}

function LegRow({ leg }: { leg: BetLegDTO }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className="mt-0.5">{legIcon(leg.status)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{leg.selectionName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {leg.eventName} · {leg.marketName}
        </p>
        {(leg.eventStatus || leg.eventScore) && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {leg.eventStatus === "LIVE" ? <span className="font-semibold text-destructive">● LIVE</span> : leg.eventStatus}
            {leg.eventScore ? ` ${leg.eventScore}` : ""}
          </p>
        )}
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums">{formatOdds(leg.odds)}</span>
      <span className="sr-only">{t("common.status")}</span>
    </div>
  );
}

function BetCard({ bet }: { bet: BetDTO }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [offerCents, setOfferCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const isSystem = bet.type === "SYSTEM";
  const typeLabel =
    bet.type === "SINGLE" ? t("slip.single") : bet.type === "MULTIPLE" ? t("slip.multi") : t("slip.system");

  const cashoutAvailable = bet.status === "OPEN" && bet.cashoutOfferCents != null;

  const checkOffer = async () => {
    setChecking(true);
    try {
      const res = await queryClient.fetchQuery({
        queryKey: ["cashout", bet.id],
        queryFn: () => api.get<{ offerCents: number | null }>(`/api/bets/${bet.id}/cashout`),
        staleTime: 0,
      });
      if (res.offerCents == null) {
        toast.error(t("bets.cashoutUnavailable"));
        return;
      }
      setOfferCents(res.offerCents);
      setConfirming(true);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
    } finally {
      setChecking(false);
    }
  };

  const doCashout = async () => {
    setBusy(true);
    try {
      await api.post(`/api/bets/${bet.id}/cashout`);
      toast.success(t("bets.cashoutSuccess"));
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["bets"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const payoutCents =
    bet.status === "WON" ? bet.potentialWinCents : bet.status === "CASHED_OUT" ? bet.cashoutOfferCents : null;

  return (
    <Card className="gap-3 rounded-xl px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(bet, t)}
        <span className="text-xs text-muted-foreground">
          {typeLabel}
          {isSystem && bet.systemK != null && (
            <span className="ml-1 font-semibold text-foreground">
              {bet.systemK}/{bet.legs.length}
            </span>
          )}
          {isSystem && bet.comboCount > 1 && (
            <span className="ml-1">· {t("bets.combosCount", { count: bet.comboCount })}</span>
          )}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{timeAgo(bet.createdAt)}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/60 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("bets.stake")}</p>
          <p className="text-sm font-bold tabular-nums">{formatETB(bet.stakeCents)}</p>
        </div>
        <div className="rounded-lg bg-muted/60 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("bets.totalOdds")}</p>
          <p className="text-sm font-bold tabular-nums">{formatOdds(bet.totalOdds)}</p>
        </div>
        <div className="rounded-lg bg-muted/60 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {payoutCents != null ? t("bets.payout") : t("bets.potentialWin")}
          </p>
          <p className={cn("text-sm font-bold tabular-nums", bet.status === "WON" && "text-primary")}>
            {formatETB(payoutCents ?? bet.potentialWinCents)}
          </p>
        </div>
      </div>

      <Separator />
      <div className="divide-y">
        {bet.legs.map((leg) => (
          <LegRow key={leg.id} leg={leg} />
        ))}
      </div>

      {cashoutAvailable && (
        <Button variant="outline" className="h-11 w-full rounded-xl border-gold/60 text-gold-foreground hover:bg-gold/10" disabled={checking} onClick={checkOffer}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("bets.cashout")} · {formatETB(bet.cashoutOfferCents ?? 0)}
        </Button>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-xs rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("bets.cashoutOffer")}</DialogTitle>
            <DialogDescription className="text-2xl font-extrabold tabular-nums text-foreground">
              {formatETB(offerCents ?? 0)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={() => setConfirming(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button className="h-11 flex-1" onClick={doCashout} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("bets.cashout")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function BetsList({ filter }: { filter: "OPEN" | "SETTLED" }) {
  const { t } = useI18n();
  const { data, isLoading } = useBets(filter);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if ((data?.bets.length ?? 0) === 0) {
    return (
      <Card className="items-center gap-3 rounded-xl py-12 text-center">
        <Ticket className="h-10 w-10 text-muted-foreground/40" aria-hidden />
        <p className="text-sm text-muted-foreground">{t("bets.noBets")}</p>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {data!.bets.map((b) => (
        <BetCard key={b.id} bet={b} />
      ))}
    </div>
  );
}

/** My bets: open/settled tabs, leg lists, cashout flow. */
export function MyBetsView() {
  const { t } = useI18n();
  const openAuth = useAppState((s) => s.openAuth);
  const { data: session, isLoading } = useSession();
  const user = session?.user ?? null;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-11 w-56 rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md pt-6">
        <Card className="items-center gap-3 rounded-xl py-10 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("bets.loginPrompt")}</p>
          <Button className="mt-2 h-11 rounded-xl px-6" onClick={() => openAuth("login")}>
            {t("common.login")}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-extrabold tracking-tight">{t("nav.myBets")}</h1>
      <Tabs defaultValue="open">
        <TabsList className="h-11 w-full rounded-xl bg-muted p-1">
          <TabsTrigger value="open" className="h-9 flex-1 rounded-lg text-sm">
            {t("bets.open")}
          </TabsTrigger>
          <TabsTrigger value="settled" className="h-9 flex-1 rounded-lg text-sm">
            {t("bets.settled")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="mt-4">
          <BetsList filter="OPEN" />
        </TabsContent>
        <TabsContent value="settled" className="mt-4">
          <BetsList filter="SETTLED" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
