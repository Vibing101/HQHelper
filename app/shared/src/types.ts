export * from "./engine/dice";
import type { CombatDieFace } from "./engine/dice";

// ─── Pack & System IDs ──────────────────────────────────────────────────────

export type PackId = "BASE" | "DREAD_MOON";

export type EnabledSystem =
  | "reputationTokens"
  | "disguises"
  | "mercenaries"
  | "alchemy"
  | "mindShock"
  | "etherealMonsters"
  | "undergroundMarket"
  | "hideouts";

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
      etherealMonsters: false,
      undergroundMarket: false,
      hideouts: false,
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
      etherealMonsters: true,
      undergroundMarket: true,
      hideouts: true,
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
  // roomId → adjacent roomIds (placeholder — verify against physical questbook)
  roomGraph?: Record<string, string[]>;
  // Engine-level behaviour tags (no copyrighted text)
  specialRuleTags?: string[];
};

// ─── Effective Rules ──────────────────────────────────────────────────────────

export type EffectiveRules = {
  packIds: PackId[];
  allowedHeroes: HeroTypeId[];
  enabledSystems: Record<EnabledSystem, boolean>;
  constraints: Required<NonNullable<PackDefinition["constraints"]>>;
};

const SYSTEM_KEYS: EnabledSystem[] = [
  "reputationTokens",
  "disguises",
  "mercenaries",
  "alchemy",
  "mindShock",
  "etherealMonsters",
  "undergroundMarket",
  "hideouts",
];

export function resolveEffectiveRules(enabledPacks: PackId[], quest?: Quest): EffectiveRules {
  const packs = enabledPacks.map((id) => PACKS[id]);

  // Union of all allowedHeroes across enabled packs
  let allowedHeroes: HeroTypeId[] = Array.from(
    new Set(packs.flatMap((p) => p.allowedHeroes)),
  );

  // OR-merge enabledSystems: any pack that enables a system enables it globally
  let enabledSystems = Object.fromEntries(
    SYSTEM_KEYS.map((key) => [key, packs.some((p) => p.enabledSystems[key])]),
  ) as Record<EnabledSystem, boolean>;

  // Most-permissive constraints: AND for uniqueHeroesOnly, MAX for maxPartySize
  const constraints = {
    uniqueHeroesOnly: packs.every((p) => p.constraints?.uniqueHeroesOnly ?? true),
    maxPartySize: packs.length > 0 ? Math.max(...packs.map((p) => p.constraints?.maxPartySize ?? 4)) : 4,
  };

  // Quest flag overrides applied on top of merged pack rules
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

  return { packIds: enabledPacks, allowedHeroes, enabledSystems, constraints };
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
  sessionFlags: Record<string, boolean | number | string>;
};

// ─── Equipment Model ──────────────────────────────────────────────────────────

export type EquipSlot = "weaponMain" | "weaponOff" | "armorBody" | "armorHead";

export type ItemCategory = "weapon" | "armor" | "consumable" | "artifact" | "tool";

export type WeaponTag = "oneHanded" | "twoHanded" | "ranged" | "diagonal" | "disguiseLegal";

export type ArmorTag = "helmet" | "shield" | "bodyArmor" | "bracers" | "cloakNotArmor";

export type ItemDefinition = {
  id: string;
  name: string;
  category: ItemCategory;
  description?: string;
  costGold?: number;
  equipSlot?: EquipSlot;
  weaponTags?: WeaponTag[];
  armorTags?: ArmorTag[];
  attackDiceBonus?: number;
  defendDiceBonus?: number;
  mindPointBonus?: number;
};

export type EquippedItem = { instanceId: string; itemId: string };

export type InventoryItem = { instanceId: string; itemId: string };

export type ConsumableItem = {
  instanceId: string;
  itemId: string;
  quantity: number;
  usesRemaining?: number;
  // Legacy/custom support: existing records may still carry these fields.
  name?: string;
  effect?: string;
};

// An artifact is an ItemDefinition that can only be obtained via quest rewards.
export type ArtifactDefinition = ItemDefinition & {
  /** Quest IDs from which this artifact can be awarded. */
  sourceQuestIds: string[];
};

// Tracks an artifact instance in a hero's possession.
export type ArtifactInstance = {
  instanceId: string;
  artifactId: string;
};

export type MercenaryTypeId = "scout" | "guardian" | "crossbowman" | "swordsman";

export type MercenaryInstance = {
  id: string;
  mercenaryTypeId: MercenaryTypeId;
  name: string;
  bodyPointsCurrent: number;
  bodyPointsMax: number;
  hiredByHeroId: string;
};

export type AlchemyState = {
  reagents: string[];
  potions: string[];
  reagentKitUsesRemaining?: number;
};

// ─── Hero ─────────────────────────────────────────────────────────────────────

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
  equipped: Partial<Record<EquipSlot, EquippedItem>>;
  inventory: InventoryItem[];
  consumables: ConsumableItem[];
  artifacts: ArtifactInstance[];
  alchemy?: AlchemyState;
  hideoutRestUsedThisQuest?: boolean;
  spellsChosenThisQuest: string[];

  statusFlags: {
    isDead: boolean;
    isInShock: boolean;
    isDisguised?: boolean;
    hasDisguiseToken?: boolean;
    disguiseBrokenReason?: string;
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
  unlockedMercenaryTypes: MercenaryTypeId[];
  mercenaries: MercenaryInstance[];
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
  itemId: string;
  slot: EquipSlot;
};

export type UnequipItemCommand = {
  type: "UNEQUIP_ITEM";
  heroId: string;
  slot: EquipSlot;
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

export type RequestSnapshotCommand = {
  type: "REQUEST_SNAPSHOT";
  sessionId?: string;
};

export type SetHeroDisguiseCommand = {
  type: "SET_HERO_DISGUISE";
  heroId: string;
  isDisguised: boolean;
};

export type AdjustReputationCommand = {
  type: "ADJUST_REPUTATION";
  amount: number;
};

export type UnlockMercenaryTypeCommand = {
  type: "UNLOCK_MERCENARY_TYPE";
  mercenaryTypeId: MercenaryTypeId;
};

export type HireMercenaryCommand = {
  type: "HIRE_MERCENARY";
  heroId: string;
  mercenaryTypeId: MercenaryTypeId;
  payWith: "gold" | "reputation";
};

export type DismissMercenaryCommand = {
  type: "DISMISS_MERCENARY";
  mercenaryId: string;
};

export type AdjustMercenaryPointsCommand = {
  type: "ADJUST_MERCENARY_POINTS";
  mercenaryId: string;
  delta: number;
};

export type AddReagentCommand = {
  type: "ADD_REAGENT";
  heroId: string;
  reagentId: string;
};

export type RemoveReagentCommand = {
  type: "REMOVE_REAGENT";
  heroId: string;
  reagentId: string;
};

export type CraftPotionCommand = {
  type: "CRAFT_POTION";
  heroId: string;
  potionId: string;
  consumeReagentIds: string[];
  useReagentKit?: boolean;
};

export type DrawRandomAlchemyPotionCommand = {
  type: "DRAW_RANDOM_ALCHEMY_POTION";
  heroId: string;
};

export type SetMonsterStatusCommand = {
  type: "SET_MONSTER_STATUS";
  sessionId: string;
  monsterId: string;
  status: "isEthereal" | "isSmokeBombed";
  value: boolean;
};

export type BuyUndergroundItemCommand = {
  type: "BUY_UNDERGROUND_ITEM";
  heroId: string;
  itemId: string;
};

export type UseHideoutRestCommand = {
  type: "USE_HIDEOUT_REST";
  heroId: string;
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
  | SetQuestStatusCommand
  | RequestSnapshotCommand
  | SetHeroDisguiseCommand
  | AdjustReputationCommand
  | UnlockMercenaryTypeCommand
  | HireMercenaryCommand
  | DismissMercenaryCommand
  | AdjustMercenaryPointsCommand
  | AddReagentCommand
  | RemoveReagentCommand
  | CraftPotionCommand
  | DrawRandomAlchemyPotionCommand
  | SetMonsterStatusCommand
  | BuyUndergroundItemCommand
  | UseHideoutRestCommand;

export type StateSnapshot = {
  campaign: Campaign | null;
  party: Party | null;
  heroes: Hero[];
  session: Session | null;
  requestedAt: string;
};

// ─── Hero Base Stats ──────────────────────────────────────────────────────────

export const HERO_BASE_STATS: Record<HeroTypeId, Pick<Hero, "bodyPointsMax" | "mindPointsMax" | "attackDice" | "defendDice">> = {
  barbarian: { bodyPointsMax: 8, mindPointsMax: 2, attackDice: 3, defendDice: 2 },
  dwarf:     { bodyPointsMax: 7, mindPointsMax: 3, attackDice: 2, defendDice: 2 },
  elf:       { bodyPointsMax: 6, mindPointsMax: 4, attackDice: 2, defendDice: 2 },
  wizard:    { bodyPointsMax: 4, mindPointsMax: 6, attackDice: 1, defendDice: 2 },
  knight:    { bodyPointsMax: 7, mindPointsMax: 4, attackDice: 2, defendDice: 3 },
};

// Quest data lives in app/shared/src/data/*/quests/ — import from there.
export { QUESTS } from "./data/quests";

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

// ─── Item Catalog ─────────────────────────────────────────────────────────────
// Combined lookup catalog: gear (armory, tools, consumables) + artifacts (quest rewards).

import { GEAR_CATALOG as _GEAR } from "./data/gear";
import { ARTIFACT_CATALOG as _ARTIFACTS } from "./data/artifacts";

export { _GEAR as GEAR_CATALOG, _ARTIFACTS as ARTIFACT_CATALOG };

export const ITEM_CATALOG: ItemDefinition[] = [..._GEAR, ..._ARTIFACTS];

export type DiceSourceType = "weapon" | "spell" | "artifact";

export function resolveEffectiveHeroDice(hero: Hero): { attack: number; defend: number; note?: string } {
  if (hero.statusFlags.isInShock) {
    return { attack: 1, defend: 2, note: "Mind Shock active: equipment bonuses ignored" };
  }
  const equippedItems = Object.values(hero.equipped ?? {})
    .map((e) => ITEM_CATALOG.find((i) => i.id === e.itemId))
    .filter(Boolean);
  const attackBonus = equippedItems.reduce((sum, item) => sum + (item?.attackDiceBonus ?? 0), 0);
  const defendBonus = equippedItems.reduce((sum, item) => sum + (item?.defendDiceBonus ?? 0), 0);
  return { attack: hero.attackDice + attackBonus, defend: hero.defendDice + defendBonus };
}

export function getHitRuleReminder(targetIsEthereal: boolean, sourceType: DiceSourceType): string {
  if (!targetIsEthereal) return "Normal hit resolution: skulls hit.";
  if (sourceType === "weapon") return "Ethereal target: roll black shields to hit.";
  return "Ethereal target: spell/artifact attacks resolve normally.";
}

// ─── Equipment Legality ───────────────────────────────────────────────────────

export function canEquipItem(
  hero: Hero,
  item: ItemDefinition,
  rules: EffectiveRules,
): { ok: true } | { ok: false; reason: string } {
  if (!item.equipSlot) {
    return { ok: false, reason: "Item cannot be equipped in a slot" };
  }
  const slot = item.equipSlot;

  // Wizard cannot wear armor or use two-handed (large) weapons
  if (hero.heroTypeId === "wizard") {
    if (slot === "armorBody" || slot === "armorHead") {
      return { ok: false, reason: "Wizard cannot wear armor" };
    }
    if (item.weaponTags?.includes("twoHanded")) {
      return { ok: false, reason: "Wizard cannot use large (two-handed) weapons" };
    }
  }

  // Two-handed weapon blocks shield in offhand
  if (slot === "weaponMain" && item.weaponTags?.includes("twoHanded")) {
    const offHandId = hero.equipped?.weaponOff?.itemId;
    if (offHandId) {
      const offItem = ITEM_CATALOG.find((i) => i.id === offHandId);
      if (offItem?.armorTags?.includes("shield")) {
        return { ok: false, reason: "Cannot equip a two-handed weapon while a shield is equipped" };
      }
    }
  }

  // Shield blocked by two-handed weapon in main hand
  if (slot === "weaponOff" && item.armorTags?.includes("shield")) {
    const mainHandId = hero.equipped?.weaponMain?.itemId;
    if (mainHandId) {
      const mainItem = ITEM_CATALOG.find((i) => i.id === mainHandId);
      if (mainItem?.weaponTags?.includes("twoHanded")) {
        return { ok: false, reason: "Cannot equip a shield with a two-handed weapon" };
      }
    }
  }

  // Disguise restrictions (Dread Moon)
  if (hero.statusFlags.isDisguised && rules.enabledSystems.disguises) {
    if (slot === "weaponMain" || slot === "weaponOff") {
      if (!item.weaponTags?.includes("disguiseLegal")) {
        return { ok: false, reason: "Cannot equip this weapon while disguised" };
      }
    }
    if (slot === "armorBody") {
      return { ok: false, reason: "Cannot wear body armor while disguised" };
    }
    if (slot === "armorHead") {
      if (!item.armorTags?.includes("helmet") && !item.armorTags?.includes("bracers")) {
        return { ok: false, reason: "Can only wear a helmet or bracers while disguised" };
      }
    }
  }

  return { ok: true };
}
