import "server-only";
import { io, Socket } from "socket.io-client";

/**
 * Socket.IO client used by the background worker to push updates to the
 * realtime hub (mini-services/realtime on port 3003), which fans them out to
 * browsers. Backend → hub uses a shared token for authenticity.
 */

const REALTIME_URL = process.env.REALTIME_URL ?? "http://localhost:3003";
const REALTIME_TOKEN = process.env.REALTIME_KEY ?? "gadaa-realtime-dev-key";

let socket: Socket | null = null;

export function getRealtimeSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (!socket) {
    socket = io(REALTIME_URL, {
      path: "/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
      query: { token: REALTIME_TOKEN, role: "worker" },
    });
    socket.on("connect", () => console.log("[worker] realtime hub connected"));
    socket.on("disconnect", (reason) => console.log("[worker] realtime hub disconnected:", reason));
    socket.on("connect_error", () => {
      // hub may not be started yet — retry silently
    });
  }
  return socket;
}

/** Broadcast an event payload to a room. Safe no-op when the hub is down. */
export function emitToRoom(room: string, event: string, data: unknown) {
  if (!process.env.REALTIME_URL) return;
  try {
    const s = getRealtimeSocket();
    if (s.connected) {
      s.emit("internal:broadcast", { room, event, data });
    }
  } catch (err) {
    console.error("[worker] emit failed:", err);
  }
}
