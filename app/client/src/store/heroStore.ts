import { create } from "zustand";
import type { Hero } from "@hq/shared";

interface HeroState {
  myHero: Hero | null;
  allHeroes: Hero[];
  setMyHero: (h: Hero) => void;
  setAllHeroes: (heroes: Hero[]) => void;
  updateHero: (hero: Hero) => void;
  applyStateUpdate: (update: any) => void;
}

export const useHeroStore = create<HeroState>((set) => ({
  myHero: null,
  allHeroes: [],
  setMyHero: (myHero) => set({ myHero }),
  setAllHeroes: (allHeroes) => set({ allHeroes }),
  updateHero: (hero) =>
    set((state) => ({
      myHero: state.myHero?.id === hero.id ? hero : state.myHero,
      allHeroes: state.allHeroes.map((h) => (h.id === hero.id ? hero : h)),
    })),
  applyStateUpdate: (update) =>
    set((state) => {
      if (update.type === "SYNC_SNAPSHOT" && update.snapshot) {
        const allHeroes = update.snapshot.heroes ?? [];
        const myHero = state.myHero ? allHeroes.find((h: Hero) => h.id === state.myHero!.id) ?? state.myHero : state.myHero;
        return { myHero, allHeroes };
      }
      if (update.type === "HERO_UPDATED") {
        return {
          myHero: state.myHero?.id === update.hero.id ? update.hero : state.myHero,
          allHeroes: state.allHeroes.map((h) => (h.id === update.hero.id ? update.hero : h)),
        };
      }
      return state;
    }),
}));
