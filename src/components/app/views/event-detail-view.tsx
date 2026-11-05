"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { OddsButton } from "@/components/app/odds-button";
import { useI18n } from "@/lib/i18n";
import { useEvent } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import { formatDateTime, startsInLabel } from "@/lib/format";
import { translatedMarket, translatedSelection } from "@/components/app/views/home-view";
import { cn } from "@/lib/utils";
import type { EventDTO, MarketDTO, SelectionDTO } from "@/lib/serialize";

function Scoreboard({ event }: { event: EventDTO }) {
  const { t } = useI18n();
  const isLive = event.status === "LIVE";
  const isFinished = event.status === "FINISHED";
  const hasScore = event.homeScore != null && event.awayScore != null;

  return (
    <Card className="overflow-hidden rounded-xl py-0">
      <div className="bg-gradient-to-br from-primary to-primary/80 px-4 py-2 text-xs font-medium text-primary-foreground">
        <span className="truncate">{event.leagueName}</span>
        <span className="ml-2 opacity-80">{formatDateTime(event.startTime)}</span>
      </div>
      <div className="flex items-center gap-3 px-4 py-5 sm:px-6">
        <div className="min-w-0 flex-1 text-center sm:text-right">
          <p className="truncate text-sm font-bold sm:text-lg">{event.homeTeam.name}</p>
          <p className="text-[11px] text-muted-foreground">{t("odds.home")}</p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          {hasScore ? (
            <span className="rounded-lg bg-muted px-3 py-1 text-3xl font-extrabold tabular-nums">
              {event.homeScore}–{event.awayScore}
            </span>
          ) : (
            <span className="text-xl font-bold tabular-nums text-muted-foreground">
              {startsInLabel(event.startTime) || formatDateTime(event.startTime)}
            </span>
          )}
          {isLive && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
              {event.minute != null ? `${event.minute}'` : "HT"}
            </span>
          )}
          {isFinished && <Badge variant="secondary">{t("live.finished")}</Badge>}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="truncate text-sm font-bold sm:text-lg">{event.awayTeam.name}</p>
          <p className="text-[11px] text-muted-foreground">{t("odds.away")}</p>
        </div>
      </div>
    </Card>
  );
}

function MarketCard({ event, market }: { event: EventDTO; market: MarketDTO }) {
  const { t } = useI18n();
  const suspended = market.status === "SUSPENDED";
  const settled = market.status === "SETTLED";
  const dimmed = suspended || settled;

  return (
    <Card className={cn("gap-3 rounded-xl px-4 py-4", dimmed && "opacity-60")}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold">
          {translatedMarket(market.key, market.name, t)}
          {market.line != null && (
            <span className="ml-1 font-normal text-muted-foreground">{market.line}</span>
          )}
        </h3>
        {suspended && (
          <Badge variant="outline" className="border-gold/50 bg-gold/10 text-gold-foreground">
            {t("odds.suspended")}
          </Badge>
        )}
        {settled && market.resultName && (
          <Badge className="ml-auto bg-primary/15 text-primary">{t("event.result", { name: market.resultName })}</Badge>
        )}
      </div>
      <div className={cn("grid grid-cols-2 gap-2", market.selections.length > 2 && "sm:grid-cols-3")}>
        {market.selections.map((s: SelectionDTO) => (
          <OddsButton
            key={s.id}
            leg={{
              selectionId: s.id,
              eventId: event.id,
              eventName: `${event.homeTeam.name} vs ${event.awayTeam.name}`,
              marketName: market.name,
              marketKey: market.key,
              marketId: market.id,
              selectionName: s.name,
              odds: s.odds,
              eventStatus: event.status,
            }}
            label={translatedSelection(market.key, s.name, t)}
            suspended={suspended || settled || s.status === "SUSPENDED"}
            className="w-full"
          />
        ))}
      </div>
    </Card>
  );
}

/** Event detail: scoreboard + every market with odds buttons. */
export function EventDetailView({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const navigate = useAppState((s) => s.navigate);
  const { data, isLoading } = useEvent(eventId);
  const event = data?.event;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="ghost" className="h-11 gap-2 px-3 text-sm" onClick={() => navigate("sports")}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("event.back")}
      </Button>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : !event ? (
        <Card className="items-center gap-2 rounded-xl py-12 text-center">
          <p className="text-sm text-muted-foreground">{t("common.error")}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("sports")}>
            {t("event.back")}
          </Button>
        </Card>
      ) : (
        <>
          <Scoreboard event={event} />
          {event.markets.length === 0 ? (
            <Card className="items-center gap-2 rounded-xl py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("event.noMarkets")}</p>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {event.markets.map((m) => (
                <MarketCard key={m.id} event={event} market={m} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
