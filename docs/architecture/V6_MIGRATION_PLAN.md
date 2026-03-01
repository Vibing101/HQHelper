# HeroQuest Companion App
## V6 Migration Plan (Base System + Expansions)

This plan migrates **HQ_Companioon_V5** into **V6** with two goals:

1) Make **Base Game** mechanics tracking trustworthy (especially dice, spells, equipment rules, and state sync).
2) Make expansions (starting with **Rise of the Dread Moon**) plug in cleanly via a pack/plugin system.

This is intentionally written as an **implementation plan** for dev agents:
- **what to change**
- **where to change it**
- **what “done” means**
- and how to avoid rework later.

---

# Current V5 Baseline (What We Keep)

Keep these as the stable foundation:

- MongoDB-backed **Campaign / Session** persistence
- Socket.io **server-authoritative state updates**
- Room reveal → room spawns pattern (GM action triggers server spawn logic)
- Hero BP/MP tracking and monster BP tracking
- “App tracks state, does not enforce every tabletop rule” philosophy

---

# V6 Target Architecture

## Single Mutation Pipeline (Critical)
**All state changes become SocketCommands.**

- REST routes become **read-only** (or removed)
- Every mutation must:
  1) validate permissions + inputs
  2) update DB (atomic as needed)
  3) emit a single `state_update` payload

This removes inconsistent permission enforcement and inconsistent client refresh behavior.

## Shared Types vs Game Data (Critical)
Split `shared/src/types.ts` into:
- **types only** (interfaces, unions, shared helpers)
- **data modules** (spells, gear, monsters, quests, packs)

Suggested structure:

```
app/shared/src/
  types/
    index.ts
    commands.ts
    rules.ts
    state.ts
  data/
    base/
      gear.ts
      spells.ts
      monsters.ts
      quests/
        quest_01_trial.json
        ...
    dreadMoon/
      gear.ts
      rules.ts
      monsters.ts
      notes.ts
  packs/
    base.ts
    dreadMoon.ts
    registry.ts
```

---

# V6 Milestones

## Milestone 0 — Repo + Build Hygiene
- [ ] Create new branch `v6-migration`
- [ ] Add `/docs/V6_MIGRATION_PLAN.md` and supporting docs (this set)
- [ ] Add `npm` scripts for lint/typecheck/test in root
- [ ] Ensure CI checks run on PR

**Done means:** a clean baseline to refactor without breaking deploy.

---

## Milestone 1 — Auth Baseline (Enough for Real Phones)
V5 allows REST mutation without strong authorization. V6 must enforce identity.

### Requirements
- [ ] When a player joins a campaign/session, server returns a **signed token**:
  - campaignId
  - sessionId
  - role: `"gm" | "player"`
  - playerId or heroId ownership mapping
- [ ] Socket connections must present token.
- [ ] Server stores resolved identity in `socket.data`.

### Permissions
- GM-only commands: room reveal, monster spawns, reputation adjustments, unlock mercenaries, etc.
- Player commands: mutate only their hero (BP/MP, inventory use, etc.)

**Done means:** no unauthenticated or unauthorized actor can mutate other players’ heroes.

---

## Milestone 2 — Combat Dice Engine (HeroQuest Accurate)
V5 dice currently do not represent HQ dice correctly.

### Requirements
Implement HQ combat dice faces:
- `skull`
- `whiteShield`
- `blackShield`

Resolution reminders:
- Hero attacks score hits on **skulls**. fileciteturn1file4
- Monsters defend by blocking hits on **black shields**. fileciteturn1file4
- Heroes defend by blocking hits on **white shields**. fileciteturn1file2

### Implementation
- [ ] Move dice logic to `shared/src/engine/dice.ts`
- [ ] Provide helpers:
  - `rollCombatDice(n): CombatFace[]`
  - `countHitsForHeroAttack(faces): number`
  - `countBlocksForHeroDefense(faces): number`
  - `countBlocksForMonsterDefense(faces): number`
- [ ] UI uses engine helpers (no embedded probabilities in components)

**Done means:** Dice results are consistent and testable.

---

## Milestone 3 — Spell System Correction (Base)
Base system has **4 spell groups** (Air/Fire/Water/Earth), **3 spells each**. fileciteturn1file16

### Requirements
- [ ] Enforce group sizes (3 spells per element)
- [ ] Wizard begins with **three spell groups** (9 spells) fileciteturn1file4
- [ ] Elf begins with **one spell group** (3 spells) fileciteturn1file14
- [ ] Track “cast once per quest” usage (at least at group/spell level)

**Done means:** the app’s spell selection no longer contradicts the core rules.

---

## Milestone 4 — Equipment Rules + Catalog Revamp (Base + Expansion Hooks)
V5 gear list is small and mixes “armory-like” items with non-armory “magic/artifact-like” items.

### Requirements (Minimal-but-correct)
- [ ] Introduce explicit equip slots:
  - `weaponMain`
  - `weaponOff` (shield / offhand)
  - `armorBody` (chain/plate)
  - `armorHead` (helmet)
- [ ] Validate equip restrictions at equip time:
  - Wizard cannot wear armor or use large weapons. fileciteturn1file0
- [ ] Support “one weapon at a time” reminder. fileciteturn1file14
- [ ] Add support for weapon tags used by expansions (e.g., “disguise-legal”).

**Done means:** inventory is structurally future-proof and enforceably consistent.

See: `/docs/GEAR_RULES_AND_CATALOG_AUDIT.md`

---

## Milestone 5 — Quest Data Normalization (Base)
V5 embeds quest definitions in shared types. V6 should store quest metadata externally.

### Requirements
- [ ] Move quests to JSON (no copyrighted prose)
- [ ] Store only:
  - room graph/ids
  - spawn groups
  - special flags (pack gating, systems enabled, special rules toggles)
- [ ] Keep quest “notes” as placeholders or IDs (no copyrighted quest text)

**Done means:** quests become data-driven and pack-aware.

---

## Milestone 6 — Expansion Plugin System (Pack Rules Engine)
Implement the Pack Rules Engine as the only gatekeeper for:
- allowed heroes
- enabled systems
- per-pack rule overrides
- quest-level overrides

This aligns with the Expansion Plugin Architecture doc.

### Requirements
- [ ] Create `PackDefinition` (base + dreadMoon)
- [ ] Implement `resolveEffectiveRules({ campaignPacks, questFlags })`
- [ ] Client renders UI based on `effectiveRules.enabledSystems`
- [ ] Server validates commands against `effectiveRules`

**Done means:** adding a new expansion becomes “add pack + data + handlers”, not “edit core code”.

(If you already added the architecture doc earlier, keep it and align naming.)

---

## Milestone 7 — Rise of the Dread Moon (Full Support)
Implement Dread Moon mechanics as **systems** enabled by the pack:

Enabled systems:
- disguises
- reputationTokens
- mercenaries
- alchemy
- mindShock
- etherealMonsters
- undergroundMarket
- hideouts

Rules highlights:
- Disguise restrictions (allowed weapons, no spell casting, armor limits) fileciteturn1file3
- Mind shock penalties at 0 Mind Points fileciteturn1file17
- Ethereal hit rule (black shields to hit) fileciteturn1file17
- Underground Market items & costs: caltrops (100), smoke bomb (100), reagent kit (400) fileciteturn1file15
- Hideout healing action once/quest fileciteturn1file18

**Done means:** the Dread Moon pack can be enabled on a campaign and all systems appear + persist + sync.

See:
- `/docs/DREAD_MOON_V6_IMPLEMENTATION.md`
- your earlier `/docs/DREAD_MOON_MECHANICS.md` can be merged or kept as “V5 notes”.

---

# High-Impact Revamp Checklist (Carry into V6)
This is the short list of changes that deliver the most correctness/value quickly:

1) **Single mutation layer**: all mutations via SocketCommands  
2) **HQ dice correctness**: skull/white/black + correct block semantics fileciteturn1file4  
3) **Spell groups corrected**: 3 spells per element; wizard=3 groups; elf=1 fileciteturn1file16  
4) **Equipment slots + restrictions**: wizard armor/large weapon restrictions enforced fileciteturn1file0  
5) **Pack rules engine**: enabledSystems gates UI + server validation  
6) **Minimal auth**: signed token + ownership checks on every mutation

---

# Definition of Done (V6 “Ready”)
V6 is “ready” when:

- Multiplayer sessions remain stable under phone usage (reconnects, refresh, late join)
- All gameplay-tracking features match core rules where the app claims accuracy
- Expansion systems can be enabled/disabled without touching core files
- Gear equip rules cannot be broken via API calls
- Dread Moon systems (disguise/reputation/mercenaries/alchemy/mind shock/ethereal/hideout/market) are implemented and persist

