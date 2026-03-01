# HeroQuest Companion App
## Gear Rules & Catalog Audit (V5 ➜ V6)

This document audits the **current gear catalog** in V5 and defines the **V6 equipment rules** that must be enforced.

It is written to solve two problems:

1) V5’s gear list is not structured enough to enforce equip legality.
2) Dread Moon introduces **disguise legality** rules that depend on weapon/armor classification. fileciteturn1file3

---

# What Exists in V5 Today

Current `GEAR_CATALOG` (from `app/shared/src/types.ts`) contains:

Weapons:
- Short Sword (+1)
- Hand Axe (+1)
- Spear (+1)
- Broadsword (+2)
- Battle Axe (+2)
- Crossbow (+2, ranged)
- Magic Sword (+2 atk, +1 def)  ⚠ mixes with “magic/artifact-like”

Armor:
- Helmet (+1 def)
- Shield (+1 def)
- Cloak of Protection (+1 def) ⚠ “cloak” classification matters for disguise rules
- Chain Mail (+2 def)
- Plate Armour (+3 def)

Consumables:
- Healing Potion
- Healing Herb
- Holy Water

Magic:
- Talisman of Lore (+1 def, +2 mind points) ⚠ “artifact-like”

---

# V5 Problems (Must Fix in V6)

## Problem A — No Equip Slots / No Legality
Everything is “an item in a list”, so the system cannot enforce:
- “one weapon at a time” (rule reminder) fileciteturn1file14
- “wizard cannot wear armor or use large weapons” fileciteturn1file0
- Dread Moon disguise restrictions fileciteturn1file3

## Problem B — Mixing Armory Items with Artifacts
V5 includes “Magic Sword” and “Talisman of Lore” inside the “gear catalog”.
In HQ rules, **armory/equipment** vs **artifacts** are separate decks/categories.
V6 should keep them separate to avoid rule confusion and to support “artifact treated as item it represents” in Dread Moon disguises. fileciteturn1file3

## Problem C — Costs Cannot Be Reliably Validated From Text
The core rulebook explicitly says “refer to equipment cards for complete information.” fileciteturn1file12  
Those equipment card costs/restrictions are not cleanly present as plain text in the provided rulebook extract.

**V6 approach:**
- Treat gold costs as **data** (entered from the physical cards you own)
- Treat equip legality rules as **code-enforced constraints** (this doc)

---

# V6 Equipment Model (Recommended)

## Data Types

```ts
export type EquipSlot =
  | "weaponMain"
  | "weaponOff"
  | "armorBody"
  | "armorHead";

export type ItemCategory =
  | "weapon"
  | "armor"
  | "consumable"
  | "artifact"
  | "tool";

export type WeaponTag =
  | "oneHanded"
  | "twoHanded"
  | "ranged"
  | "diagonal"
  | "disguiseLegal"; // Dread Moon

export type ArmorTag =
  | "helmet"
  | "shield"
  | "bodyArmor"
  | "bracers"
  | "cloakNotArmor"; // important for Dread Moon note fileciteturn1file3

export type ItemDefinition = {
  id: string;
  name: string;
  category: ItemCategory;
  costGold?: number;
  equipSlot?: EquipSlot;
  weaponTags?: WeaponTag[];
  armorTags?: ArmorTag[];
  attackDiceBonus?: number;
  defendDiceBonus?: number;
  mindPointBonus?: number;
};
```

---

# V6 Equip Legality Rules (Code-Enforced)

## Rule 1 — Wizard Restrictions
Wizard cannot wear armor or use large weapons. fileciteturn1file0

Implementation:
- Wizard: `armorHead` allowed? **NO** if you treat helmets as armor.
- Wizard: `armorBody` / `weaponMain(twoHanded)` **not allowed**.
- Wizard: dagger/staff style weapons allowed (small weapons).

> Note: The provided rules text explicitly says “cannot wear armor” for Wizard. fileciteturn1file0  
> If you choose to allow “Wizard Cloak” as not-armor, model it as `cloakNotArmor`.

## Rule 2 — One Weapon at a Time (Reminder + Validation)
“You may only attack with one weapon at a time.” fileciteturn1file14

Implementation:
- Only one “attack-capable” weapon may be equipped in `weaponMain`.
- Offhand is reserved for shield or a special item.

## Rule 3 — Shields vs Two-Handed Weapons
Even if not explicitly in the extracted text, HeroQuest gameplay standard is:
- A shield is an offhand defensive item.
- Two-handed weapons occupy both hands.

Implementation:
- If `weaponMain` has `twoHanded`, block equipping `weaponOff` shield.

## Rule 4 — Dread Moon Disguise Restrictions (Pack System)
When disguised, a hero must:
- Attack unarmed or with dagger/shortsword/handaxe/staff fileciteturn1file3
- Cast no spells fileciteturn1file3
- Wear no armor other than bracers and helmets fileciteturn1file3
- Artifacts count as the item they represent (e.g., Borin’s Armor counts as plate mail) fileciteturn1file3

Implementation:
- If `hero.statusFlags.isDisguised === true`:
  - Only allow weapons tagged `disguiseLegal`
  - Only allow armor tagged `helmet` or `bracers`
  - Reject spell casts
  - Keep prohibited equipment in inventory but mark “inactive while disguised”

---

# V6 Catalog Fixes Needed (Based on Rules)

## 1) Reclassify “Cloak of Protection”
Dread Moon note: “Wizard’s Cloak is not armor”. fileciteturn1file3  
So you must be able to represent:
- “cloak” items that give defense but are not “armor” for disguise logic.

Recommendation:
- category: `artifact` (or `tool`)
- armorTags: `cloakNotArmor`
- equipSlot: none (or `cloak` if you add a slot later)

## 2) Remove “Magic Sword” and “Talisman of Lore” from Armory
Move them to:
- `artifact` catalog
- acquisition via quests / treasure events (GM adds artifact)

## 3) Add Expansion Market Items (Dread Moon)
Underground Market items and costs:
- Caltrops: 100 fileciteturn1file15
- Smoke Bomb: 100 fileciteturn1file15
- Reagent Kit: 400 fileciteturn1file15

These are not “armory”, but “market” items:
- category: `tool` (or `consumable` for caltrops/smoke bomb)
- Reagent Kit has 5 uses fileciteturn1file15

---

# Deliverable for V6 (What Devs Should Implement)

## Server-side validation functions
- `canEquipItem(hero, item, effectiveRules): { ok: true } | { ok: false, reason }`
- `canUseWeaponWhileDisguised(hero, item): boolean`
- `resolveEffectiveAttackDice(hero): number` (mind shock rule can override bonuses) fileciteturn1file17
- `resolveEffectiveDefendDice(hero): number` (mind shock rule can override bonuses) fileciteturn1file17

## Commands
- `EQUIP_ITEM` (server validates)
- `UNEQUIP_ITEM`
- `USE_ITEM`
- Dread Moon: `SET_HERO_DISGUISE` (also triggers “equipment inactive while disguised” evaluation)

---

# Definition of Done (Gear)
Gear is “done” when:

- Wizard cannot equip armor or “large weapons” fileciteturn1file0
- Two-handed weapons prevent shield equip (rule enforced)
- Items are separated: armory vs artifacts vs tools
- Disguise legality is enforced by weapon/armor tags fileciteturn1file3
- Market items exist with correct costs and behavior fileciteturn1file15
