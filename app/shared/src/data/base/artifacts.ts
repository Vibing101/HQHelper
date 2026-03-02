import type { ArtifactDefinition } from "../../types";

// Quest-reward artifacts for the BASE pack.
// sourceQuestIds lists which quests can award each artifact.

export const BASE_ARTIFACTS: ArtifactDefinition[] = [
  {
    id: "cloak",
    name: "Cloak of Protection",
    category: "artifact",
    armorTags: ["cloakNotArmor"],
    defendDiceBonus: 1,
    costGold: 0,
    description: "+1 Defense die (not armor; does not prevent disguise)",
    sourceQuestIds: ["base-3"],
  },
  {
    id: "magic_sword",
    name: "Magic Sword",
    category: "artifact",
    equipSlot: "weaponMain",
    weaponTags: ["oneHanded"],
    attackDiceBonus: 2,
    defendDiceBonus: 1,
    costGold: 0,
    description: "+2 Attack, +1 Defense",
    sourceQuestIds: ["base-9"],
  },
  {
    id: "talisman",
    name: "Talisman of Lore",
    category: "artifact",
    defendDiceBonus: 1,
    mindPointBonus: 2,
    costGold: 0,
    description: "+1 Defense, +2 Mind Points (spellcasters)",
    sourceQuestIds: ["base-5"],
  },
];
