export * from "./engine/dice";
import type { CombatDieFace } from "./engine/dice";

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

// roomId (e.g. "room-3") → monsters to auto-spawn when GM first reveals that room
export type SpawnRule = { monsterTypeId: string; count: number };

export type Quest = {
  id: string;
  packId: PackId;
  number: number;
  title: string;
  flags?: QuestFlags;
  roomSpawns?: Record<string, SpawnRule[]>;
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

export type RollDiceCommand = {
  type: "ROLL_DICE";
  rollType: "attack" | "defense";
  diceCount: number;
  results: CombatDieFace[];
  rollerName: string;
};

export type AddGoldCommand = {
  type: "ADD_GOLD";
  heroId: string;
  amount: number;
};

export type EquipItemCommand = {
  type: "EQUIP_ITEM";
  heroId: string;
  name: string;
  attackBonus?: number;
  defendBonus?: number;
};

export type UnequipItemCommand = {
  type: "UNEQUIP_ITEM";
  heroId: string;
  equipId: string;
};

export type AddConsumableCommand = {
  type: "ADD_CONSUMABLE";
  heroId: string;
  name: string;
  quantity?: number;
  effect?: string;
};

export type StartSessionCommand = {
  type: "START_SESSION";
  questId: string;
};

export type EndSessionCommand = {
  type: "END_SESSION";
  sessionId: string;
};

export type SetQuestStatusCommand = {
  type: "SET_QUEST_STATUS";
  questId: string;
  status: "locked" | "available" | "completed";
};

export type SocketCommand =
  | AdjustPointsCommand
  | SelectHeroCommand
  | SelectSpellCommand
  | SetRoomStateCommand
  | UseItemCommand
  | SpawnMonsterCommand
  | RemoveMonsterCommand
  | RollDiceCommand
  | AddGoldCommand
  | EquipItemCommand
  | UnequipItemCommand
  | AddConsumableCommand
  | StartSessionCommand
  | EndSessionCommand
  | SetQuestStatusCommand;

// ─── Hero Base Stats ──────────────────────────────────────────────────────────

export const HERO_BASE_STATS: Record<HeroTypeId, Pick<Hero, "bodyPointsMax" | "mindPointsMax" | "attackDice" | "defendDice">> = {
  barbarian: { bodyPointsMax: 8, mindPointsMax: 2, attackDice: 3, defendDice: 2 },
  dwarf:     { bodyPointsMax: 7, mindPointsMax: 3, attackDice: 2, defendDice: 2 },
  elf:       { bodyPointsMax: 6, mindPointsMax: 4, attackDice: 2, defendDice: 2 },
  wizard:    { bodyPointsMax: 4, mindPointsMax: 6, attackDice: 1, defendDice: 2 },
  knight:    { bodyPointsMax: 7, mindPointsMax: 4, attackDice: 2, defendDice: 3 },
};

// ─── Quest Data (metadata only, no copyrighted text) ─────────────────────────

// ── Quest Spawn Rules ─────────────────────────────────────────────────────────
// roomSpawns define which monsters auto-spawn when a room is first revealed.
// Room IDs are positional: "room-1" … "room-12" (matching the RoomGrid order).
// These are PLACEHOLDER values — verify against your physical questbook and
// adjust to match the exact monster placement on each quest map before playing.

export const QUESTS: Quest[] = [
  // ── Base Game ──────────────────────────────────────────────────────────────
  {
    id: "base-1", packId: "BASE", number: 1, title: "The Trial",
    roomSpawns: {
      "room-1":  [{ monsterTypeId: "goblin", count: 2 }],
      "room-3":  [{ monsterTypeId: "goblin", count: 1 }],
      "room-5":  [{ monsterTypeId: "orc",    count: 1 }],
      "room-7":  [{ monsterTypeId: "goblin", count: 2 }],
      "room-9":  [{ monsterTypeId: "orc",    count: 1 }],
    },
  },
  {
    id: "base-2", packId: "BASE", number: 2, title: "The Maze of Zagor",
    roomSpawns: {
      "room-2":  [{ monsterTypeId: "goblin", count: 2 }],
      "room-4":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-6":  [{ monsterTypeId: "goblin", count: 1 }],
      "room-8":  [{ monsterTypeId: "orc",    count: 1 }],
      "room-10": [{ monsterTypeId: "chaos_warrior", count: 1 }],
    },
  },
  {
    id: "base-3", packId: "BASE", number: 3, title: "Bastion of Evil",
    roomSpawns: {
      "room-1":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-3":  [{ monsterTypeId: "goblin", count: 2 }],
      "room-5":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-7":  [{ monsterTypeId: "chaos_warrior", count: 1 }],
      "room-9":  [{ monsterTypeId: "orc",    count: 1 }],
    },
  },
  {
    id: "base-4", packId: "BASE", number: 4, title: "The Fire Mage",
    roomSpawns: {
      "room-2":  [{ monsterTypeId: "goblin", count: 3 }],
      "room-4":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-6":  [{ monsterTypeId: "chaos_warrior", count: 1 }],
      "room-8":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-10": [{ monsterTypeId: "chaos_warrior", count: 2 }],
    },
  },
  {
    id: "base-5", packId: "BASE", number: 5, title: "The Castle of Mystery",
    roomSpawns: {
      "room-1":  [{ monsterTypeId: "skeleton", count: 2 }],
      "room-3":  [{ monsterTypeId: "zombie",   count: 2 }],
      "room-5":  [{ monsterTypeId: "skeleton", count: 3 }],
      "room-7":  [{ monsterTypeId: "mummy",    count: 1 }],
      "room-9":  [{ monsterTypeId: "zombie",   count: 2 }],
    },
  },
  {
    id: "base-6", packId: "BASE", number: 6, title: "The Rescue of Sir Ragnar",
    roomSpawns: {
      "room-2":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-4":  [{ monsterTypeId: "goblin", count: 3 }],
      "room-6":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-8":  [{ monsterTypeId: "chaos_warrior", count: 1 }],
      "room-10": [{ monsterTypeId: "orc",    count: 2 }],
    },
  },
  {
    id: "base-7", packId: "BASE", number: 7, title: "The Witch Lord's Sword",
    roomSpawns: {
      "room-1":  [{ monsterTypeId: "skeleton", count: 2 }],
      "room-3":  [{ monsterTypeId: "chaos_warrior", count: 2 }],
      "room-5":  [{ monsterTypeId: "mummy",    count: 1 }],
      "room-7":  [{ monsterTypeId: "chaos_warrior", count: 2 }],
      "room-9":  [{ monsterTypeId: "gargoyle", count: 1 }],
    },
  },
  {
    id: "base-8", packId: "BASE", number: 8, title: "Maze of the Witch Lord",
    roomSpawns: {
      "room-2":  [{ monsterTypeId: "zombie",   count: 2 }],
      "room-4":  [{ monsterTypeId: "skeleton", count: 3 }],
      "room-6":  [{ monsterTypeId: "chaos_warrior", count: 2 }],
      "room-8":  [{ monsterTypeId: "mummy",    count: 2 }],
      "room-10": [{ monsterTypeId: "gargoyle", count: 1 }],
    },
  },
  {
    id: "base-9", packId: "BASE", number: 9, title: "Prince Magnus's Gold",
    roomSpawns: {
      "room-1":  [{ monsterTypeId: "goblin", count: 2 }],
      "room-3":  [{ monsterTypeId: "orc",    count: 2 }],
      "room-5":  [{ monsterTypeId: "chaos_warrior", count: 2 }],
      "room-7":  [{ monsterTypeId: "mummy",   count: 1 }],
      "room-9":  [{ monsterTypeId: "gargoyle", count: 1 }],
    },
  },
  {
    id: "base-10", packId: "BASE", number: 10, title: "The Witch Lord's Domain",
    roomSpawns: {
      "room-2":  [{ monsterTypeId: "chaos_warrior", count: 2 }],
      "room-4":  [{ monsterTypeId: "mummy",    count: 2 }],
      "room-6":  [{ monsterTypeId: "gargoyle", count: 2 }],
      "room-8":  [{ monsterTypeId: "chaos_warrior", count: 2 }],
      "room-10": [{ monsterTypeId: "witch_lord", count: 1 }],
    },
  },
  // ── Dread Moon (no spawn rules yet — fill in from expansion questbook) ──────
  { id: "dm-1", packId: "DREAD_MOON", number: 1, title: "The Mark of Dread" },
  { id: "dm-2", packId: "DREAD_MOON", number: 2, title: "The Dungeon Below" },
  { id: "dm-3", packId: "DREAD_MOON", number: 3, title: "The Caverns of Corruption" },
  { id: "dm-4", packId: "DREAD_MOON", number: 4, title: "Secrets of the Catacombs" },
  { id: "dm-5", packId: "DREAD_MOON", number: 5, title: "The Crystal Caves" },
  { id: "dm-6", packId: "DREAD_MOON", number: 6, title: "The Fallen Keep" },
  { id: "dm-7", packId: "DREAD_MOON", number: 7, title: "The Shadow Vaults" },
  { id: "dm-8", packId: "DREAD_MOON", number: 8, title: "The Dread Moon Rising" },
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

// ─── Gear Catalog ─────────────────────────────────────────────────────────────

export type GearCategory = "weapon" | "armor" | "consumable" | "magic";

export type GearItem = {
  id: string;
  name: string;
  category: GearCategory;
  attackBonus?: number;
  defendBonus?: number;
  description: string;
  goldCost: number;
};

export const GEAR_CATALOG: GearItem[] = [
  // Weapons
  { id: "short_sword",  name: "Short Sword",         category: "weapon",    attackBonus: 1,               description: "+1 Attack die",              goldCost: 150 },
  { id: "hand_axe",     name: "Hand Axe",             category: "weapon",    attackBonus: 1,               description: "+1 Attack die",              goldCost: 200 },
  { id: "spear",        name: "Spear",                category: "weapon",    attackBonus: 1,               description: "+1 Attack die",              goldCost: 200 },
  { id: "broadsword",   name: "Broadsword",           category: "weapon",    attackBonus: 2,               description: "+2 Attack dice",             goldCost: 350 },
  { id: "battle_axe",   name: "Battle Axe",           category: "weapon",    attackBonus: 2,               description: "+2 Attack dice",             goldCost: 250 },
  { id: "crossbow",     name: "Crossbow",             category: "weapon",    attackBonus: 2,               description: "+2 Attack dice, ranged",     goldCost: 300 },
  { id: "magic_sword",  name: "Magic Sword",          category: "magic",     attackBonus: 2, defendBonus: 1, description: "+2 Attack, +1 Defense",   goldCost: 500 },
  // Armor
  { id: "helmet",       name: "Helmet",               category: "armor",                     defendBonus: 1, description: "+1 Defense die",          goldCost: 150 },
  { id: "shield",       name: "Shield",               category: "armor",                     defendBonus: 1, description: "+1 Defense die",          goldCost: 150 },
  { id: "cloak",        name: "Cloak of Protection",  category: "armor",                     defendBonus: 1, description: "+1 Defense die",          goldCost: 200 },
  { id: "chain_mail",   name: "Chain Mail",           category: "armor",                     defendBonus: 2, description: "+2 Defense dice",         goldCost: 300 },
  { id: "plate_armour", name: "Plate Armour",         category: "armor",                     defendBonus: 3, description: "+3 Defense dice",         goldCost: 450 },
  // Consumables
  { id: "healing_potion", name: "Healing Potion",     category: "consumable",                               description: "Restore 4 Body Points",    goldCost: 100 },
  { id: "healing_herb",   name: "Healing Herb",       category: "consumable",                               description: "Restore 2 Body Points",    goldCost: 50  },
  { id: "holy_water",     name: "Holy Water",         category: "consumable",                               description: "Auto-pass next Mind test", goldCost: 75  },
  // Magic
  { id: "talisman",     name: "Talisman of Lore",     category: "magic",                     defendBonus: 1, description: "+1 Defense, +2 Mind Points (spellcasters)", goldCost: 200 },
];

// ─── Spells (2021 Hasbro HeroQuest edition) ───────────────────────────────────

export type SpellElement = "air" | "earth" | "fire" | "water";

export type SpellCard = {
  id: string;
  name: string;
  element: SpellElement;
  description: string;
};

// Spell cards paraphrased — no copyrighted text reproduced.
export const SPELLS: SpellCard[] = [
  // Air
  { id: "gust_of_wind",      element: "air",   name: "Gust of Wind",      description: "Move one monster up to 4 spaces in any direction" },
  { id: "swift_wind",        element: "air",   name: "Swift Wind",        description: "Move any hero or ally up to 6 spaces" },
  { id: "tempest",           element: "air",   name: "Tempest",           description: "All monsters in the room take 1 Body Point of damage" },
  { id: "veil_of_mist",      element: "air",   name: "Veil of Mist",      description: "Until your next turn, attackers roll 1 fewer attack die" },
  // Earth
  { id: "cave_in",           element: "earth", name: "Cave In",           description: "Collapse a corridor, dealing 1 BP damage and blocking passage" },
  { id: "pass_through_rock", element: "earth", name: "Pass Through Rock", description: "Move through any number of walls this turn" },
  { id: "rock_skin",         element: "earth", name: "Rock Skin",         description: "Until your next turn, roll 2 extra defense dice" },
  { id: "tremors",           element: "earth", name: "Tremors",           description: "All monsters in adjacent rooms take 1 BP damage" },
  // Fire
  { id: "ball_of_flame",     element: "fire",  name: "Ball of Flame",     description: "One monster takes 4 Body Points of damage" },
  { id: "courage",           element: "fire",  name: "Courage",           description: "Remove all mind effects; restore 2 Mind Points to a hero" },
  { id: "fire_of_wrath",     element: "fire",  name: "Fire of Wrath",     description: "All monsters in the room take 1 BP damage" },
  { id: "wall_of_fire",      element: "fire",  name: "Wall of Fire",      description: "Create an impassable fire barrier in an adjacent corridor" },
  // Water
  { id: "healing_water",     element: "water", name: "Healing Water",     description: "Restore up to 4 BP to yourself or an adjacent hero" },
  { id: "healing_dew",       element: "water", name: "Healing Dew",       description: "Restore 2 BP to yourself or an adjacent hero" },
  { id: "ice_storm",         element: "water", name: "Ice Storm",         description: "All monsters in the room must pass a Mind test or be stunned for 1 turn" },
  { id: "water_of_strength", element: "water", name: "Water of Strength", description: "Until your next turn, roll 2 extra attack dice" },
];

// Spell selection sequence (group mechanic):
//   Phase 1 — Wizard picks 2 elements from all 4.
//   Phase 2 — Elf picks 1 element from the 2 NOT chosen by Wizard.
//   Phase 3 — The remaining (unchosen) element is auto-assigned to Wizard (server-side).
// Result: Wizard ends with 3 schools, Elf ends with 1. Each hero gets ALL spells from their schools.
export const HERO_SPELL_ACCESS: Partial<Record<HeroTypeId, { elements: SpellElement[]; elementLimit: number }>> = {
  wizard: { elements: ["air", "earth", "fire", "water"], elementLimit: 2 },
  elf:    { elements: ["air", "earth", "fire", "water"], elementLimit: 1 },
};

export const ALL_SPELL_ELEMENTS: SpellElement[] = ["air", "earth", "fire", "water"];
