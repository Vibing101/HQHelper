import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Hero } from "@hq/shared";
import { GEAR_CATALOG, ITEM_CATALOG, HERO_SPELL_ACCESS, SPELLS, rollCombatDice, countHitsForHeroAttack, countBlocksForHeroDefense, resolveEffectiveHeroDice } from "@hq/shared";
import type { EquipSlot } from "@hq/shared";
import type { SpellElement } from "@hq/shared";
import type { EffectiveRules, Party } from "@hq/shared";
import { joinSession, onDiceRoll, onError, onStateUpdate, sendCommand } from "../socket";
import StatAdjuster from "../components/StatAdjuster";

const HERO_ICONS: Record<string, string> = {
  barbarian: "⚔️",
  dwarf: "🪓",
  elf: "🏹",
  wizard: "🧙",
  knight: "🛡️",
};

const ELEMENT_ICONS: Record<string, string> = {
  air: "💨",
  earth: "🪨",
  fire: "🔥",
  water: "💧",
};

const ELEMENT_LABELS: Record<string, string> = {
  air: "Air",
  earth: "Earth",
  fire: "Fire",
  water: "Water",
};

// Equipable items (have a slot) and consumables
const EQUIP_GEAR = ITEM_CATALOG.filter((g) => g.equipSlot !== undefined);
const CONSUMABLE_GEAR = GEAR_CATALOG.filter((g) => g.category === "consumable");

export default function PlayerSheet() {
  const { heroId } = useParams<{ heroId: string }>();
  const [hero, setHero] = useState<Hero | null>(null);
  const [partyGold, setPartyGold] = useState<number | null>(null);
  const [partyHeroes, setPartyHeroes] = useState<Hero[]>([]);
  const [party, setParty] = useState<Party | null>(null);
  const [sessionRules, setSessionRules] = useState<EffectiveRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [socketError, setSocketError] = useState("");
  const [tab, setTab] = useState<"stats" | "inventory" | "spells">("stats");

  // Gear equip state
  const [selectedGearId, setSelectedGearId] = useState(EQUIP_GEAR[0]?.id ?? "");
  const [selectedConsumableId, setSelectedConsumableId] = useState(CONSUMABLE_GEAR[0]?.id ?? "");

  // Dice roll toast
  const [diceToast, setDiceToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gold adjustment
  const [goldInput, setGoldInput] = useState("");
  const [reagentInput, setReagentInput] = useState("");
  const [potionInput, setPotionInput] = useState("");

  function fetchPartyData() {
    const cid = sessionStorage.getItem("campaignId");
    if (!cid) return;
    fetch(`/api/heroes/campaign/${cid}`)
      .then((r) => r.json())
      .then((d) => {
        const heroes = d.heroes ?? [];
        setPartyHeroes(heroes);
        setPartyGold(heroes.reduce((s: number, h: any) => s + (h.gold ?? 0), 0));
      })
      .catch(() => {/* non-critical */});
  }

  function fetchSessionRulesAndParty() {
    const cid = sessionStorage.getItem("campaignId");
    if (!cid) return;
    fetch(`/api/campaigns/${cid}`)
      .then((r) => r.json())
      .then(async (d) => {
        const campaign = d.campaign;
        if (!campaign) return;
        if (campaign.partyId) {
          const pRes = await fetch(`/api/parties/${campaign.partyId}`);
          const pData = await pRes.json();
          if (pData.party) setParty(pData.party);
        }
        if (campaign.currentSessionId) {
          const sRes = await fetch(`/api/sessions/${campaign.currentSessionId}`);
          const sData = await sRes.json();
          if (sData.session?.rulesSnapshot) setSessionRules(sData.session.rulesSnapshot);
        } else {
          setSessionRules(null);
        }
      })
      .catch(() => undefined);
  }

  // Join campaign socket room so real-time events work even after a page refresh
  useEffect(() => {
    const campaignId = sessionStorage.getItem("campaignId");
    const playerId = sessionStorage.getItem("playerId") ?? undefined;
    if (campaignId) {
      joinSession({ campaignId, role: "player", playerId });
    }
  }, []);

  useEffect(() => {
    if (!heroId) return;
    fetch(`/api/heroes/${heroId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setHero(data.hero);
        fetchPartyData();
        fetchSessionRulesAndParty();
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [heroId]);

  useEffect(() => {
    const unsub = onStateUpdate((update) => {
      if (update.type === "SYNC_SNAPSHOT" && update.snapshot) {
        const snapHero = (update.snapshot.heroes ?? []).find((h: Hero) => h.id === heroId);
        if (snapHero) setHero(snapHero);
        if (update.snapshot.party) setParty(update.snapshot.party);
        if (update.snapshot.session?.rulesSnapshot) setSessionRules(update.snapshot.session.rulesSnapshot);
        setPartyHeroes(update.snapshot.heroes ?? []);
        return;
      }
      if (update.type === "HERO_UPDATED" && update.hero.id === heroId) {
        setHero(update.hero);
        fetchPartyData();
      }
      // Another hero updated (e.g. wizard auto-assigned after elf picks) — refresh party data
      if (update.type === "HERO_UPDATED" && update.hero.id !== heroId) {
        fetchPartyData();
      }
      if (update.type === "PARTY_UPDATED") setParty(update.party);
      if (update.type === "SESSION_STARTED" || update.type === "SESSION_ENDED" || update.type === "SESSION_UPDATED") {
        fetchSessionRulesAndParty();
      }
    });
    return unsub;
  }, [heroId]);

  useEffect(() => {
    const unsub = onError((err) => setSocketError(err.message));
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onDiceRoll((roll) => {
      const faces = roll.results as import("@hq/shared").CombatDieFace[];
      const hits = countHitsForHeroAttack(faces);
      const blocks = countBlocksForHeroDefense(faces);
      const icons = faces.map((f) => f === "skull" ? "💀" : f === "whiteShield" ? "🛡️" : "⬛").join(" ");
      const msg = roll.rollType === "attack"
        ? `${roll.rollerName} attacked: ${icons} — ${hits} hit(s)`
        : `${roll.rollerName} defended: ${icons} — ${blocks} block(s)`;
      setDiceToast(msg);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setDiceToast(null), 5000);
    });
    return unsub;
  }, []);

  function adjustStat(pool: "BP" | "MP", delta: number) {
    if (!heroId) return;
    sendCommand({ type: "ADJUST_POINTS", entityType: "hero", entityId: heroId, pool, delta });
  }

  function useItem(itemId: string) {
    if (!heroId) return;
    sendCommand({ type: "USE_ITEM", heroId, itemId });
  }

  function adjustGold() {
    if (!heroId || !goldInput) return;
    sendCommand({ type: "ADD_GOLD", heroId, amount: Number(goldInput) });
    setGoldInput("");
  }

  // Spell element selection — choosing an element grants all spells in that element
  function toggleElement(element: string) {
    if (!hero || !heroId) return;
    const access = HERO_SPELL_ACCESS[hero.heroTypeId];
    if (!access) return;
    const chosen = hero.spellsChosenThisQuest.includes(element);
    if (!chosen && hero.spellsChosenThisQuest.length >= access.elementLimit) return;
    sendCommand({ type: "SELECT_SPELL", heroId, spell: element, chosen: !chosen });
  }

  function rollDice(rollType: "attack" | "defense") {
    if (!hero) return;
    const pools = resolveEffectiveHeroDice(hero);
    const effectiveAttack = pools.attack;
    const effectiveDefend = pools.defend;
    const diceCount = rollType === "attack" ? effectiveAttack : effectiveDefend;
    const results = rollCombatDice(diceCount);
    sendCommand({ type: "ROLL_DICE", rollType, diceCount, results, rollerName: hero.name });
  }

  function equipFromCatalog() {
    if (!heroId || !selectedGearId) return;
    const item = EQUIP_GEAR.find((g) => g.id === selectedGearId);
    if (!item?.equipSlot) return;
    sendCommand({ type: "EQUIP_ITEM", heroId, itemId: item.id, slot: item.equipSlot as EquipSlot });
  }

  function addConsumableFromCatalog() {
    if (!heroId || !selectedConsumableId) return;
    const item = CONSUMABLE_GEAR.find((g) => g.id === selectedConsumableId);
    if (!item) return;
    sendCommand({ type: "ADD_CONSUMABLE", heroId, name: item.name, effect: item.description, quantity: 1 });
  }

  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>;
  if (error) return <div className="flex items-center justify-center h-screen text-hq-red">{error}</div>;
  if (!hero) return null;
  const heroCmdId = hero.id;

  const icon = HERO_ICONS[hero.heroTypeId] ?? "🧝";
  const spellAccess = HERO_SPELL_ACCESS[hero.heroTypeId];

  const pools = resolveEffectiveHeroDice(hero);
  const effectiveAttack = pools.attack;
  const effectiveDefend = pools.defend;
  const systems = sessionRules?.enabledSystems;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-hq-brown border-b border-hq-amber/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{icon}</span>
          <div className="flex-1">
            <h1 className="text-xl font-display text-hq-amber">{hero.name}</h1>
            <p className="text-xs text-parchment/50 capitalize">{hero.heroTypeId}</p>
          </div>
          <div className="text-right text-xs text-parchment/60 space-y-0.5">
            <button className="btn-secondary text-xs px-2 py-1 mb-1" onClick={() => sendCommand({ type: "REQUEST_SNAPSHOT" })}>
              Resync
            </button>
            <p>💰 Mine: {hero.gold}{partyGold !== null && <span className="text-parchment/40"> | Party: {partyGold}</span>}</p>
            <p>⚔️ {effectiveAttack}🎲 ATK{effectiveAttack !== hero.attackDice && <span className="text-hq-amber"> (+{effectiveAttack - hero.attackDice})</span>}</p>
            <p>🛡️ {effectiveDefend}🎲 DEF{effectiveDefend !== hero.defendDice && <span className="text-hq-amber"> (+{effectiveDefend - hero.defendDice})</span>}</p>
          </div>
        </div>

        {hero.statusFlags.isDead && (
          <div className="mt-2 text-center text-hq-red font-bold">💀 HERO IS DEAD</div>
        )}
        {hero.statusFlags.isInShock && !hero.statusFlags.isDead && (
          <div className="mt-2 text-center text-purple-400 font-bold">⚡ MIND SHOCK — 0 Mind Points</div>
        )}
        {hero.statusFlags.isDisguised && (
          <div className="mt-2 text-center text-gray-400">🎭 DISGUISED</div>
        )}
      </header>

      {/* Tab nav */}
      <nav className="bg-hq-brown/50 border-b border-hq-amber/20 flex">
        {(["stats", "inventory", "spells"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-semibold capitalize transition-colors ${
              tab === t
                ? "text-hq-amber border-b-2 border-hq-amber"
                : "text-parchment/50 hover:text-parchment"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 space-y-4 overflow-y-auto pb-20">
        {tab === "stats" && (
          <div className="space-y-4">
            <div className="card">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider mb-4">Body Points</h2>
              <StatAdjuster
                label="Body Points"
                current={hero.bodyPointsCurrent}
                max={hero.bodyPointsMax}
                color="red"
                onAdjust={(d) => adjustStat("BP", d)}
              />
            </div>
            <div className="card">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider mb-4">Mind Points</h2>
              <StatAdjuster
                label="Mind Points"
                current={hero.mindPointsCurrent}
                max={hero.mindPointsMax}
                color="blue"
                onAdjust={(d) => adjustStat("MP", d)}
              />
            </div>

            {/* Dice rolling */}
            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Roll Dice</h2>
              <p className="text-xs text-parchment/50">Effective: {effectiveAttack} attack 🎲, {effectiveDefend} defense 🎲 (includes equipment bonuses)</p>
              {pools.note && <p className="text-xs text-hq-amber">{pools.note}</p>}
              <div className="flex gap-3">
                <button
                  className="btn-primary flex-1"
                  onClick={() => rollDice("attack")}
                  disabled={effectiveAttack < 1}
                >
                  ⚔️ Attack ({effectiveAttack}🎲)
                </button>
                <button
                  className="btn-secondary flex-1"
                  onClick={() => rollDice("defense")}
                  disabled={effectiveDefend < 1}
                >
                  🛡️ Defense ({effectiveDefend}🎲)
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "inventory" && (
          <div className="space-y-4">
            {systems?.disguises && (
              <div className="card space-y-3">
                <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Disguise</h2>
                <p className="text-xs text-parchment/60">While disguised: only disguise-legal weapons, helmet/bracers armor, and no spells.</p>
                <button className="btn-secondary w-full" onClick={() => sendCommand({ type: "SET_HERO_DISGUISE", heroId: heroCmdId, isDisguised: !hero.statusFlags.isDisguised })}>
                  {hero.statusFlags.isDisguised ? "Break Disguise" : "Take Disguise Token"}
                </button>
              </div>
            )}

            {systems?.alchemy && (
              <div className="card space-y-3">
                <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Alchemy</h2>
                <p className="text-xs text-parchment/60">Reagents: {(hero.alchemy?.reagents ?? []).join(", ") || "none"}</p>
                <p className="text-xs text-parchment/60">Potions: {(hero.alchemy?.potions ?? []).join(", ") || "none"}</p>
                <p className="text-xs text-parchment/60">Reagent kit uses: {hero.alchemy?.reagentKitUsesRemaining ?? 0}</p>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder="Reagent id" value={reagentInput} onChange={(e) => setReagentInput(e.target.value)} />
                  <button className="btn-secondary" onClick={() => reagentInput && sendCommand({ type: "ADD_REAGENT", heroId: heroCmdId, reagentId: reagentInput })}>Add</button>
                </div>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder="Potion id" value={potionInput} onChange={(e) => setPotionInput(e.target.value)} />
                  <button className="btn-secondary" onClick={() => potionInput && sendCommand({ type: "CRAFT_POTION", heroId: heroCmdId, potionId: potionInput, consumeReagentIds: [], useReagentKit: false })}>Craft</button>
                </div>
                <button className="btn-secondary w-full" onClick={() => sendCommand({ type: "DRAW_RANDOM_ALCHEMY_POTION", heroId: heroCmdId })}>Draw Random Alchemy Potion</button>
              </div>
            )}

            {systems?.hideouts && (
              <div className="card space-y-3">
                <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Hideout Rest</h2>
                <p className="text-xs text-parchment/60">Once per quest per hero.</p>
                <button
                  className="btn-secondary w-full"
                  onClick={() => sendCommand({ type: "USE_HIDEOUT_REST", heroId: heroCmdId })}
                  disabled={!!hero.hideoutRestUsedThisQuest}
                >
                  {hero.hideoutRestUsedThisQuest ? "Already Used This Quest" : "Use Hideout Rest"}
                </button>
              </div>
            )}

            {systems?.undergroundMarket && (
              <div className="card space-y-3">
                <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Underground Market</h2>
                {ITEM_CATALOG.filter((i) => ["caltrops", "smoke_bomb", "reagent_kit"].includes(i.id)).map((item) => (
                  <button key={item.id} className="btn-secondary w-full" onClick={() => sendCommand({ type: "BUY_UNDERGROUND_ITEM", heroId: heroCmdId, itemId: item.id })}>
                    Buy {item.name} ({item.costGold}g)
                  </button>
                ))}
              </div>
            )}

            {systems?.reputationTokens && party && (
              <div className="card">
                <p className="text-xs text-parchment/60">Party Reputation Tokens: {party.reputationTokens}</p>
              </div>
            )}

            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Gold</h2>
              <p className="text-parchment/70 text-sm">
                You have <span className="text-hq-amber font-bold">{hero.gold}</span> 💰
                {partyGold !== null && <span className="text-parchment/40"> (Party total: {partyGold})</span>}
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="input flex-1"
                  placeholder="Amount (negative to spend)"
                  value={goldInput}
                  onChange={(e) => setGoldInput(e.target.value)}
                />
                <button className="btn-secondary" onClick={adjustGold} disabled={!goldInput}>
                  Update
                </button>
              </div>
            </div>

            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Equipment</h2>
              {Object.keys(hero.equipped ?? {}).length === 0 ? (
                <p className="text-parchment/40 text-sm">No equipment</p>
              ) : (
                <ul className="space-y-2">
                  {(Object.entries(hero.equipped ?? {}) as [EquipSlot, { instanceId: string; itemId: string }][]).map(([slot, e]) => {
                    const def = ITEM_CATALOG.find((i) => i.id === e.itemId);
                    return (
                      <li key={slot} className="flex items-center gap-2 text-sm">
                        <span className="text-parchment/40 w-24 shrink-0 text-xs">{slot}</span>
                        <span className="text-parchment flex-1">{def?.name ?? e.itemId}</span>
                        {def?.attackDiceBonus && <span className="badge bg-hq-red/30 text-hq-red">+{def.attackDiceBonus} ATK</span>}
                        {def?.defendDiceBonus && <span className="badge bg-blue-900 text-blue-300">+{def.defendDiceBonus} DEF</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Equip from armory */}
              <div className="pt-2 border-t border-parchment/10">
                <p className="text-xs text-parchment/50 mb-2">Add from Armory</p>
                <div className="flex gap-2">
                  <select
                    className="input flex-1 text-sm"
                    value={selectedGearId}
                    onChange={(e) => setSelectedGearId(e.target.value)}
                  >
                    {EQUIP_GEAR.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} — {g.description} ({g.costGold}g)
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary text-sm" onClick={equipFromCatalog}>
                    Equip
                  </button>
                </div>
              </div>
            </div>

            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Armory Inventory</h2>
              {(hero.inventory ?? []).length === 0 ? (
                <p className="text-parchment/40 text-sm">No unequipped armory items</p>
              ) : (
                <ul className="space-y-2">
                  {(hero.inventory ?? []).map((entry) => {
                    const def = ITEM_CATALOG.find((i) => i.id === entry.itemId);
                    return (
                      <li key={entry.instanceId} className="flex items-center gap-2 text-sm">
                        <span className="text-parchment flex-1">{def?.name ?? entry.itemId}</span>
                        <span className="text-parchment/40 text-xs uppercase">{def?.category ?? "item"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Artifacts</h2>
              {(hero.artifacts ?? []).length === 0 ? (
                <p className="text-parchment/40 text-sm">No artifacts</p>
              ) : (
                <ul className="space-y-2">
                  {(hero.artifacts ?? []).map((entry) => {
                    const def = ITEM_CATALOG.find((i) => i.id === entry.artifactId);
                    return (
                      <li key={entry.instanceId} className="flex items-center gap-2 text-sm">
                        <span className="text-parchment flex-1">{def?.name ?? entry.artifactId}</span>
                        <span className="text-parchment/40 text-xs">Quest reward</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Consumables</h2>
              {(hero.consumables ?? []).length === 0 ? (
                <p className="text-parchment/40 text-sm">No consumables</p>
              ) : (
                <ul className="space-y-2">
                  {(hero.consumables ?? []).map((item) => {
                    const def = ITEM_CATALOG.find((i) => i.id === item.itemId);
                    const label = item.name ?? def?.name ?? item.itemId;
                    const effectText = item.effect ?? def?.description;
                    return (
                    <li key={item.instanceId} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-parchment">
                        {label}
                        {item.quantity > 1 && (
                          <span className="text-parchment/50"> ×{item.quantity}</span>
                        )}
                      </span>
                      {effectText && (
                        <span className="text-xs text-parchment/50">{effectText}</span>
                      )}
                      <button
                        className="btn-secondary text-xs px-2 py-0.5"
                        onClick={() => useItem(item.instanceId)}
                      >
                        Use
                      </button>
                    </li>
                  )})}
                </ul>
              )}
              {/* Add consumable from catalog */}
              <div className="pt-2 border-t border-parchment/10">
                <p className="text-xs text-parchment/50 mb-2">Add from General Store</p>
                <div className="flex gap-2">
                  <select
                    className="input flex-1 text-sm"
                    value={selectedConsumableId}
                    onChange={(e) => setSelectedConsumableId(e.target.value)}
                  >
                    {CONSUMABLE_GEAR.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} — {g.description} ({g.costGold}g)
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary text-sm" onClick={addConsumableFromCatalog}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "spells" && (
          <div className="space-y-3">
            {!spellAccess ? (
              <div className="card">
                <p className="text-parchment/40 text-sm">This hero cannot cast spells</p>
              </div>
            ) : (() => {
              const wizardHero = partyHeroes.find((h) => h.heroTypeId === "wizard");
              // Only count wizard's manually-chosen elements (not auto-assigned) for blocking elf
              const wizardManualLimit = HERO_SPELL_ACCESS["wizard"]?.elementLimit ?? 2;
              const wizardChosen: string[] = (wizardHero?.spellsChosenThisQuest ?? []).slice(0, wizardManualLimit);
              const wizardDone = !wizardHero || wizardChosen.length >= wizardManualLimit;

              // Always show all 4 elements — wizard's chosen are shown but blocked for elf
              const allElements = spellAccess.elements; // all 4 for both

              // Auto-assigned = elements stored beyond the manual elementLimit
              const chosenBeyondLimit = hero.spellsChosenThisQuest.length > spellAccess.elementLimit
                ? hero.spellsChosenThisQuest.slice(spellAccess.elementLimit)
                : [];

              const phaseHint = hero.heroTypeId === "wizard"
                ? `Phase 1: Pick ${spellAccess.elementLimit} schools. Your 3rd school is auto-assigned after the Elf picks.`
                : !wizardDone
                  ? `Waiting for Wizard to finish picking (${wizardChosen.length}/${wizardManualLimit} chosen)…`
                  : `Phase 2: Pick 1 school from those not chosen by the Wizard.`;

              return (
                <>
                  <div className="card py-2 space-y-1">
                    <p className="text-xs text-parchment/60">{phaseHint}</p>
                    <p className="text-xs text-parchment/40">
                      {hero.heroTypeId === "wizard"
                        ? `${Math.min(hero.spellsChosenThisQuest.length, spellAccess.elementLimit)}/${spellAccess.elementLimit} chosen manually${chosenBeyondLimit.length > 0 ? " + 1 auto-assigned" : ""}`
                        : `${hero.spellsChosenThisQuest.filter(e => !wizardChosen.includes(e)).length}/${spellAccess.elementLimit} chosen`}
                    </p>
                  </div>

                  {allElements.map((element) => {
                    const isChosen = hero.spellsChosenThisQuest.includes(element);
                    const isAutoAssigned = chosenBeyondLimit.includes(element as SpellElement);
                    // For elf: element is blocked if wizard already claimed it
                    const isWizardClaimed = hero.heroTypeId === "elf" && wizardChosen.includes(element);
                    // For limit check: only count elf's non-conflicting choices
                    const validChoicesCount = hero.heroTypeId === "elf"
                      ? hero.spellsChosenThisQuest.filter(e => !wizardChosen.includes(e)).length
                      : hero.spellsChosenThisQuest.slice(0, spellAccess.elementLimit).length;
                    const atLimit = !isChosen && !isWizardClaimed && validChoicesCount >= spellAccess.elementLimit;
                    const isDisabled = atLimit || isAutoAssigned || isWizardClaimed;
                    const elementSpells = SPELLS.filter((s) => s.element === element);

                    return (
                      <div
                        key={element}
                        className={`card p-3 border transition-colors ${
                          isWizardClaimed
                            ? "border-parchment/10 opacity-40"
                            : isChosen
                              ? "border-hq-amber/50 bg-hq-amber/5"
                              : "border-parchment/10"
                        }`}
                      >
                        <label className={`flex items-center gap-3 ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                          <input
                            type="checkbox"
                            checked={isChosen}
                            disabled={isDisabled}
                            className="accent-hq-amber w-4 h-4 shrink-0"
                            onChange={() => toggleElement(element)}
                          />
                          <span className={`font-bold text-sm ${isChosen ? "text-hq-amber" : "text-parchment/70"}`}>
                            {ELEMENT_ICONS[element]} {ELEMENT_LABELS[element]}
                          </span>
                          {isAutoAssigned && (
                            <span className="text-xs text-parchment/40 italic">auto-assigned</span>
                          )}
                          {isWizardClaimed && (
                            <span className="text-xs text-parchment/40 italic">Wizard's</span>
                          )}
                          <span className="ml-auto text-xs text-parchment/40">{elementSpells.length} spells</span>
                        </label>

                        {isChosen && (
                          <ul className="mt-3 space-y-2 pl-7 border-t border-hq-amber/20 pt-3">
                            {elementSpells.map((spell) => (
                              <li key={spell.id}>
                                <p className="text-sm font-semibold text-parchment">{spell.name}</p>
                                <p className="text-xs text-parchment/50">{spell.description}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
      </main>

      {/* Dice roll toast */}
      {diceToast && (
        <div className="fixed bottom-4 left-4 right-4 z-50 bg-hq-brown border border-hq-amber rounded-lg px-4 py-3 shadow-lg">
          <p className="text-sm text-parchment text-center">{diceToast}</p>
        </div>
      )}
      {socketError && (
        <div className="fixed bottom-20 left-4 right-4 z-50 bg-hq-red/20 border border-hq-red rounded-lg px-4 py-3 shadow-lg">
          <p className="text-sm text-hq-red text-center">{socketError}</p>
        </div>
      )}
    </div>
  );
}
