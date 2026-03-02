/// <reference types="vite/client" />
import { io, Socket } from "socket.io-client";
import type { SocketCommand } from "@hq/shared";
import { getStoredToken } from "./store/authStore";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

// Keep only the sessionId from JoinParams — campaignId/role/playerId are now
// derived from the verified JWT on the server, so clients no longer supply them.
// The full shape is retained here for backward compatibility with existing callers
// (the server simply ignores the now-redundant fields).
type JoinParams = {
  campaignId?: string;
  sessionId?: string;
  role?: "gm" | "player";
  playerId?: string;
};

let socket: Socket | null = null;
let lastJoinParams: JoinParams | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      // Use a callback so every connection attempt (including reconnects)
      // reads the latest token from storage rather than capturing a stale value.
      auth: (cb) => cb({ token: getStoredToken() ?? "" }),
      autoConnect: false,
    });

    // Re-join rooms automatically after a reconnect so socket room membership
    // is restored without requiring a page reload.
    socket.on("reconnect", () => {
      if (lastJoinParams) {
        socket!.emit("join", { sessionId: lastJoinParams.sessionId });
        socket!.emit("command", { type: "REQUEST_SNAPSHOT", sessionId: lastJoinParams.sessionId });
      }
    });
  }
  return socket;
}

export function joinSession(params: JoinParams): Promise<void> {
  lastJoinParams = params;
  return new Promise((resolve, reject) => {
    const s = getSocket();
    s.connect();
    // Only pass sessionId to the server — identity comes from the JWT
    s.emit("join", { sessionId: params.sessionId });
    s.once("joined", () => {
      s.emit("command", { type: "REQUEST_SNAPSHOT", sessionId: params.sessionId });
      resolve();
    });
    s.once("connect_error", (err) => reject(err));
  });
}

export function sendCommand(cmd: SocketCommand) {
  getSocket().emit("command", cmd);
}

export function onStateUpdate(handler: (update: any) => void) {
  const s = getSocket();
  s.on("state_update", handler);
  return () => { s.off("state_update", handler); };
}

export function onError(handler: (err: { message: string }) => void) {
  const s = getSocket();
  s.on("error", handler);
  return () => { s.off("error", handler); };
}

export function onDiceRoll(handler: (roll: { rollType: string; diceCount: number; results: string[]; rollerName: string }) => void) {
  const s = getSocket();
  s.on("dice_roll", handler);
  return () => { s.off("dice_roll", handler); };
}
