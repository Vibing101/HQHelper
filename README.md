# HeroQuest Companion App  
_In-Person Campaign & Stat Tracker (Base Game + Rise of the Dread Moon)_

---

## 1. Project Overview

HeroQuest Companion App is a **real-time web application** that replaces pen-and-paper tracking during **in-person HeroQuest** sessions.

Physical gameplay remains unchanged:
- Board + minis
- Physical dice rolls
- Physical cards

The app tracks:
- Party & hero sheets
- Equipment, consumables, spell selection
- Monsters spawned and their live stats
- Room/quest progress
- Campaign progress persistence across sessions

This app **does not** resolve combat automatically.

---

## 2. Supported Content

### 2.1 Base Game (HeroQuest Game System)
- Quests from the base system
- Base hero roster: **Barbarian, Dwarf, Elf, Wizard**

### 2.2 Expansion: Rise of the Dread Moon
- Quest pack: **Rise of the Dread Moon**
- Adds additional mechanics that must be trackable by the app (see §8)
- Adds an additional hero: **Knight** (available when playing Dread Moon quests)

> Note: The app must not store or display copyrighted quest text/images. Store structured metadata only (quest IDs, pack IDs, system flags, and GM notes).

---

## 3. Key Requirement: Quest-Based Hero Availability

### Rule
**Hero selection must be constrained by the selected quest’s pack (and any quest overrides).**

- If the GM selects a **Base Game quest** → hero selection is limited to:
  - Barbarian
  - Dwarf
  - Elf
  - Wizard

- If the GM selects a **Rise of the Dread Moon quest** → hero selection includes:
  - Barbarian
  - Dwarf
  - Elf
  - Wizard
  - **Knight**

### Implementation Approach
Each `Quest` has:
- `packId` (e.g., `"BASE"`, `"DREAD_MOON"`)
- `effectiveAllowedHeroIds[]` computed from the Pack Rules Engine + Quest flags (see §6A)

When a session is created from a quest:
- The campaign lobby and hero selection UI **filter** choices to `effectiveAllowedHeroIds`.
- If a player already created a hero that is no longer allowed for the newly selected quest, the GM must resolve it via:
  - “Swap hero for this quest” (recommended)
  - or block session start until party is valid.

---

## 4. Tech Stack (Recommended)

### Frontend
- React (Vite or Next.js)
- TypeScript
- TailwindCSS
- Zustand or Redux Toolkit
- Socket.io client

### Backend
- Node.js + Express (TypeScript)
- Socket.io (WebSocket)
- MongoDB (or DynamoDB if AWS)
- Lightweight auth (join codes + GM token; JWT optional)

---

## 5. Roles & Permissions

### GM (Zargon/Morcar)
- Create/load campaign
- Select quest + start session
- Reveal rooms / track exploration
- Spawn monsters & modify stats
- View party stats
- Mark quests complete (including retroactive)

### Player
- Join campaign via code/QR
- Create/select hero (subject to quest’s allowed roster)
- Manage equipment/inventory
- Use consumables
- Choose spells at session start (if spellcaster)
- Manual stat changes to own hero only (unless GM permission override)

---

## 6. Data Model (Core)

### Pack
```ts
type PackId = "BASE" | "DREAD_MOON";

type EnabledSystem =
  | "reputationTokens"
  | "disguises"
  | "mercenaries"
  | "alchemy"
  | "mindShock"; // 0 Mind Points special state
```

### Quest
```ts
type QuestFlags = Partial<{
  // Override pack defaults (true/false)
  enabledSystems: Partial<Record<EnabledSystem, boolean>>;

  // Override hero roster rules
  allowedHeroIds: string[]; // explicit allowlist for this quest
  disallowedHeroIds: string[]; // subtractive list (applied after allowlist resolution)

  // Optional: extra UI helpers (no copyrighted text)
  notes: string;
}>;

type Quest = {
  id: string;
  packId: PackId;
  number: number;
  title: string;

  // OPTIONAL (legacy / denormalized):
  // allowedHeroIds?: string[];
  // flags?: ...

  flags?: QuestFlags;
};
```

### Campaign
```ts
type Campaign = {
  id: string;
  name: string;
  enabledPacks: PackId[]; // content library availability
  partyId: string;
  questLog: {
    questId: string;
    status: "locked" | "available" | "completed";
    completedAt?: Date;
  }[];
  createdAt: Date;
};
```

### Session
```ts
type Session = {
  id: string;
  campaignId: string;
  questId: string;
  startedAt: Date;
  endedAt?: Date;

  rooms: RoomState[];
  monsters: MonsterInstance[];

  // Snapshot of pack/quest effective rules at start (important for reproducibility):
  rulesSnapshot: EffectiveRules;
};
```

### Hero
```ts
type HeroTypeId = "barbarian" | "dwarf" | "elf" | "wizard" | "knight";

type Hero = {
  id: string;
  heroTypeId: HeroTypeId;
  name: string;

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
    isInShock: boolean;     // mindShock system
    isDisguised?: boolean;  // disguises system
  };
};
```

### MonsterInstance
```ts
type MonsterInstance = {
  id: string;
  monsterTypeId: string;
  label: string;

  bodyPointsCurrent: number;
  mindPointsCurrent?: number;

  roomId: string;

  statusFlags?: {
    isEthereal?: boolean;
    isSmokeBombed?: boolean;
  };
};
```

---

## 6A. Pack Rules Engine (Required)

### Purpose
Formalize pack capabilities (allowed heroes + enabled systems) and allow **Quest-level overrides**.

This keeps the app scalable: adding a new expansion becomes adding a `PackDefinition` and quest metadata, without rewriting core logic.

---

### PackDefinition

```ts
type PackDefinition = {
  id: PackId;

  // Hero roster allowed by default when a quest from this pack is selected.
  allowedHeroes: HeroTypeId[];

  // Systems enabled by default for this pack.
  enabledSystems: Record<EnabledSystem, boolean>;

  // Optional: pack-wide constraints (future-proofing)
  constraints?: Partial<{
    uniqueHeroesOnly: boolean; // prevent duplicates of same heroTypeId in party
    maxPartySize: number;      // default 4, but expansions might change later
  }>;
};
```

#### Example Pack Definitions

```ts
const PACKS: Record<PackId, PackDefinition> = {
  BASE: {
    id: "BASE",
    allowedHeroes: ["barbarian", "dwarf", "elf", "wizard"],
    enabledSystems: {
      reputationTokens: false,
      disguises: false,
      mercenaries: false,
      alchemy: false,
      mindShock: false
    },
    constraints: { uniqueHeroesOnly: true, maxPartySize: 4 }
  },

  DREAD_MOON: {
    id: "DREAD_MOON",
    allowedHeroes: ["barbarian", "dwarf", "elf", "wizard", "knight"],
    enabledSystems: {
      reputationTokens: true,
      disguises: true,
      mercenaries: true,
      alchemy: true,
      mindShock: true
    },
    constraints: { uniqueHeroesOnly: true, maxPartySize: 4 }
  }
};
```

---

### Quest.flags Override Semantics

Quest flags can override pack defaults in three ways:

#### 1) Override enabled systems
- Start from `PackDefinition.enabledSystems`
- Apply `Quest.flags.enabledSystems` as patch values

Example: A specific Dread Moon quest might disable disguises:
```ts
flags: {
  enabledSystems: { disguises: false }
}
```

#### 2) Override allowed heroes (explicit allowlist)
- If `Quest.flags.allowedHeroIds` is present, it becomes the allowlist **instead of** `PackDefinition.allowedHeroes`.

Example: A special quest might force a 4-hero roster even in Dread Moon:
```ts
flags: {
  allowedHeroIds: ["barbarian","dwarf","elf","wizard"]
}
```

#### 3) Disallow heroes (subtractive list)
- Apply `Quest.flags.disallowedHeroIds` **after** resolving the allowlist.

Example: Dread Moon quest that forbids Knight:
```ts
flags: {
  disallowedHeroIds: ["knight"]
}
```

---

### EffectiveRules Resolution (Authoritative)

```ts
type EffectiveRules = {
  packId: PackId;
  allowedHeroes: HeroTypeId[];
  enabledSystems: Record<EnabledSystem, boolean>;
  constraints: Required<NonNullable<PackDefinition["constraints"]>>;
};

function resolveEffectiveRules(packId: PackId, quest?: Quest): EffectiveRules {
  const pack = PACKS[packId];

  // 1) Start with pack defaults
  let allowedHeroes = [...pack.allowedHeroes];
  let enabledSystems = { ...pack.enabledSystems };
  const constraints = {
    uniqueHeroesOnly: pack.constraints?.uniqueHeroesOnly ?? true,
    maxPartySize: pack.constraints?.maxPartySize ?? 4
  };

  // 2) Apply quest overrides
  if (quest?.flags?.enabledSystems) {
    enabledSystems = { ...enabledSystems, ...quest.flags.enabledSystems };
  }

  if (quest?.flags?.allowedHeroIds?.length) {
    allowedHeroes = [...quest.flags.allowedHeroIds] as HeroTypeId[];
  }

  if (quest?.flags?.disallowedHeroIds?.length) {
    const disallowed = new Set(quest.flags.disallowedHeroIds as HeroTypeId[]);
    allowedHeroes = allowedHeroes.filter(h => !disallowed.has(h));
  }

  // 3) Safety: remove duplicates and enforce constraints
  allowedHeroes = Array.from(new Set(allowedHeroes));

  return { packId, allowedHeroes, enabledSystems, constraints };
}
```

**Where used:**
- At quest selection time (GM UI) to render available heroes + enabled modules
- On session creation, stored as `session.rulesSnapshot`
- On server command handling (reject illegal hero selection and enforce system availability)

---

## 7. Real-Time Commands (Socket Events)

Clients send commands; server is authoritative.

### Adjust BP/MP
```ts
{
  type: "ADJUST_POINTS",
  entityType: "hero" | "monster",
  entityId: string,
  pool: "BP" | "MP",
  delta: number
}
```

### Select Hero (must enforce effectiveAllowedHeroes)
```ts
{
  type: "SELECT_HERO",
  sessionId: string,
  playerId: string,
  heroTypeId: "barbarian"|"dwarf"|"elf"|"wizard"|"knight"
}
```

### Reveal Room
```ts
{
  type: "SET_ROOM_STATE",
  roomId: string,
  state: "hidden" | "revealed" | "cleared"
}
```

### Use Item
```ts
{
  type: "USE_ITEM",
  heroId: string,
  itemId: string
}
```

---

## 8. Rise of the Dread Moon: Trackable Systems (Feature Flags)

When `packId = "DREAD_MOON"` OR the quest enables them, the app must support:

### mindShock
- If a hero reaches 0 Mind Points, clearly indicate shock state (app doesn’t roll dice; it flags state).
- Derive: `isInShock = (mindPointsCurrent === 0)`.

### disguises
- Track `isDisguised` on heroes.
- GM can toggle on/off.
- Provide an info panel (paraphrase only).

### reputationTokens
- Party-wide counter: `party.reputationTokens`.
- GM can increment/decrement.

### mercenaries
- Support “ally units” similar to heroes:
  - hired/active per quest
  - assigned to controlling hero
  - BP tracking
  - enforce “no duplicates of same mercenary type per quest” if desired.

### alchemy
- Track crafted/owned alchemy items as consumables.
- Use-now action applies temporary effects and marks used.

---

## 9. Core Features (MVP Scope)

### GM View
- Create/load campaign
- Enable packs (BASE, DREAD_MOON)
- Select quest
- Start/resume session
- Track rooms (revealed/cleared)
- Spawn monsters and track BP/MP
- View party summary
- Campaign progress log (mark quests completed; retroactive completion)

### Player View
- Join via QR/Code
- Choose hero from **effective allowed roster**
- Name hero
- Equip gear (derived stats change)
- Add/use consumables (one-use + temporary effects)
- Spell selection at session start (if applicable)
- Manual BP/MP adjustments

---

## 10. UI Notes (Critical)

### Hero Selection Screen
Must clearly show:
- “Available heroes for this quest”
- If Dread Moon effective roster includes Knight → Knight appears
- If not allowed → Knight is hidden/disabled with explanation (optional)

### Lobby Validity Check
GM cannot start session unless:
- all selected heroes are within `session.rulesSnapshot.allowedHeroes`
- party satisfies constraints (e.g., unique hero types, max party size)

---

## 11. Persistence Requirements

- Campaign state saved automatically on every change.
- Session can be resumed.
- Players reconnect and rehydrate state.
- Store `rulesSnapshot` on session start for consistent enforcement even if pack definitions change later.

---

## 12. Non-Goals (Important)

- No automated combat resolution
- No line-of-sight calculation
- No digital board map rendering
- No copyrighted quest text storage

---

## 13. Definition of Done

MVP is complete when:
- GM can run a full session with synced state across phones
- Campaign progress persists
- Quest selection enforces **hero roster availability**
  - Base quest → 4 heroes only
  - Dread Moon quest → + Knight available
- Pack Rules Engine exists and is used everywhere it matters:
  - `PackDefinition.allowedHeroes`
  - `PackDefinition.enabledSystems`
  - `Quest.flags` overriding pack defaults

---

## 14. Future Roadmap (Not MVP)

- Tactical map grid (optional)
- Initiative tracker
- Export/backup campaign JSON
- Offline mode with conflict resolution
- Additional expansion packs (new `PackDefinition` entries)
