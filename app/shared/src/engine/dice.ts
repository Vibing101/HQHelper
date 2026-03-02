// ─── Combat Dice Engine ───────────────────────────────────────────────────────
//
// The HeroQuest combat die has 6 equal faces:
//   2 × Skull        — attacker hits / defender takes damage
//   2 × White Shield — hero defender blocks
//   2 × Black Shield — monster defender blocks
//
// Attack: hero rolls N dice → each Skull = 1 hit
// Defense (hero): hero rolls N dice → each White Shield = 1 block
// Defense (monster): monster rolls N dice → each Black Shield = 1 block

export type CombatDieFace = "skull" | "whiteShield" | "blackShield";

const FACES: CombatDieFace[] = [
  "skull", "skull",
  "whiteShield", "whiteShield",
  "blackShield", "blackShield",
];

export function rollCombatDice(n: number): CombatDieFace[] {
  return Array.from({ length: n }, () => FACES[Math.floor(Math.random() * 6)]);
}

export function countHitsForHeroAttack(faces: CombatDieFace[]): number {
  return faces.filter((f) => f === "skull").length;
}

export function countBlocksForHeroDefense(faces: CombatDieFace[]): number {
  return faces.filter((f) => f === "whiteShield").length;
}

export function countBlocksForMonsterDefense(faces: CombatDieFace[]): number {
  return faces.filter((f) => f === "blackShield").length;
}
