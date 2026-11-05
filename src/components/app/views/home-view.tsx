"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, ShieldCheck, Users, ArrowRight, Trophy } from "lucide-react";
import { OddsButton } from "@/components/app/odds-button";
import { useI18n } from "@/lib/i18n";
import { useEvents } from "@/hooks/use-data";
import { useAppState } from "@/stores/app-state";
import { formatTime, startsInLabel, selectionLabel, marketKeyLabel } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/en";
import type { EventDTO, MarketDTO, SelectionDTO } from "@/lib/serialize";

type TFn = (k: DictKey, v?: Record<string, string | number>) => string;

/** First open 1X2 / MONEY_LINE market of an event (the "main" market). */
export function pickMainMarket(event: EventDTO): MarketDTO | null {
  const main = event.markets.filter((m) => m.key === "1X2" || m.key === "MONEY_LINE");
  return main.find((m) => m.status === "OPEN" && m.selections.length > 0) ?? main[0] ?? null;
}

/** Build a bet-slip leg from a selection. */
export function legFor(event: EventDTO, m: MarketDTO, s: SelectionDTO) {
  return {
    selectionId: s.id,
    eventId: event.id,
    eventName: `${event.homeTeam.name} vs ${event.awayTeam.name}`,
    marketName: m.name,
    marketKey: m.key,
    marketId: m.id,
    selectionName: s.name,
    odds: s.odds,
    eventStatus: event.status,
  };
}

/** Translate a selection name ("1"/"X"/"2"/"OVER"…) using the market key. */
export function translatedSelection(key: string, name: string, t: TFn): string {
  switch (selectionLabel(key, name)) {
    case "odds.home":
      return t("odds.home");
    case "odds.draw":
      return t("odds.draw");
    case "odds.away":
      return t("odds.away");
    case "odds.over":
      return t("odds.over");
    case "odds.under":
      return t("odds.under");
    case "odds.yes":
      return t("odds.yes");
    case "odds.no":
      return t("odds.no");
    default:
      return name;
  }
}

/** Translate a market key ("1X2" → "Match Winner"); falls back to the raw name. */
export function translatedMarket(key: string, name: string, t: TFn): string {
  const k = marketKeyLabel(key);
  return k.includes(".") ? t(k as DictKey) : name;
}

/** Live status chip text: 34' / HT / FT. */
export function minuteLabel(event: EventDTO): string {
  if (event.status === "FINISHED") return "FT";
  if (event.status === "LIVE") return event.minute != null ? `${event.minute}'` : "HT";
  return "";
}

/**
 * Full-width event row with the main-market odds buttons.
 * Local shared component for the Home / Sports / Live views.
 */
export function EventCardRow({ event }: { event: EventDTO }) {
  const { t } = useI18n();
  const navigate = useAppState((s) => s.navigate);
  const market = pickMainMarket(event);
  const isLive = event.status === "LIVE";
  const isFinished = event.status === "FINISHED";
  const hasScore = event.homeScore != null && event.awayScore != null;
  const moreCount = Math.max(0, event.markets.length - 1);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate("event", event.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") navigate("event", event.id);
      }}
      className="w-full cursor-pointer gap-3 rounded-xl px-4 py-3 transition-colors hover:border-primary/50"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isLive && (
          <span className="flex shrink-0 items-center gap-1 font-semibold text-destructive">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
            {minuteLabel(event)}
          </span>
        )}
        <span className="truncate">{event.leagueName}</span>
        <span className="ml-auto shrink-0">
          {isLive
            ? ""
            : isFinished
              ? t("live.finished")
              : `⏱ ${formatTime(event.startTime)}${startsInLabel(event.startTime) ? ` · ${startsInLabel(event.startTime)}` : ""}`}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{event.homeTeam.name}</span>
        {hasScore ? (
          <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-base font-bold tabular-nums">
            {event.homeScore}–{event.awayScore}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">vs</span>
        )}
        <span className="min-w-0 flex-1 truncate text-right text-sm font-semibold">{event.awayTeam.name}</span>
      </div>

      {market ? (
        <div className="flex items-stretch gap-2">
          {market.selections.slice(0, 3).map((s) => (
            <OddsButton
              key={s.id}
              leg={legFor(event, market, s)}
              label={translatedSelection(market.key, s.name, t)}
              suspended={market.status !== "OPEN" || s.status === "SUSPENDED"}
              className="min-w-0 flex-1"
            />
          ))}
          <button
            type="button"
            aria-label={t("sports.moreMarkets", { count: moreCount })}
            onClick={(e) => {
              e.stopPropagation();
              navigate("event", event.id);
            }}
            className="flex min-h-[44px] w-11 shrink-0 flex-col items-center justify-center rounded-md border border-dashed text-xs font-bold text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            +{moreCount}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("event.noMarkets")}</p>
      )}
    </Card>
  );
}

/** Compact live card used in the horizontal "Live now" strip. */
function LiveStripCard({ event, t }: { event: EventDTO; t: TFn }) {
  const navigate = useAppState((s) => s.navigate);
  const market = pickMainMarket(event);
  const hasScore = event.homeScore != null && event.awayScore != null;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate("event", event.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") navigate("event", event.id);
      }}
      className="w-[240px] shrink-0 cursor-pointer gap-2 rounded-xl px-3 py-3 transition-colors hover:border-primary/50"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
        {minuteLabel(event)}
        <span className="ml-auto truncate font-normal text-muted-foreground">{event.leagueName}</span>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{event.homeTeam.name}</span>
          <span className="font-bold tabular-nums">{hasScore ? event.homeScore : "–"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{event.awayTeam.name}</span>
          <span className="font-bold tabular-nums">{hasScore ? event.awayScore : "–"}</span>
        </div>
      </div>
      {market && (
        <div className="flex gap-1.5">
          {market.selections.slice(0, 3).map((s) => (
            <OddsButton
              key={s.id}
              leg={legFor(event, market, s)}
              label={translatedSelection(market.key, s.name, t)}
              suspended={market.status !== "OPEN" || s.status === "SUSPENDED"}
              className="min-w-0 flex-1"
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function LiveStrip({ events }: { events: EventDTO[] }) {
  const { t } = useI18n();
  return (
    <section aria-label={t("home.liveNow")}>
      <div className="mb-2 flex items-center gap-2">
        <span className="live-dot inline-block h-2 w-2 rounded-full bg-destructive" aria-hidden />
        <h2 className="text-sm font-bold uppercase tracking-wide">{t("home.liveNow")}</h2>
        <Badge variant="destructive" className="ml-auto">
          {events.length}
        </Badge>
      </div>
      <div className="scrollbar-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {events.map((e) => (
          <LiveStripCard key={e.id} event={e} t={t} />
        ))}
      </div>
    </section>
  );
}

function SectionHeader({ title, onViewAll }: { title: string; onViewAll?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
      {onViewAll && (
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onViewAll}>
          {t("common.viewAll")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}

function EventListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Home: hero, promos, live strip, featured + upcoming matches. */
export function HomeView() {
  const { t } = useI18n();
  const navigate = useAppState((s) => s.navigate);

  const live = useEvents({ status: "LIVE", pageSize: 8 });
  const featured = useEvents({ featured: "1", status: "SCHEDULED", pageSize: 6 });
  const upcoming = useEvents({ status: "SCHEDULED", pageSize: 8 });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary to-primary/70 p-6 text-primary-foreground shadow-md sm:p-8">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/25 blur-2xl"
          aria-hidden
        />
        <Badge className="border-gold/60 bg-gold/20 text-gold-foreground">18+</Badge>
        <h1 className="mt-3 max-w-md text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
          {t("home.heroTitle")}
        </h1>
        <p className="mt-2 max-w-md text-sm opacity-90">{t("home.heroSubtitle")}</p>
        <Button
          size="lg"
          className="mt-5 h-11 gap-2 bg-gold px-6 font-bold text-gold-foreground hover:bg-gold/90"
          onClick={() => navigate("sports")}
        >
          <Trophy className="h-4.5 w-4.5" aria-hidden />
          {t("home.placeBet")}
        </Button>
      </section>

      {/* Promos */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="Promotions">
        <Card className="gap-3 rounded-xl border-gold/40 bg-gold/10 p-4">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-gold-foreground" aria-hidden />
            <h3 className="font-bold">{t("home.promoWelcome")}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{t("home.promoWelcomeDesc")}</p>
        </Card>
        <Card className="gap-3 rounded-xl border-gold/40 bg-gold/10 p-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gold-foreground" aria-hidden />
            <h3 className="font-bold">{t("home.promoReferral")}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{t("home.promoReferralDesc")}</p>
        </Card>
      </section>

      {/* Live now strip */}
      {live.isLoading ? (
        <EventListSkeleton rows={1} />
      ) : (live.data?.events.length ?? 0) > 0 ? (
        <LiveStrip events={live.data!.events} />
      ) : null}

      {/* Featured */}
      <section aria-label={t("home.featured")}>
        <SectionHeader title={t("home.featured")} />
        {featured.isLoading ? (
          <EventListSkeleton rows={3} />
        ) : (featured.data?.events.length ?? 0) === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" aria-hidden /> {t("sports.noEvents")}
          </p>
        ) : (
          <div className="space-y-3">
            {featured.data!.events.map((e) => (
              <EventCardRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming */}
      <section aria-label={t("home.upcoming")}>
        <SectionHeader title={t("home.upcoming")} onViewAll={() => navigate("sports")} />
        {upcoming.isLoading ? (
          <EventListSkeleton rows={4} />
        ) : (upcoming.data?.events.length ?? 0) === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{t("sports.noEvents")}</p>
        ) : (
          <div className="space-y-3">
            {upcoming.data!.events.map((e) => (
              <EventCardRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
