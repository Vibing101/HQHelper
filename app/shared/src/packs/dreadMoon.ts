import type { PackDefinition } from "../types";

export const DREAD_MOON_PACK: PackDefinition = {
  id: "DREAD_MOON",
  allowedHeroes: ["barbarian", "dwarf", "elf", "wizard", "knight"],
  enabledSystems: {
    reputationTokens: true,
    disguises: true,
    mercenaries: true,
    alchemy: true,
    mindShock: true,
  },
  constraints: { uniqueHeroesOnly: true, maxPartySize: 4 },
};
