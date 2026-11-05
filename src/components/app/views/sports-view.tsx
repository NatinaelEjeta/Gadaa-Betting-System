"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, History, Search, SearchX } from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useEvents } from "@/hooks/use-data";
import { EventCardRow } from "@/components/app/views/home-view";
import { cn } from "@/lib/utils";

interface SportWithLeagues {
  id: string;
  key: string;
  name: string;
  leagues: Array<{ id: string; name: string; country: string | null; eventsCount: number }>;
}

/** Group label for an event start day: Today / Tomorrow / "Fri 13 Jun". */
function dayGroupLabel(iso: string, t: (k: "common.today" | "common.tomorrow") => string): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day === today) return t("common.today");
  if (day === today + 86_400_000) return t("common.tomorrow");
  return d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Sports: sport tabs, search, league chips, grouped schedule + results. */
export function SportsView() {
  const { t } = useI18n();

  const { data: sports } = useQuery({
    queryKey: ["sports"],
    queryFn: () => api.get<SportWithLeagues[]>("/api/sports"),
    staleTime: 30_000,
  });

  const sportList = sports ?? [];
  const [sport, setSport] = useState<string>("");
  const [league, setLeague] = useState<string>("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);

  // debounce the search box into the query param
  useEffect(() => {
    const id = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(id);
  }, [qInput]);

  const activeSport = sport || sportList[0]?.key || "football";
  const currentSport = sportList.find((s) => s.key === activeSport);
  const leagues = currentSport?.leagues ?? [];
  // a league id from another sport is treated as "All"
  const effectiveLeague = leagues.some((l) => l.id === league) ? league : "";

  const schedule = useEvents({
    sport: activeSport,
    league: effectiveLeague || undefined,
    status: "SCHEDULED",
    q: q || undefined,
    pageSize: 30,
  });
  const results = useEvents({ status: "FINISHED", pageSize: 10 });

  const scheduleEvents = schedule.data?.events ?? [];
  const grouped = useMemo(() => {
    const groups: Array<{ label: string; events: typeof scheduleEvents }> = [];
    for (const e of scheduleEvents) {
      const label = dayGroupLabel(e.startTime, t);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.events.push(e);
      else groups.push({ label, events: [e] });
    }
    return groups;
  }, [scheduleEvents, t]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Sport tabs */}
      <Tabs value={activeSport} onValueChange={setSport}>
        <TabsList className="h-11 w-full justify-start rounded-xl bg-muted p-1">
          {sportList.length > 0 ? (
            sportList.map((s) => (
              <TabsTrigger key={s.key} value={s.key} className="h-9 flex-1 rounded-lg px-4 text-sm">
                {s.name}
              </TabsTrigger>
            ))
          ) : (
            <>
              <TabsTrigger value="football" className="h-9 flex-1 rounded-lg px-4 text-sm">
                {t("sports.football")}
              </TabsTrigger>
              <TabsTrigger value="basketball" className="h-9 flex-1 rounded-lg px-4 text-sm">
                {t("sports.basketball")}
              </TabsTrigger>
            </>
          )}
        </TabsList>
      </Tabs>

      {/* Search */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
          className="h-11 rounded-xl pl-9"
        />
      </div>

      {/* League chips */}
      <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label={t("sports.leagues")}>
        <button
          type="button"
          onClick={() => setLeague("")}
          role="option"
          aria-selected={effectiveLeague === ""}
          className={cn(
            "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
            league === ""
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:border-primary/50"
          )}
        >
          {t("common.all")}
        </button>
        {leagues.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLeague(league === l.id ? "" : l.id)}
            role="option"
            aria-selected={effectiveLeague === l.id}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
              league === l.id
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:border-primary/50"
            )}
          >
            {l.name}
            <span className="ml-1.5 opacity-70">{l.eventsCount}</span>
          </button>
        ))}
      </div>

      {/* Schedule grouped by day */}
      {schedule.isLoading ? (
        <ListSkeleton rows={5} />
      ) : grouped.length === 0 ? (
        <Card className="items-center gap-2 rounded-xl py-10 text-center">
          <SearchX className="h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("sports.noEvents")}</p>
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
              <div className="space-y-3">
                {g.events.map((e) => (
                  <EventCardRow key={e.id} event={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Results (collapsible) */}
      <Collapsible open={resultsOpen} onOpenChange={setResultsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="h-11 w-full justify-between rounded-xl px-4">
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" aria-hidden />
              {t("sports.results")}
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", resultsOpen && "rotate-180")} aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 pt-3">
            {results.isLoading ? (
              <ListSkeleton rows={3} />
            ) : (results.data?.events.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("sports.noEvents")}</p>
            ) : (
              results.data!.events.map((e) => <EventCardRow key={e.id} event={e} />)
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
