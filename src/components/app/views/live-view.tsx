"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio, RadioTower } from "lucide-react";
import { OddsButton } from "@/components/app/odds-button";
import { useI18n } from "@/lib/i18n";
import { useEvents } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import { getSocket, ScoreUpdate } from "@/lib/socket";
import { pickMainMarket, legFor, translatedSelection, minuteLabel } from "@/components/app/views/home-view";
import { cn } from "@/lib/utils";

const GOAL_FLASH_MS = 45_000;

/** Live: realtime rows with minute, score, goal flashes and 1X2 odds. */
export function LiveView() {
  const { t } = useI18n();
  const navigate = useAppState((s) => s.navigate);
  const { data, isLoading } = useEvents({ status: "LIVE", pageSize: 30 });
  const events = data?.events ?? [];

  // ⚽ flash map: eventId → timestamp of the last GOAL seen on the socket.
  // (Score/odds themselves are already patched into the react-query cache by
  // the shell-level useLiveSocket; this only tracks the "recent goal" marker.)
  const [goalAt, setGoalAt] = useState<Record<string, number>>({});

  useEffect(() => {
    const socket = getSocket();
    const onScore = (u: ScoreUpdate) => {
      if (u.lastEvent?.type === "GOAL") {
        const id = u.eventId;
        setGoalAt((prev) => ({ ...prev, [id]: Date.now() }));
        setTimeout(() => {
          setGoalAt((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, GOAL_FLASH_MS);
      }
    };
    socket.on("score_update", onScore);
    return () => {
      socket.off("score_update", onScore);
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-destructive" aria-hidden />
        <h1 className="text-lg font-extrabold tracking-tight">{t("live.title")}</h1>
        {data && (
          <Badge variant="destructive" className="ml-1" aria-label={String(data.total)}>
            {data.total}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <Card className="items-center gap-3 rounded-xl py-12 text-center">
          <RadioTower className="h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("live.noLive")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {events.map((e) => {
            const market = pickMainMarket(e);
            const hasScore = e.homeScore != null && e.awayScore != null;
            const marketSuspended = !market || market.status !== "OPEN";
            const showGoal = !!goalAt[e.id];

            return (
              <Card
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate("event", e.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") navigate("event", e.id);
                }}
                className={cn(
                  "w-full cursor-pointer gap-3 rounded-xl px-4 py-3 transition-colors hover:border-primary/50",
                  marketSuspended && "opacity-80"
                )}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex shrink-0 items-center gap-1 font-semibold text-destructive">
                    <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
                    {minuteLabel(e)}
                  </span>
                  <span className="truncate text-muted-foreground">{e.leagueName}</span>
                  {showGoal && (
                    <span className="ml-auto shrink-0" role="img" aria-label="Goal">
                      ⚽
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.homeTeam.name}</span>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-base font-bold tabular-nums">
                    {hasScore ? `${e.homeScore}–${e.awayScore}` : "–"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-semibold">{e.awayTeam.name}</span>
                </div>

                <div className="flex items-stretch gap-2">
                  {market ? (
                    market.selections.slice(0, 3).map((s) => (
                      <OddsButton
                        key={s.id}
                        leg={legFor(e, market, s)}
                        label={translatedSelection(market.key, s.name, t)}
                        suspended={marketSuspended || s.status === "SUSPENDED"}
                        className="min-w-0 flex-1"
                      />
                    ))
                  ) : (
                    <span className="w-full rounded-md border border-dashed py-2.5 text-center text-xs text-muted-foreground">
                      {t("odds.suspended")}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <Radio className="h-3 w-3" aria-hidden />
        {t("slip.liveBetNote")}
      </p>
    </div>
  );
}
