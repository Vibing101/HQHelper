import { create } from "zustand";
import type { Session, MonsterInstance, RoomState } from "@hq/shared";

interface SessionState {
  session: Session | null;
  setSession: (s: Session) => void;
  updateMonster: (monster: MonsterInstance) => void;
  removeMonster: (monsterId: string) => void;
  addMonster: (monster: MonsterInstance) => void;
  setRoomState: (roomId: string, state: "hidden" | "revealed" | "cleared") => void;
  applyStateUpdate: (update: any) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),

  updateMonster: (monster) =>
    set((state) => {
      if (!state.session) return state;
      return {
        session: {
          ...state.session,
          monsters: state.session.monsters.map((m) => (m.id === monster.id ? monster : m)),
        },
      };
    }),

  removeMonster: (monsterId) =>
    set((state) => {
      if (!state.session) return state;
      return {
        session: {
          ...state.session,
          monsters: state.session.monsters.filter((m) => m.id !== monsterId),
        },
      };
    }),

  addMonster: (monster) =>
    set((state) => {
      if (!state.session) return state;
      return { session: { ...state.session, monsters: [...state.session.monsters, monster] } };
    }),

  setRoomState: (roomId, state) =>
    set((s) => {
      if (!s.session) return s;
      const existing = s.session.rooms.find((r) => r.roomId === roomId);
      const rooms: RoomState[] = existing
        ? s.session.rooms.map((r) => (r.roomId === roomId ? { ...r, state } : r))
        : [...s.session.rooms, { roomId, state }];
      return { session: { ...s.session, rooms } };
    }),

  applyStateUpdate: (update) =>
    set((state) => {
      if (update.type === "SESSION_UPDATED" && update.session) {
        return { session: update.session };
      }
      return state;
    }),
}));
