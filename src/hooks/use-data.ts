"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { getSocket, ScoreUpdate, OddsUpdate } from "@/lib/socket";
import { EventDTO, UserDTO, BetDTO } from "@/lib/serialize";

/** Current session (user + wallet). */
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<{ user: UserDTO | null }>("/api/auth/me"),
    staleTime: 15_000,
  });
}

export interface EventsPage {
  events: EventDTO[];
  page: number;
  total: number;
  totalPages: number;
}

/** Events list query key factory. */
export const eventsKey = (params: Record<string, string | number | undefined>) => [
  "events",
  params,
];

export function useEvents(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return useQuery({
    queryKey: eventsKey(params),
    queryFn: () => api.get<EventsPage>(`/api/events?${qs.toString()}`),
    staleTime: 5_000,
    refetchInterval: 60_000, // fallback polling; socket pushes keep it fresh
  });
}

export function useEvent(eventId: string | null) {
  return useQuery({
    queryKey: ["event", eventId],
    queryFn: () => api.get<{ event: EventDTO }>(`/api/events/${eventId}`),
    enabled: !!eventId,
    staleTime: 5_000,
  });
}

/**
 * Global live socket: score updates for the "live" room + user notification
 * toasts. Mount once in the app shell.
 */
export function useLiveSocket(opts?: { userId?: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    socket.emit("subscribe", "live");
    socket.emit("subscribe", "catalog");

    const onScore = (update: ScoreUpdate) => {
      // patch every cached events list containing this event
      const queries = queryClient.getQueryCache().findAll({ queryKey: ["events"] });
      for (const q of queries) {
        queryClient.setQueryData<EventsPage>(q.queryKey, (old) => {
          if (!old) return old;
          let changed = false;
          const events = old.events.map((e) => {
            if (e.id !== update.eventId) return e;
            changed = true;
            return {
              ...e,
              homeScore: update.homeScore,
              awayScore: update.awayScore,
              minute: update.minute,
              status: update.status as EventDTO["status"],
              markets: update.marketsSuspended
                ? e.markets.map((m) => ({ ...m, status: "SUSPENDED" as const }))
                : e.markets,
            };
          });
          return changed ? { ...old, events } : old;
        });
      }
      // single-event cache
      queryClient.setQueryData<{ event: EventDTO }>(["event", update.eventId], (old) => {
        if (!old) return old;
        return {
          event: {
            ...old.event,
            homeScore: update.homeScore,
            awayScore: update.awayScore,
            minute: update.minute,
            status: update.status as EventDTO["status"],
            markets: update.marketsSuspended
              ? old.event.markets.map((m) => ({ ...m, status: "SUSPENDED" as const }))
              : old.event.markets,
          },
        };
      });
      if (update.status === "FINISHED") {
        void queryClient.invalidateQueries({ queryKey: ["events"] });
      }
    };

    const onOdds = (update: OddsUpdate) => {
      const applyOdds = (event: EventDTO): EventDTO => {
        if (event.id !== update.eventId) return event;
        return {
          ...event,
          markets: event.markets.map((m) => {
            const updateMarket = update.markets.find((um) => um.marketId === m.id);
            if (!updateMarket) return m;
            return {
              ...m,
              selections: m.selections.map((s) => {
                const sel = updateMarket.selections.find((us) => us.selectionId === s.id);
                if (!sel) return s;
                return {
                  ...s,
                  prevOdds: sel.prevOdds ?? s.odds,
                  odds: sel.odds,
                  status: sel.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
                };
              }),
            };
          }),
        };
      };
      const queries = queryClient.getQueryCache().findAll({ queryKey: ["events"] });
      for (const q of queries) {
        queryClient.setQueryData<EventsPage>(q.queryKey, (old) =>
          old?.events.some((e) => e.id === update.eventId) ? { ...old, events: old.events.map(applyOdds) } : old
        );
      }
      queryClient.setQueryData<{ event: EventDTO }>(["event", update.eventId], (old) =>
        old ? { event: applyOdds(old.event) } : old
      );
    };

    const onNotify = (payload: { kind: string; message: string }) => {
      toast(payload.message, {
        description: undefined,
        ...(payload.kind === "bet_won"
          ? { action: undefined }
          : {}),
      });
      // refresh bets + wallet after settlement events
      if (payload.kind.startsWith("bet_")) {
        void queryClient.invalidateQueries({ queryKey: ["bets"] });
        void queryClient.invalidateQueries({ queryKey: ["session"] });
      }
    };

    const onCatalog = () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      void queryClient.invalidateQueries({ queryKey: ["sports"] });
    };

    const onMarketsReopened = (payload: { eventId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["event", payload.eventId] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    };

    socket.on("score_update", onScore);
    socket.on("odds_update", onOdds);
    socket.on("notify", onNotify);
    socket.on("catalog_update", onCatalog);
    socket.on("markets_reopened", onMarketsReopened);
    socket.on("event_status", (payload: { eventId: string; status: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    });

    return () => {
      socket.off("score_update", onScore);
      socket.off("odds_update", onOdds);
      socket.off("notify", onNotify);
      socket.off("catalog_update", onCatalog);
      socket.off("markets_reopened", onMarketsReopened);
    };
  }, [queryClient]);

  // subscribe to personal notification room
  useEffect(() => {
    if (!opts?.userId) return;
    const socket = getSocket();
    socket.emit("subscribe", `user:${opts.userId}`);
    return () => {
      socket.emit("unsubscribe", `user:${opts.userId}`);
    };
  }, [opts?.userId]);
}

/** My bets list. */
export function useBets(filter: "OPEN" | "SETTLED" | "ALL") {
  return useQuery({
    queryKey: ["bets", filter],
    queryFn: () => api.get<{ bets: BetDTO[]; total: number; page: number; totalPages: number }>(`/api/bets?filter=${filter}`),
    refetchInterval: 30_000,
  });
}
