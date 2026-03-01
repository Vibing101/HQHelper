// ─── Pack & System IDs ──────────────────────────────────────────────────────

export type PackId = "BASE" | "DREAD_MOON";

export type EnabledSystem =
  | "reputationTokens"
  | "disguises"
  | "mercenaries"
  | "alchemy"
  | "mindShock";

export type HeroTypeId = "barbarian" | "dwarf" | "elf" | "wizard" | "knight";

// ─── Pack Definition ─────────────────────────────────────────────────────────

export type PackDefinition = {
  id: PackId;
  allowedHeroes: HeroTypeId[];
  enabledSystems: Record<EnabledSystem, boolean>;
  constraints?: Partial<{
    uniqueHeroesOnly: boolean;
    maxPartySize: number;
  }>;
};

export const PACKS: Record<PackId, PackDefinition> = {
  BASE: {
    id: "BASE",
    allowedHeroes: ["barbarian", "dwarf", "elf", "wizard"],
    enabledSystems: {
      reputationTokens: false,
      disguises: false,
      mercenaries: false,
      alchemy: false,
      mindShock: false,
    },
    constraints: { uniqueHeroesOnly: true, maxPartySize: 4 },
  },
  DREAD_MOON: {
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
  },
};

// ─── Quest ───────────────────────────────────────────────────────────────────

export type QuestFlags = Partial<{
  enabledSystems: Partial<Record<EnabledSystem, boolean>>;
  allowedHeroIds: string[];
  disallowedHeroIds: string[];
  notes: string;
}>;

export type Quest = {
  id: string;
  packId: PackId;
  number: number;
  title: string;
  flags?: QuestFlags;
};

// ─── Effective Rules ──────────────────────────────────────────────────────────

export type EffectiveRules = {
  packId: PackId;
  allowedHeroes: HeroTypeId[];
  enabledSystems: Record<EnabledSystem, boolean>;
  constraints: Required<NonNullable<PackDefinition["constraints"]>>;
};

export function resolveEffectiveRules(packId: PackId, quest?: Quest): EffectiveRules {
  const pack = PACKS[packId];

  let allowedHeroes = [...pack.allowedHeroes];
  let enabledSystems = { ...pack.enabledSystems };
  const constraints = {
    uniqueHeroesOnly: pack.constraints?.uniqueHeroesOnly ?? true,
    maxPartySize: pack.constraints?.maxPartySize ?? 4,
  };

  if (quest?.flags?.enabledSystems) {
    enabledSystems = { ...enabledSystems, ...quest.flags.enabledSystems };
  }

  if (quest?.flags?.allowedHeroIds?.length) {
    allowedHeroes = [...quest.flags.allowedHeroIds] as HeroTypeId[];
  }

  if (quest?.flags?.disallowedHeroIds?.length) {
    const disallowed = new Set(quest.flags.disallowedHeroIds as HeroTypeId[]);
    allowedHeroes = allowedHeroes.filter((h) => !disallowed.has(h));
  }

  allowedHeroes = Array.from(new Set(allowedHeroes));

  return { packId, allowedHeroes, enabledSystems, constraints };
}

// ─── Campaign ─────────────────────────────────────────────────────────────────

export type Campaign = {
  id: string;
  name: string;
  joinCode: string;
  enabledPacks: PackId[];
  partyId: string;
  currentSessionId?: string;
  questLog: {
    questId: string;
    status: "locked" | "available" | "completed";
    completedAt?: Date;
  }[];
  createdAt: Date;
};

// ─── Session ──────────────────────────────────────────────────────────────────

export type RoomState = {
  roomId: string;
  state: "hidden" | "revealed" | "cleared";
};

export type Session = {
  id: string;
  campaignId: string;
  questId: string;
  startedAt: Date;
  endedAt?: Date;
  rooms: RoomState[];
  monsters: MonsterInstance[];
  rulesSnapshot: EffectiveRules;
};

// ─── Hero ─────────────────────────────────────────────────────────────────────

export type Equipment = {
  id: string;
  name: string;
  attackBonus?: number;
  defendBonus?: number;
};

export type Item = {
  id: string;
  name: string;
  quantity: number;
  effect?: string;
};

export type Hero = {
  id: string;
  heroTypeId: HeroTypeId;
  name: string;
  playerId: string;
  campaignId: string;

  bodyPointsMax: number;
  bodyPointsCurrent: number;
  mindPointsMax: number;
  mindPointsCurrent: number;

  attackDice: number;
  defendDice: number;

  gold: number;
  equipment: Equipment[];
  consumables: Item[];
  spellsChosenThisQuest: string[];

  statusFlags: {
    isDead: boolean;
    isInShock: boolean;
    isDisguised?: boolean;
  };
};

// ─── Monster ──────────────────────────────────────────────────────────────────

export type MonsterInstance = {
  id: string;
  monsterTypeId: string;
  label: string;
  bodyPointsCurrent: number;
  bodyPointsMax: number;
  mindPointsCurrent?: number;
  roomId: string;
  statusFlags?: {
    isEthereal?: boolean;
    isSmokeBombed?: boolean;
  };
};

// ─── Party ────────────────────────────────────────────────────────────────────

export type Party = {
  id: string;
  campaignId: string;
  heroIds: string[];
  reputationTokens: number;
};

// ─── Socket Commands ──────────────────────────────────────────────────────────

export type AdjustPointsCommand = {
  type: "ADJUST_POINTS";
  entityType: "hero" | "monster";
  entityId: string;
  pool: "BP" | "MP";
  delta: number;
};

export type SelectHeroCommand = {
  type: "SELECT_HERO";
  sessionId: string;
  playerId: string;
  heroTypeId: HeroTypeId;
  heroName: string;
};

export type SetRoomStateCommand = {
  type: "SET_ROOM_STATE";
  sessionId: string;
  roomId: string;
  state: "hidden" | "revealed" | "cleared";
};

export type UseItemCommand = {
  type: "USE_ITEM";
  heroId: string;
  itemId: string;
};

export type SpawnMonsterCommand = {
  type: "SPAWN_MONSTER";
  sessionId: string;
  monsterTypeId: string;
  label: string;
  roomId: string;
  bodyPointsMax: number;
  mindPointsCurrent?: number;
};

export type RemoveMonsterCommand = {
  type: "REMOVE_MONSTER";
  sessionId: string;
  monsterId: string;
};

export type SelectSpellCommand = {
  type: "SELECT_SPELL";
  heroId: string;
  spell: string;
  chosen: boolean;
};

export type SocketCommand =
  | AdjustPointsCommand
  | SelectHeroCommand
  | SelectSpellCommand
  | SetRoomStateCommand
  | UseItemCommand
  | SpawnMonsterCommand
  | RemoveMonsterCommand;

// ─── Hero Base Stats ──────────────────────────────────────────────────────────

export const HERO_BASE_STATS: Record<HeroTypeId, Pick<Hero, "bodyPointsMax" | "mindPointsMax" | "attackDice" | "defendDice">> = {
  barbarian: { bodyPointsMax: 8, mindPointsMax: 2, attackDice: 3, defendDice: 2 },
  dwarf:     { bodyPointsMax: 7, mindPointsMax: 3, attackDice: 2, defendDice: 2 },
  elf:       { bodyPointsMax: 6, mindPointsMax: 4, attackDice: 2, defendDice: 2 },
  wizard:    { bodyPointsMax: 4, mindPointsMax: 6, attackDice: 1, defendDice: 2 },
  knight:    { bodyPointsMax: 7, mindPointsMax: 4, attackDice: 2, defendDice: 3 },
};

// ─── Quest Data (metadata only, no copyrighted text) ─────────────────────────

export const QUESTS: Quest[] = [
  // Base Game
  { id: "base-1",  packId: "BASE",       number: 1,  title: "The Trial" },
  { id: "base-2",  packId: "BASE",       number: 2,  title: "The Maze of Zagor" },
  { id: "base-3",  packId: "BASE",       number: 3,  title: "Bastion of Evil" },
  { id: "base-4",  packId: "BASE",       number: 4,  title: "The Fire Mage" },
  { id: "base-5",  packId: "BASE",       number: 5,  title: "The Castle of Mystery" },
  { id: "base-6",  packId: "BASE",       number: 6,  title: "The Rescue of Sir Ragnar" },
  { id: "base-7",  packId: "BASE",       number: 7,  title: "The Witch Lord's Sword" },
  { id: "base-8",  packId: "BASE",       number: 8,  title: "Maze of the Witch Lord" },
  { id: "base-9",  packId: "BASE",       number: 9,  title: "Prince Magnus's Gold" },
  { id: "base-10", packId: "BASE",       number: 10, title: "The Witch Lord's Domain" },
  // Dread Moon
  { id: "dm-1",    packId: "DREAD_MOON", number: 1,  title: "The Mark of Dread" },
  { id: "dm-2",    packId: "DREAD_MOON", number: 2,  title: "The Dungeon Below" },
  { id: "dm-3",    packId: "DREAD_MOON", number: 3,  title: "The Caverns of Corruption" },
  { id: "dm-4",    packId: "DREAD_MOON", number: 4,  title: "Secrets of the Catacombs" },
  { id: "dm-5",    packId: "DREAD_MOON", number: 5,  title: "The Crystal Caves" },
  { id: "dm-6",    packId: "DREAD_MOON", number: 6,  title: "The Fallen Keep" },
  { id: "dm-7",    packId: "DREAD_MOON", number: 7,  title: "The Shadow Vaults" },
  { id: "dm-8",    packId: "DREAD_MOON", number: 8,  title: "The Dread Moon Rising" },
];

// ─── Monster Types ────────────────────────────────────────────────────────────

export type MonsterType = {
  id: string;
  name: string;
  bodyPointsMax: number;
  mindPointsCurrent?: number;
  attackDice: number;
  defendDice: number;
  movement: number;
};

export const MONSTER_TYPES: MonsterType[] = [
  { id: "goblin",       name: "Goblin",       bodyPointsMax: 1, attackDice: 2, defendDice: 1, movement: 10 },
  { id: "orc",          name: "Orc",          bodyPointsMax: 2, attackDice: 3, defendDice: 2, movement: 6  },
  { id: "chaos_warrior",name: "Chaos Warrior",bodyPointsMax: 3, attackDice: 3, defendDice: 4, movement: 6  },
  { id: "gargoyle",     name: "Gargoyle",     bodyPointsMax: 4, attackDice: 4, defendDice: 4, movement: 6  },
  { id: "mummy",        name: "Mummy",        bodyPointsMax: 3, attackDice: 3, defendDice: 3, movement: 6  },
  { id: "zombie",       name: "Zombie",       bodyPointsMax: 2, attackDice: 2, defendDice: 2, movement: 6  },
  { id: "skeleton",     name: "Skeleton",     bodyPointsMax: 1, attackDice: 2, defendDice: 2, movement: 6  },
  { id: "witch_lord",   name: "Witch Lord",   bodyPointsMax: 6, mindPointsCurrent: 6, attackDice: 4, defendDice: 6, movement: 6 },
];
