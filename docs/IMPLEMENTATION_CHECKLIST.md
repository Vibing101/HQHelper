
# Rise of the Dread Moon Implementation Checklist

This checklist tracks implementation progress for supporting the expansion mechanics.

---

# Shared Types

- [ ] Add MercenaryTypeId
- [ ] Add MercenaryInstance
- [ ] Extend Party model with mercenaries
- [ ] Extend Hero model with alchemy inventory
- [ ] Add disguise metadata fields

---

# Socket Commands

Add new commands to SocketCommand union.

- [ ] SET_HERO_DISGUISE
- [ ] BREAK_HERO_DISGUISE
- [ ] ADJUST_REPUTATION
- [ ] UNLOCK_MERCENARY_TYPE
- [ ] HIRE_MERCENARY
- [ ] DISMISS_MERCENARY
- [ ] ADJUST_MERCENARY_POINTS
- [ ] ADD_REAGENT
- [ ] REMOVE_REAGENT
- [ ] CRAFT_POTION
- [ ] DRAW_RANDOM_ALCHEMY_POTION
- [ ] SET_MONSTER_STATUS

---

# Server Handlers

Implement handlers in:

server/src/socket/handlers.ts

- [ ] Disguise handler
- [ ] Reputation handler
- [ ] Mercenary handlers
- [ ] Alchemy handlers
- [ ] Monster status handler

Each handler must:

- validate permissions
- update MongoDB
- emit state_update

---

# Database

Update schemas if required.

- [ ] Party reputation tokens
- [ ] Party mercenary list
- [ ] Hero alchemy inventory

---

# Client UI

### Player Sheet

- [ ] Disguise badge
- [ ] Alchemy tab
- [ ] Potion inventory
- [ ] Shock indicator

### GM Dashboard

- [ ] Reputation tracker
- [ ] Mercenary management panel
- [ ] Monster status toggles
- [ ] Disguise toggle

---

# Gear Catalog

Add expansion items:

- [ ] Caltrops
- [ ] Smoke Bomb
- [ ] Reagent Kit

---

# Testing

- [ ] Test disguise toggle sync
- [ ] Test reputation adjustments
- [ ] Test mercenary hire/dismiss
- [ ] Test alchemy crafting
- [ ] Test mind shock state
- [ ] Test monster status flags

---

# Completion Criteria

All enabled systems for the Dread Moon pack must be operational:

reputationTokens  
disguises  
mercenaries  
alchemy  
mindShock  

The app must correctly track all expansion states in multiplayer sessions.
