"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Ticket, Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatETB, selectionLabel, marketKeyLabel } from "@/lib/format";
import { useBetSlip, slipTotals, SlipMode } from "@/stores/bet-slip";
import { useI18n } from "@/lib/i18n";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import { useQueryClient } from "@tanstack/react-query";
import type { BetDTO } from "@/lib/serialize";

/**
 * Sticky bet slip — single / accumulator / system bets with live combined
 * odds and potential-win calculation. Desktop: sticky right column.
 * Mobile: bottom sheet via a floating ticket button.
 */

function SlipBody({ onPlaced }: { onPlaced?: () => void }) {
  const { t } = useI18n();
  const { legs, mode, systemK, stakeCents, stakePerComboCents, acceptOddsChange, removeLeg, clear, setMode, setSystemK, setStake, setStakePerCombo, setAcceptOddsChange } = useBetSlip();
  const { data: session } = useSession();
  const user = session?.user ?? null;
  const navigate = useAppState((s) => s.navigate);
  const openAuth = useAppState((s) => s.openAuth);
  const queryClient = useQueryClient();
  const [placing, setPlacing] = useState(false);

  const totals = slipTotals(legs, mode, stakeCents, systemK, stakePerComboCents);
  const maxK = Math.max(2, legs.length - 1);
  const isLive = legs.some((l) => l.eventStatus === "LIVE");

  const place = async () => {
    if (!user) {
      openAuth("login");
      toast.info(t("slip.needLogin"));
      return;
    }
    setPlacing(true);
    try {
      await api.post<{ bet: BetDTO }>("/api/bets", {
        type: mode,
        stakeCents: mode === "SYSTEM" ? stakePerComboCents : stakeCents,
        selectionIds: legs.map((l) => l.selectionId),
        systemK: mode === "SYSTEM" ? systemK : undefined,
        acceptOddsChange,
      });
      clear();
      toast.success(mode === "SINGLE" && isLive ? t("slip.betPending") : t("slip.betPlaced"));
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["bets"] });
      onPlaced?.();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : t("common.error");
      toast.error(msg);
    } finally {
      setPlacing(false);
    }
  };

  if (legs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <Ticket className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-medium">{t("slip.empty")}</p>
        <p className="text-sm text-muted-foreground">{t("slip.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs value={mode} onValueChange={(v) => setMode(v as SlipMode)} className="px-3 pt-2">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="SINGLE">{t("slip.single")}</TabsTrigger>
          <TabsTrigger value="MULTIPLE" disabled={legs.length < 2}>{t("slip.multi")}</TabsTrigger>
          <TabsTrigger value="SYSTEM" disabled={legs.length < 3}>{t("slip.system")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <ScrollArea className="flex-1 min-h-0 max-h-[38vh] px-3 py-2 scrollbar-thin">
        <div className="space-y-2">
          {legs.map((leg) => (
            <div key={leg.selectionId} className="rounded-md border bg-card p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground">{leg.eventName}</p>
                  <p className="truncate text-sm font-medium">
                    {selectionLabel(leg.marketKey, leg.selectionName) === leg.selectionName
                      ? leg.selectionName
                      : t(selectionLabel(leg.marketKey, leg.selectionName) as never)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {marketKeyLabel(leg.marketKey).startsWith("markets.")
                      ? t(marketKeyLabel(leg.marketKey) as never)
                      : marketKeyLabel(leg.marketKey)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold tabular-nums">{leg.odds.toFixed(2)}</span>
                  <button
                    aria-label="Remove selection"
                    onClick={() => removeLeg(leg.selectionId)}
                    className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Separator />
      <div className="space-y-2.5 p-3">
        {mode === "SYSTEM" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{systemK}/{legs.length}</span>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: maxK - 1 }, (_, i) => i + 2).map((k) => (
                <button
                  key={k}
                  onClick={() => setSystemK(k)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium",
                    systemK === k ? "border-primary bg-primary text-primary-foreground" : "bg-card"
                  )}
                >
                  {k}/{legs.length}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{t("slip.totalOdds")}</span><span className="font-bold tabular-nums">{totals.totalOdds.toFixed(2)}</span></div>
          {mode === "SYSTEM" && (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("slip.combos")}</span><span className="font-bold tabular-nums">{totals.comboCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("slip.totalStake")}</span><span className="font-bold tabular-nums">{formatETB(totals.totalStake)}</span></div>
            </>
          )}
          <div className="flex justify-between"><span className="text-muted-foreground">{t("slip.potentialWin")}</span><span className="font-bold text-gold tabular-nums">{formatETB(totals.potentialWin)}</span></div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {mode === "SYSTEM" ? t("slip.stakePerCombo") : t("slip.stake")}
          </label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={5}
              step={5}
              value={mode === "SYSTEM" ? stakePerComboCents / 100 : stakeCents / 100}
              onChange={(e) => {
                const v = Math.max(0, Math.round(Number(e.target.value) * 100));
                if (mode === "SYSTEM") setStakePerCombo(v);
                else setStake(v);
              }}
              className="h-10"
            />
            {[2000, 5000, 10000].map((c) => (
              <Button
                key={c}
                variant="outline"
                size="sm"
                className="h-10 px-2.5 text-xs"
                onClick={() => (mode === "SYSTEM" ? setStakePerCombo(c) : setStake(c))}
              >
                {c / 100}
              </Button>
            ))}
          </div>
        </div>

        {(mode !== "SINGLE" || isLive) && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={acceptOddsChange} onCheckedChange={(v) => setAcceptOddsChange(v === true)} />
            {t("slip.acceptOddsChange")}
          </label>
        )}
        {isLive && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" /> {t("slip.liveBetNote")}
          </p>
        )}

        {user && (
          <p className="text-xs text-muted-foreground">
            {t("wallet.balance")}: <span className="font-semibold text-foreground">{formatETB(user.wallet?.balanceCents ?? 0)}</span>
          </p>
        )}

        <Button className="w-full h-11 text-base font-bold" disabled={placing || legs.length === 0} onClick={place}>
          {placing ? t("common.loading") : `${t("slip.placeBet")} · ${formatETB(totals.totalStake)}`}
        </Button>
      </div>
    </div>
  );
}

export function BetSlip() {
  const { t } = useI18n();
  const legs = useBetSlip((s) => s.legs);
  const open = useBetSlip((s) => s.open);
  const setOpen = useBetSlip((s) => s.setOpen);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // On desktop the docked column is used, never the bottom sheet
  useEffect(() => {
    if (isDesktop && open) setOpen(false);
  }, [isDesktop, open, setOpen]);

  return (
    <>
      {/* Desktop: docked column on the right, always visible */}
      <aside className="sticky top-20 hidden h-fit w-80 shrink-0 lg:block">
        <div className="overflow-hidden rounded-md border bg-card shadow-sm">
          <div className="flex items-center justify-between bg-primary px-3 py-2.5 text-primary-foreground">
            <div className="flex items-center gap-2 font-bold">
              <Ticket className="h-4 w-4" />
              {t("slip.title")}
            </div>
            <div className="flex items-center gap-3">
              {legs.length > 0 && (
                <button onClick={() => useBetSlip.getState().clear()} className="text-xs opacity-90 hover:opacity-100">
                  {t("slip.clear")}
                </button>
              )}
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-foreground">
                {legs.length}
              </span>
            </div>
          </div>
          <SlipBody />
        </div>
      </aside>

      {/* Phone and small tablet: floating button + bottom sheet */}
      <div className="fixed bottom-20 right-4 z-40 lg:hidden">
        <Sheet open={open && !isDesktop} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button size="lg" className="relative h-14 w-14 rounded-full shadow-lg" aria-label={t("slip.title")}>
              <Ticket className="h-6 w-6" />
              {legs.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-xs font-bold text-gold-foreground">
                  {legs.length}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="flex h-[80vh] flex-col rounded-t-2xl p-0 pb-safe">
            <SheetHeader className="border-b bg-primary px-4 py-3 text-primary-foreground">
              <SheetTitle className="flex items-center gap-2 text-base text-primary-foreground">
                <Ticket className="h-4 w-4" />
                {t("slip.title")}
                {legs.length > 0 && <Badge variant="secondary">{legs.length}</Badge>}
              </SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SlipBody onPlaced={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}