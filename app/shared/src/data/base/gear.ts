import type { ItemDefinition } from "../../types";

// ─── Weapons ─────────────────────────────────────────────────────────────────

export const BASE_WEAPONS: ItemDefinition[] = [
  { id: "short_sword",  name: "Short Sword",  category: "weapon", equipSlot: "weaponMain", weaponTags: ["oneHanded", "disguiseLegal"], attackDiceBonus: 1, costGold: 150, description: "+1 Attack die" },
  { id: "hand_axe",     name: "Hand Axe",     category: "weapon", equipSlot: "weaponMain", weaponTags: ["oneHanded", "disguiseLegal"], attackDiceBonus: 1, costGold: 200, description: "+1 Attack die" },
  { id: "spear",        name: "Spear",        category: "weapon", equipSlot: "weaponMain", weaponTags: ["oneHanded", "disguiseLegal"], attackDiceBonus: 1, costGold: 200, description: "+1 Attack die" },
  { id: "broadsword",   name: "Broadsword",   category: "weapon", equipSlot: "weaponMain", weaponTags: ["twoHanded"],                  attackDiceBonus: 2, costGold: 350, description: "+2 Attack dice (two-handed)" },
  { id: "battle_axe",   name: "Battle Axe",   category: "weapon", equipSlot: "weaponMain", weaponTags: ["twoHanded"],                  attackDiceBonus: 2, costGold: 250, description: "+2 Attack dice (two-handed)" },
  { id: "crossbow",     name: "Crossbow",     category: "weapon", equipSlot: "weaponMain", weaponTags: ["ranged", "oneHanded"],        attackDiceBonus: 2, costGold: 300, description: "+2 Attack dice, ranged" },
];

// ─── Armor ───────────────────────────────────────────────────────────────────

export const BASE_ARMOR: ItemDefinition[] = [
  { id: "shield",       name: "Shield",       category: "armor", equipSlot: "weaponOff",  armorTags: ["shield"],    defendDiceBonus: 1, costGold: 150, description: "+1 Defense die" },
  { id: "helmet",       name: "Helmet",       category: "armor", equipSlot: "armorHead",  armorTags: ["helmet"],    defendDiceBonus: 1, costGold: 150, description: "+1 Defense die" },
  { id: "chain_mail",   name: "Chain Mail",   category: "armor", equipSlot: "armorBody",  armorTags: ["bodyArmor"], defendDiceBonus: 2, costGold: 300, description: "+2 Defense dice" },
  { id: "plate_armour", name: "Plate Armour", category: "armor", equipSlot: "armorBody",  armorTags: ["bodyArmor"], defendDiceBonus: 3, costGold: 450, description: "+3 Defense dice" },
];

// ─── Tools ───────────────────────────────────────────────────────────────────

export const BASE_TOOLS: ItemDefinition[] = [
  { id: "rope",          name: "Rope",           category: "tool", costGold: 50,  description: "Bind or restrain; escape pit traps" },
  { id: "thieves_tools", name: "Thieves' Tools",  category: "tool", costGold: 100, description: "Attempt to pick locks and disarm traps" },
];

export const BASE_CONSUMABLES: ItemDefinition[] = [
  { id: "healing_potion", name: "Healing Potion", category: "consumable", costGold: 100, description: "Restore 4 Body Points" },
  { id: "healing_herb",   name: "Healing Herb",   category: "consumable", costGold: 50,  description: "Restore 2 Body Points" },
  { id: "holy_water",     name: "Holy Water",     category: "consumable", costGold: 75,  description: "Auto-pass next Mind test" },
];

// ─── Combined ─────────────────────────────────────────────────────────────────

export const BASE_GEAR: ItemDefinition[] = [...BASE_WEAPONS, ...BASE_ARMOR, ...BASE_TOOLS, ...BASE_CONSUMABLES];
