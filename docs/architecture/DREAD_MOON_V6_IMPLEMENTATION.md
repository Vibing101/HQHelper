# HeroQuest Companion App
## Dread Moon (V6) — Systems + Implementation Notes

This document is the **V6-aligned** implementation guide for supporting
**Rise of the Dread Moon** as a modular pack.

It builds on your earlier Dread Moon mechanics notes, but re-frames everything as:
- pack-enabled systems
- server-authoritative state
- data-driven “rules + items + monsters” where possible

---

# Pack Enablement

`PackDefinition` (example):

```ts
export const DREAD_MOON: PackDefinition = {
  id: "DREAD_MOON",
  allowedHeroes: ["barbarian","dwarf","elf","wizard","knight"],
  enabledSystems: [
    "reputationTokens",
    "disguises",
    "mercenaries",
    "alchemy",
    "mindShock",
    "etherealMonsters",
    "undergroundMarket",
    "hideouts"
  ],
};
```

---

# System: Disguises

Rules summary (from quest book):
- No action required to take/surrender disguise token in quests that allow it fileciteturn1file3
- While disguised:
  - only specific small weapons/unarmed/staff fileciteturn1file3
  - no spellcasting fileciteturn1file3
  - only helmets/bracers as armor fileciteturn1file3
  - artifacts count as what they represent fileciteturn1file3

### Data Model
- `hero.statusFlags.isDisguised: boolean`
- `hero.statusFlags.hasDisguiseToken: boolean`
- `hero.statusFlags.disguiseBrokenReason?: string`

### Core Behavior
- Server must enforce:
  - equip legality while disguised
  - spell cast prohibition while disguised
- Server should keep prohibited gear in inventory but mark as “inactive while disguised”.

---

# System: Reputation Tokens

Rules summary:
- Zargon awards one token at end of each quest (shared) fileciteturn1file7
- Tokens can be sold between quests for 250 gold, must be immediately spent in Underground Market, excess lost fileciteturn1file7
- May be spent to hire a mercenary instead of paying gold fileciteturn2file10

### Data Model
- `party.reputationTokens: number`

### Commands (GM)
- `ADJUST_REPUTATION`
- `SELL_REPUTATION_FOR_MARKET_GOLD` (optional convenience)
- `SPEND_REPUTATION` (generic “spend 1 token” for quest-note triggers)

---

# System: Underground Market Items

Items & costs (explicit):
- Caltrops 100 fileciteturn1file15
- Smoke Bomb 100 fileciteturn1file15
- Reagent Kit 400 (5 uses) fileciteturn1file15

### Item Behaviors
- Caltrops: place tile during movement; triggers roll; ends movement on most results fileciteturn1file15
- Smoke Bomb: use during movement on adjacent monster; “heroes move unseen through monster’s space” until monster’s next turn fileciteturn1file15
- Reagent Kit: action; adjacent to Alchemist’s Bench; transforms reagent; 5 uses fileciteturn1file15

### Implementation note
V6 should track these as:
- tool/consumable items with uses and/or “placed tiles” markers in session state.

---

# System: Alchemy

Rules summary:
- Potions exist as an Alchemy deck.
- Random potion draw: shuffle deck, draw one, record potion, return card fileciteturn1file3
- Crafting:
  - Wizard can craft between quests or adjacent to bench using reagents fileciteturn1file3
  - Others need Reagent Kit to craft (adjacent to bench) fileciteturn1file3

### Data Model
Minimal tracking (recommended):
- `hero.alchemy.reagents: ReagentId[]`
- `hero.alchemy.potions: PotionId[]`
- `hero.alchemy.reagentKitUsesRemaining?: number`

Commands:
- `ADD_REAGENT`, `REMOVE_REAGENT`
- `CRAFT_POTION`
- `DRAW_RANDOM_ALCHEMY_POTION`

---

# System: Mercenaries

Rules summary:
- Must be **unlocked** via quest notes; choose one of four types fileciteturn2file10
- Hire between quests:
  - pay listed cost per quest
  - only one of each type per quest fileciteturn2file10
- Can retain by paying half cost (rounded down) per quest fileciteturn2file10
- Or hire via 1 reputation token: stays with hero until death/dismiss, no payments fileciteturn2file10

Mercenary stats table (from quest book) fileciteturn2file10

### Data Model
- `party.unlockedMercenaryTypes: MercenaryTypeId[]`
- `party.mercenaries: MercenaryInstance[]`

Commands:
- `UNLOCK_MERCENARY_TYPE`
- `HIRE_MERCENARY`
- `DISMISS_MERCENARY`
- `ADJUST_MERCENARY_POINTS`

---

# System: Mind Shock

Rules summary:
- At 0 Mind Points, hero is “in shock” fileciteturn1file17
- While shocked:
  - 1 movement die
  - 1 attack die
  - 2 defend dice
  - armor/weapons/artifacts do not increase attack/defend dice fileciteturn1file17

Implementation:
- `hero.statusFlags.isInShock`
- dice resolver must ignore equipment bonuses when shocked

---

# System: Ethereal Monsters

Rules summary:
- Ethereal monsters can move through heroes/walls/solid objects; must end on unoccupied; may not move into undiscovered areas fileciteturn1file17
- To hit ethereal target with Attack dice, hero must roll **black shields** instead of skulls (unless spell/artifact attack) fileciteturn1file17
- Ethereal monsters ignore traps (including caltrops) fileciteturn1file17

Implementation:
- `monster.statusFlags.isEthereal`
- `resolveHitsAgainstTarget({targetIsEthereal, sourceType})`

---

# System: Hideouts

Rules summary:
- Hideout: safe; may be searched once/quest; wandering monster/hazard draws do not take effect fileciteturn1file18
- Once per quest per hero, as an action in hideout:
  - roll one red die, restore that many points split between BP/MP fileciteturn1file18

Implementation:
- session flag: `hideout.searchUsed: boolean`
- per-hero flag: `hero.hideoutRestUsedThisQuest: boolean`

---

# V6 Done Criteria (Dread Moon)
Dread Moon is considered implemented when:

- Pack enables all Dread Moon systems
- Disguise legality is enforced server-side fileciteturn1file3
- Reputation, mercenaries, alchemy persist and sync
- Mind shock overrides dice calculation fileciteturn1file17
- Ethereal hit logic is supported fileciteturn1file17
- Underground market items exist and behave correctly fileciteturn1file15
- Hideout rest action works once per quest fileciteturn1file18
