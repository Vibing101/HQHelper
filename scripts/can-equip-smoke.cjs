const assert = require("node:assert/strict");
const shared = require("../app/shared/dist/types.js");

const { canEquipItem, ITEM_CATALOG, resolveEffectiveRules } = shared;

function hero(overrides = {}) {
  return {
    id: "h1",
    heroTypeId: "barbarian",
    name: "Smoke Hero",
    playerId: "p1",
    campaignId: "c1",
    bodyPointsMax: 8,
    bodyPointsCurrent: 8,
    mindPointsMax: 2,
    mindPointsCurrent: 2,
    attackDice: 3,
    defendDice: 2,
    gold: 0,
    equipped: {},
    inventory: [],
    consumables: [],
    artifacts: [],
    spellsChosenThisQuest: [],
    statusFlags: { isDead: false, isInShock: false, isDisguised: false },
    ...overrides,
  };
}

function findItem(itemId) {
  const item = ITEM_CATALOG.find((i) => i.id === itemId);
  if (!item) throw new Error(`Missing item in ITEM_CATALOG: ${itemId}`);
  return item;
}

function run() {
  const baseRules = resolveEffectiveRules(["BASE"]);
  const dreadRules = resolveEffectiveRules(["BASE", "DREAD_MOON"]);

  const wizardShield = canEquipItem(hero({ heroTypeId: "wizard" }), findItem("shield"), baseRules);
  assert.equal(wizardShield.ok, false);
  assert.equal(wizardShield.reason, "Wizard cannot wear armor");

  const withShield = hero({ equipped: { weaponOff: { instanceId: "i1", itemId: "shield" } } });
  const twoHandedBlocked = canEquipItem(withShield, findItem("broadsword"), baseRules);
  assert.equal(twoHandedBlocked.ok, false);
  assert.equal(twoHandedBlocked.reason, "Cannot equip a two-handed weapon while a shield is equipped");

  const disguisedHero = hero({ statusFlags: { isDead: false, isInShock: false, isDisguised: true } });
  const disguisedShield = canEquipItem(disguisedHero, findItem("shield"), dreadRules);
  assert.equal(disguisedShield.ok, false);
  assert.equal(disguisedShield.reason, "Cannot equip a shield while disguised");

  const disguisedLegalWeapon = canEquipItem(disguisedHero, findItem("short_sword"), dreadRules);
  assert.equal(disguisedLegalWeapon.ok, true);

  console.log("canEquipItem smoke checks passed");
}

run();
