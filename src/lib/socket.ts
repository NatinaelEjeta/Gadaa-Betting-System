"use client";

import { io, Socket } from "socket.io-client";

/**
 * Singleton Socket.IO connection to the realtime hub through the gateway.
 * ALWAYS "/?XTransformPort=3003" — never a raw port URL.
 */

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (typeof window === "undefined") throw new Error("socket is client-only");
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
      path: "/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1500,
      timeout: 8000,
    });
  }
  return socket;
}

export type ScoreUpdate = {
  eventId: string;
  homeScore: number;
  awayScore: number;
  minute: number | null;
  status: string;
  lastEvent: { type: string; minute: number; team: string } | null;
  marketsSuspended: boolean;
};

export type OddsUpdate = {
  eventId: string;
  markets: Array<{
    marketId: string;
    selections: Array<{ selectionId: string; odds: number; prevOdds: number | null; status: string }>;
  }>;
};
