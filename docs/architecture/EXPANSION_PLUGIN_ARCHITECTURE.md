
# HeroQuest Companion App
## Expansion Plugin Architecture

This document defines the **Expansion Plugin Architecture** used by the HQ Companion App.

The goal is to ensure that **future HeroQuest expansions can be added without modifying core systems**.

Supported expansions may include:

- Kellar's Keep
- Return of the Witch Lord
- Frozen Horror
- Mage of the Mirror
- Rise of the Dread Moon
- Future custom quests

The architecture must allow expansions to:

- enable or disable gameplay systems
- introduce new heroes
- introduce new monsters
- add new items
- extend quest behavior

---

# Design Principles

The expansion system follows these principles:

1. **Core Engine Stability**  
   The core rules engine should never require modification when adding a new expansion.

2. **Expansion Isolation**  
   Each expansion should exist in its own module.

3. **Feature Flags**  
   Expansion features are enabled via configuration rather than code branching.

4. **Server Authoritative State**  
   All expansion mechanics are enforced by the server.

5. **Client UI Reactivity**  
   The UI simply reflects enabled systems.

---

# Directory Structure

Recommended folder structure:

```
app/shared/src/packs/
    base.ts
    dreadMoon.ts
    frozenHorror.ts
    mageOfMirror.ts
```

Each pack exports a `PackDefinition`.

---

# PackDefinition Interface

Located in:

```
app/shared/src/types.ts
```

Example interface:

```ts
export interface PackDefinition {
  id: PackId
  allowedHeroes: HeroClassId[]
  enabledSystems: EnabledSystem[]
  defaultRules?: Partial<RulesConfig>
}
```

---

# Example: Dread Moon Pack

```ts
export const DREAD_MOON: PackDefinition = {
  id: "DREAD_MOON",
  allowedHeroes: [
    "barbarian",
    "dwarf",
    "elf",
    "wizard",
    "knight"
  ],
  enabledSystems: [
    "reputationTokens",
    "disguises",
    "mercenaries",
    "alchemy",
    "mindShock"
  ]
}
```

---

# System Flags

Enabled systems determine which mechanics are active during gameplay.

```
EnabledSystem
```

Current list:

```
reputationTokens
disguises
mercenaries
alchemy
mindShock
```

Future systems may include:

```
weather
mounts
summoning
pets
factionReputation
```

---

# Rules Resolution

The server determines final rules via:

```
resolveEffectiveRules()
```

Inputs:

```
campaign.enabledPacks
quest.flags
pack.defaultRules
```

Output:

```
RulesConfig
```

Example:

```ts
{
  disguises: true,
  reputationTokens: true,
  mercenaries: true
}
```

---

# Hero Availability

Hero selection is controlled by pack configuration.

Server validation:

```
SELECT_HERO command
```

Validation logic:

```
if heroClass not in rules.allowedHeroes
  reject selection
```

---

# Adding a New Expansion

Steps required to support a new expansion:

### 1. Create Pack Definition

```
app/shared/src/packs/newExpansion.ts
```

### 2. Register Pack

Add to:

```
PACKS registry
```

### 3. Add Feature Flags

Extend:

```
EnabledSystem
```

### 4. Implement Server Logic

Add handlers for new commands if required.

### 5. Add Client UI

UI components must be conditionally rendered:

```
if rules.enabledSystems.includes("alchemy")
```

---

# Example: Frozen Horror

Example pack definition:

```ts
export const FROZEN_HORROR = {
  id: "FROZEN_HORROR",
  allowedHeroes: [
    "barbarian",
    "dwarf",
    "elf",
    "wizard"
  ],
  enabledSystems: [
    "weather",
    "iceHazards"
  ]
}
```

---

# Data Migration Strategy

When adding new expansions:

- Avoid modifying existing schemas where possible.
- Prefer adding optional fields.

Example:

```
Hero.statusFlags.newFeature?: boolean
```

This ensures backward compatibility with existing campaigns.

---

# Client Rendering Strategy

Client components must respect enabled systems.

Example:

```ts
if (!rules.enabledSystems.includes("alchemy")) {
  return null
}
```

This prevents UI elements appearing in unsupported expansions.

---

# Version Compatibility

Campaign objects should store enabled packs:

```
campaign.enabledPacks: PackId[]
```

This ensures older campaigns remain playable even if new expansions are added later.

---

# Future Enhancements

The plugin architecture allows support for:

- Custom community quest packs
- Custom heroes
- Custom monsters
- Custom rule modifiers

Example:

```
customPacks/
```

Users could upload JSON definitions for new expansions.

---

# Summary

The Expansion Plugin Architecture ensures:

- expansions are modular
- core engine remains stable
- UI adapts automatically
- server maintains authoritative rule validation

This architecture allows the HQ Companion App to scale as additional HeroQuest content is released.
