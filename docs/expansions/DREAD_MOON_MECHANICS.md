
# HeroQuest Companion App
## Rise of the Dread Moon Mechanics

This document describes the implementation requirements for supporting the **Rise of the Dread Moon** expansion inside the HQ Companion App.

The goal is to add tracking and rules assistance for the expansion mechanics while keeping the app aligned with the project philosophy:

- The app **tracks state**, it does not fully simulate gameplay.
- The app **does not include copyrighted quest text or artwork**.
- The app **synchronizes all state changes in real-time** through Socket.io.

---

# Overview

Rise of the Dread Moon introduces several new gameplay systems that must be supported by the app:

| System | Purpose |
|------|------|
| Disguises | Allows stealth gameplay in certain quests |
| Reputation Tokens | Party-level currency earned during the campaign |
| Mercenaries | Hireable NPC allies |
| Alchemy | Crafting system for potions |
| Mind Shock | Status effect when Mind Points reach zero |
| Ethereal Monsters | Special monster attack rule |
| Smoke Bomb Status | Temporary monster effect |
| Underground Market | Expanded shop items |
| Hideouts | Safe rest locations |

Most systems are already partially defined in the shared rules engine.

---

# Pack Activation

The expansion is enabled via the Pack Rules Engine.

Location:

app/shared/src/types.ts

Pack configuration example:

```ts
PACKS.DREAD_MOON = {
  allowedHeroes: ["barbarian","dwarf","elf","wizard","knight"],
  enabledSystems: [
    "reputationTokens",
    "disguises",
    "mercenaries",
    "alchemy",
    "mindShock"
  ]
}
```

The server resolves the final rules using:

resolveEffectiveRules()

---

# Disguise System

Heroes may begin certain quests disguised.

### Hero State

Hero.statusFlags.isDisguised?: boolean

Optional fields:

Hero.statusFlags.disguiseBrokenReason?: string

### Commands

Add to SocketCommand:

SET_HERO_DISGUISE  
BREAK_HERO_DISGUISE

Example:

{
  "type": "SET_HERO_DISGUISE",
  "heroId": "string",
  "isDisguised": true
}

### Server Behavior

- GM may toggle disguise for any hero.
- Player may toggle their own hero.
- Breaking disguise updates hero flags and emits state update.

### Client UI

Player Sheet:

[Disguised]  
Break Disguise

GM Dashboard:

Toggle Disguise

---

# Reputation Tokens

Reputation tokens are a shared party resource.

### Data Model

Party.reputationTokens: number

### Commands

ADJUST_REPUTATION

Example:

{
  "type": "ADJUST_REPUTATION",
  "partyId": "string",
  "delta": 1,
  "reason": "Quest reward"
}

### Server Behavior

- GM only
- Updates party model
- Emits PARTY_UPDATED

### Client UI

GM Dashboard:

Reputation: 3  

+ Add  
- Spend

---

# Mercenaries

Mercenaries are hireable NPC allies.

Types:

striker  
glaive  
arbalist  
scout

### Shared Types

MercenaryTypeId  
MercenaryInstance

Example:

```ts
type MercenaryInstance = {
  id: string
  typeId: MercenaryTypeId
  hiredByHeroId: string
  bodyPointsCurrent: number
  bodyPointsMax: number
  isActive: boolean
}
```

### Commands

UNLOCK_MERCENARY_TYPE  
HIRE_MERCENARY  
DISMISS_MERCENARY  
ADJUST_MERCENARY_POINTS

### Storage

Recommended location:

Party.mercenaries[]

### Client UI

GM Dashboard:

Mercenaries  
- Striker  
- Glaive  
- Arbalist  
- Scout  

Each mercenary shows:

HP tracker  
Assigned hero  
Dismiss button

---

# Alchemy System

Alchemy allows heroes to craft potions.

### Data Model

Option A (simple):

Hero.consumables[]

Option B (preferred):

Hero.alchemy = {
  reagents: [],
  potions: [],
  reagentKitUsesRemaining: number
}

### Commands

ADD_REAGENT  
REMOVE_REAGENT  
CRAFT_POTION  
DRAW_RANDOM_ALCHEMY_POTION

### Crafting Flow

Hero collects reagent  
Hero crafts potion  
Reagent consumed  
Potion added to inventory

Wizard crafting rule:

Wizard does not require Reagent Kit

### Client UI

Player Sheet → Alchemy tab

Reagents  
Craft Potion  
Potions Inventory

---

# Mind Shock

A hero enters **shock** when Mind Points reach zero.

### Data Model

Hero.statusFlags.isInShock

### Client Behavior

When active display:

⚠ Shock

Movement Dice: 1  
Attack Dice: 1  
Defend Dice: 2

The app does not enforce dice rolls, only reminds players.

---

# Ethereal Monsters

Certain monsters are ethereal.

### Data Model

Monster.statusFlags.isEthereal

### Rule Reminder

Ethereal monsters require:

Black shield results to hit

unless attacked by spells or artifacts.

### Client UI

Monster Tracker Badge:

Ethereal

---

# Smoke Bomb Effect

Smoke bombs temporarily affect monsters.

### Data Model

Monster.statusFlags.isSmokeBombed

### Command

SET_MONSTER_STATUS

Example:

{
 "type": "SET_MONSTER_STATUS",
 "monsterId": "string",
 "patch": {
   "isSmokeBombed": true
 }
}

### UI

Monster Badge:

Smoke Bombed

---

# Hideouts

Hideouts are safe areas used between encounters.

Minimal implementation:

Hideout Rest Used: true/false

Heroes may record healing manually.

---

# Underground Market

The expansion adds additional shop items.

Recommended items:

caltrops  
smoke_bomb  
reagent_kit

Purchasing adds the item to hero inventory.

---

# Networking Model

All state updates follow the existing pattern:

SocketCommand → Server Handler → MongoDB Update → state_update event

Example broadcast:

io.to(campaignId).emit("state_update", {...})

No new networking pattern is required.

---

# Definition of Done

The expansion is considered supported when:

- Disguise system works
- Reputation tokens persist
- Mercenaries can be hired and tracked
- Alchemy inventory exists
- Mind Shock status visible
- Ethereal monsters flagged
- Smoke bomb status toggled
- Underground market items available
