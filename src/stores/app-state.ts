"use client";

import { create } from "zustand";

/** SPA navigation state (single-route app; views switch inside "/"). */
export type View =
  | "home"
  | "sports"
  | "live"
  | "bets"
  | "wallet"
  | "profile"
  | "admin"
  | "auth"
  | "event";

interface AppState {
  view: View;
  eventId: string | null;
  authMode: "login" | "register";
  navigate: (view: View, eventId?: string) => void;
  openAuth: (mode?: "login" | "register") => void;
}

export const useAppState = create<AppState>()((set) => ({
  view: "home",
  eventId: null,
  authMode: "login",
  navigate: (view, eventId) => {
    set({ view, eventId: eventId ?? null });
    window.scrollTo({ top: 0 });
  },
  openAuth: (mode = "login") => {
    set({ view: "auth", authMode: mode });
    window.scrollTo({ top: 0 });
  },
}));
