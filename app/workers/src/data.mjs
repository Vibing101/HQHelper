export const HERO_BASE_STATS = {
  barbarian: { bodyPointsMax: 8, mindPointsMax: 2, attackDice: 3, defendDice: 2 },
  dwarf: { bodyPointsMax: 7, mindPointsMax: 3, attackDice: 2, defendDice: 2 },
  elf: { bodyPointsMax: 6, mindPointsMax: 4, attackDice: 2, defendDice: 2 },
  wizard: { bodyPointsMax: 4, mindPointsMax: 6, attackDice: 1, defendDice: 2 },
  knight: { bodyPointsMax: 7, mindPointsMax: 4, attackDice: 2, defendDice: 3 },
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
