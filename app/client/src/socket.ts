/// <reference types="vite/client" />
import type { SocketCommand, CombatDieFace } from "@hq/shared";
import { getStoredToken } from "./store/authStore";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? window.location.origin;
const WS_URL = SERVER_URL.replace(/^http/, "ws");

type JoinParams = {
  campaignId?: string;
  sessionId?: string;
  role?: "gm" | "player";
  playerId?: string;
};

type DiceRoll = {
  rollType: "attack" | "defense";
  diceCount: number;
  results: CombatDieFace[];
  rollerName: string;
};

let socket: WebSocket | null = null;
let lastJoinParams: JoinParams | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentSessionId: string | undefined;
let intentionalClose = false;

const stateUpdateHandlers = new Set<(update: any) => void>();
const errorHandlers = new Set<(err: { message: string }) => void>();
const diceRollHandlers = new Set<(roll: DiceRoll) => void>();

function emitStateUpdate(update: any) {
  for (const handler of stateUpdateHandlers) handler(update);
}

function emitError(message: string) {
  for (const handler of errorHandlers) handler({ message });
}

function emitDiceRoll(roll: DiceRoll) {
  for (const handler of diceRollHandlers) handler(roll);
}

async function requestSnapshot(sessionId?: string) {
  const token = getStoredToken();
  if (!token) return;
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const res = await fetch(`${SERVER_URL}/api/realtime/snapshot${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    emitError(data.error ?? "Failed to load snapshot");
    return;
  }
  emitStateUpdate({ type: "SYNC_SNAPSHOT", snapshot: data.snapshot });
}

async function connectSocket() {
  const token = getStoredToken();
  if (!token) throw new Error("Unauthorized: token required");
  const sessionId = currentSessionId ?? "";
  const campaignId = lastJoinParams?.campaignId ?? "";

  // Exchange the bearer token for a short-lived opaque ticket so the JWT never
  // appears in the WebSocket URL (which Cloudflare logs in plain text).
  const ticketRes = await fetch(`${SERVER_URL}/api/realtime/ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!ticketRes.ok) {
    throw new Error("Failed to obtain realtime ticket");
  }
  const { ticket } = await ticketRes.json() as { ticket: string };

  const ws = new WebSocket(
    `${WS_URL}/api/realtime?ticket=${encodeURIComponent(ticket)}&campaignId=${encodeURIComponent(campaignId)}&sessionId=${encodeURIComponent(sessionId)}`
  );
  socket = ws;

  const opened = new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      ws.removeEventListener("open", onOpen);
      reject(new Error("Realtime connection failed"));
    };
    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onError, { once: true });
  });

  ws.addEventListener("open", () => {
    requestSnapshot(currentSessionId).catch((err) => emitError(err instanceof Error ? err.message : "Failed to load snapshot"));
  });

  ws.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === "joined") return;
      if (message.type === "refresh") {
        requestSnapshot(message.sessionId ?? currentSessionId).catch((err) => emitError(err instanceof Error ? err.message : "Failed to refresh"));
        return;
      }
      if (message.type === "dice_roll") {
        emitDiceRoll(message);
        return;
      }
      if (message.type === "error") {
        emitError(message.message ?? "Realtime error");
      }
    } catch {
      emitError("Malformed realtime payload");
    }
  });

  ws.addEventListener("close", () => {
    socket = null;
    if (!intentionalClose && lastJoinParams) {
      reconnectTimer = setTimeout(() => {
        joinSession(lastJoinParams).catch((err) => emitError(err instanceof Error ? err.message : "Reconnect failed"));
      }, 1000);
    }
    intentionalClose = false;
  });

  ws.addEventListener("error", () => {
    emitError("Realtime connection failed");
  });

  return opened;
}

export async function joinSession(params: JoinParams): Promise<void> {
  lastJoinParams = params;
  currentSessionId = params.sessionId;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    intentionalClose = true;
    socket.close();
  }
  await connectSocket();
}

export function sendCommand(cmd: SocketCommand) {
  if (cmd.type === "REQUEST_SNAPSHOT") {
    requestSnapshot(cmd.sessionId ?? currentSessionId).catch((err) => emitError(err instanceof Error ? err.message : "Failed to refresh"));
    return;
  }

  const token = getStoredToken();
  if (!token) {
    emitError("Unauthorized: token required");
    return;
  }

  fetch(`${SERVER_URL}/api/commands`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...cmd, sessionId: "sessionId" in cmd && cmd.sessionId ? cmd.sessionId : currentSessionId }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Command failed");
      }
    })
    .catch((err) => emitError(err instanceof Error ? err.message : "Command failed"));
}

export function onStateUpdate(handler: (update: any) => void) {
  stateUpdateHandlers.add(handler);
  return () => {
    stateUpdateHandlers.delete(handler);
  };
}

export function onError(handler: (err: { message: string }) => void) {
  errorHandlers.add(handler);
  return () => {
    errorHandlers.delete(handler);
  };
}

export function onDiceRoll(handler: (roll: DiceRoll) => void) {
  diceRollHandlers.add(handler);
  return () => {
    diceRollHandlers.delete(handler);
  };
}
