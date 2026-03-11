export const HERO_BASE_STATS = {
  barbarian: { bodyPointsMax: 8, mindPointsMax: 2, attackDice: 3, defendDice: 2 },
  dwarf: { bodyPointsMax: 7, mindPointsMax: 3, attackDice: 2, defendDice: 2 },
  elf: { bodyPointsMax: 6, mindPointsMax: 4, attackDice: 2, defendDice: 2 },
  wizard: { bodyPointsMax: 4, mindPointsMax: 6, attackDice: 1, defendDice: 2 },
  knight: { bodyPointsMax: 7, mindPointsMax: 4, attackDice: 2, defendDice: 3 },
};

export const PACKS = {
  BASE: {
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

export const QUESTS = [
  { id: "base-1", packId: "BASE" },
  { id: "base-2", packId: "BASE" },
  { id: "base-3", packId: "BASE" },
  { id: "base-4", packId: "BASE" },
  { id: "base-5", packId: "BASE" },
  { id: "base-6", packId: "BASE" },
  { id: "base-7", packId: "BASE" },
  { id: "base-8", packId: "BASE" },
  { id: "base-9", packId: "BASE" },
  { id: "base-10", packId: "BASE" },
  { id: "dm-1", packId: "DREAD_MOON" },
  { id: "dm-2", packId: "DREAD_MOON" },
  { id: "dm-3", packId: "DREAD_MOON" },
  { id: "dm-4", packId: "DREAD_MOON" },
  { id: "dm-5", packId: "DREAD_MOON" },
  { id: "dm-6", packId: "DREAD_MOON" },
  { id: "dm-7", packId: "DREAD_MOON" },
  { id: "dm-8", packId: "DREAD_MOON" },
];

export const QUEST_ORDER = new Map(QUESTS.map((quest, index) => [quest.id, index]));

export const MONSTER_TYPES = [
  { id: "goblin", name: "Goblin", bodyPointsMax: 1, attackDice: 2, defendDice: 1, movement: 10 },
  { id: "orc", name: "Orc", bodyPointsMax: 2, attackDice: 3, defendDice: 2, movement: 6 },
  { id: "chaos_warrior", name: "Chaos Warrior", bodyPointsMax: 3, attackDice: 3, defendDice: 4, movement: 6 },
  { id: "gargoyle", name: "Gargoyle", bodyPointsMax: 4, attackDice: 4, defendDice: 4, movement: 6 },
  { id: "mummy", name: "Mummy", bodyPointsMax: 3, attackDice: 3, defendDice: 3, movement: 6 },
  { id: "zombie", name: "Zombie", bodyPointsMax: 2, attackDice: 2, defendDice: 2, movement: 6 },
  { id: "skeleton", name: "Skeleton", bodyPointsMax: 1, attackDice: 2, defendDice: 2, movement: 6 },
  { id: "witch_lord", name: "Witch Lord", bodyPointsMax: 6, mindPointsCurrent: 6, attackDice: 4, defendDice: 6, movement: 6 },
];

export const HERO_SPELL_ACCESS = {
  elf: { elementLimit: 1 },
  wizard: { elementLimit: 3 },
};

export const ALL_SPELL_ELEMENTS = ["air", "earth", "fire", "water"];

export const MERCENARY_STATS = {
  scout: { name: "Scout", costGold: 75, bodyPointsMax: 1 },
  guardian: { name: "Guardian", costGold: 100, bodyPointsMax: 2 },
  crossbowman: { name: "Crossbowman", costGold: 125, bodyPointsMax: 2 },
  swordsman: { name: "Swordsman", costGold: 150, bodyPointsMax: 2 },
};

export const ALCHEMY_POTIONS = ["healing_tonic", "stone_draught", "smoke_elixir", "mind_ward"];

export const UNDERGROUND_ITEMS = {
  caltrops: { costGold: 40, name: "Caltrops", description: "Scatter hazardous spikes." },
  smoke_bomb: { costGold: 60, name: "Smoke Bomb", description: "Break line of sight." },
  reagent_kit: { costGold: 125, name: "Reagent Kit", description: "Alchemy crafting kit." },
};

export function resolveEffectiveRules(enabledPacks, quest) {
  const packs = enabledPacks.map((id) => PACKS[id]).filter(Boolean);
  const allowedHeroes = Array.from(new Set(packs.flatMap((pack) => pack.allowedHeroes)));
  const systemKeys = Object.keys(PACKS.BASE.enabledSystems);
  const enabledSystems = Object.fromEntries(
    systemKeys.map((key) => [key, packs.some((pack) => pack.enabledSystems[key])]),
  );
  const constraints = {
    uniqueHeroesOnly: packs.every((pack) => pack.constraints.uniqueHeroesOnly),
    maxPartySize: packs.length > 0 ? Math.max(...packs.map((pack) => pack.constraints.maxPartySize)) : 4,
  };

  return {
    packIds: enabledPacks,
    allowedHeroes,
    enabledSystems,
    constraints,
    questId: quest?.id,
  };
}
