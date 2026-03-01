import type { RoomState } from "@hq/shared";
import { sendCommand } from "../socket";

interface Props {
  rooms: RoomState[];
  sessionId: string;
  isGM: boolean;
  roomCount?: number;
}

const ROOM_STATES: ("hidden" | "revealed" | "cleared")[] = ["hidden", "revealed", "cleared"];
const ROOM_STATE_LABELS = { hidden: "Hidden", revealed: "Revealed", cleared: "Cleared" };
const ROOM_COLORS = {
  hidden: "bg-hq-dark border-parchment/20 text-parchment/30",
  revealed: "bg-amber-900/50 border-hq-amber text-parchment",
  cleared: "bg-hq-green/20 border-hq-green text-hq-green",
};

export default function RoomGrid({ rooms, sessionId, isGM, roomCount = 12 }: Props) {
  function cycleRoom(roomId: string) {
    if (!isGM) return;
    const current = rooms.find((r) => r.roomId === roomId)?.state ?? "hidden";
    const next = ROOM_STATES[(ROOM_STATES.indexOf(current) + 1) % ROOM_STATES.length];
    sendCommand({ type: "SET_ROOM_STATE", sessionId, roomId, state: next });
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: roomCount }, (_, i) => {
        const roomId = `room-${i + 1}`;
        const state = rooms.find((r) => r.roomId === roomId)?.state ?? "hidden";
        return (
          <button
            key={roomId}
            onClick={() => cycleRoom(roomId)}
            disabled={!isGM}
            className={`aspect-square border rounded flex flex-col items-center justify-center text-xs font-bold transition-all ${
              ROOM_COLORS[state]
            } ${isGM ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
          >
            <span className="text-lg">{state === "cleared" ? "✓" : state === "revealed" ? "🚪" : "?"}</span>
            <span className="text-xs opacity-70">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
