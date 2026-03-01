import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Hero } from "@hq/shared";
import { GEAR_CATALOG, HERO_SPELL_ACCESS, SPELLS } from "@hq/shared";
import { joinSession, onDiceRoll, onStateUpdate, sendCommand } from "../socket";
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

// Gear items without consumables (for the equipment dropdown)
const EQUIP_GEAR = GEAR_CATALOG.filter((g) => g.category !== "consumable");
const CONSUMABLE_GEAR = GEAR_CATALOG.filter((g) => g.category === "consumable");

export default function PlayerSheet() {
  const { heroId } = useParams<{ heroId: string }>();
  const [hero, setHero] = useState<Hero | null>(null);
  const [partyGold, setPartyGold] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"stats" | "inventory" | "spells">("stats");

  // Gear equip state
  const [selectedGearId, setSelectedGearId] = useState(EQUIP_GEAR[0]?.id ?? "");
  const [selectedConsumableId, setSelectedConsumableId] = useState(CONSUMABLE_GEAR[0]?.id ?? "");
  const [equipping, setEquipping] = useState(false);

  // Dice roll toast
  const [diceToast, setDiceToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gold adjustment
  const [goldInput, setGoldInput] = useState("");

  function fetchPartyGold() {
    const cid = sessionStorage.getItem("campaignId");
    if (!cid) return;
    fetch(`/api/heroes/campaign/${cid}`)
      .then((r) => r.json())
      .then((d) => {
        const total = (d.heroes ?? []).reduce((s: number, h: any) => s + (h.gold ?? 0), 0);
        setPartyGold(total);
      })
      .catch(() => {/* non-critical */});
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
        fetchPartyGold();
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [heroId]);

  useEffect(() => {
    const unsub = onStateUpdate((update) => {
      if (update.type === "HERO_UPDATED" && update.hero.id === heroId) {
        setHero(update.hero);
        fetchPartyGold();
      }
    });
    return unsub;
  }, [heroId]);

  useEffect(() => {
    const unsub = onDiceRoll((roll) => {
      const skulls = roll.results.filter((r) => r === "skull").length;
      const shields = roll.results.filter((r) => r === "shield").length;
      const icons = roll.results.map((r) => (r === "skull" ? (roll.rollType === "attack" ? "⚔️" : "💀") : "🛡️")).join(" ");
      const msg = `${roll.rollerName} rolled ${roll.rollType}: ${icons} — ${skulls} ${roll.rollType === "attack" ? "hit(s)" : "wound(s)"}, ${shields} block(s)`;
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

  async function adjustGold() {
    if (!heroId || !goldInput) return;
    await fetch(`/api/heroes/${heroId}/gold`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(goldInput) }),
    });
    setGoldInput("");
  }

  function toggleSpell(spellName: string) {
    if (!hero || !heroId) return;
    const access = HERO_SPELL_ACCESS[hero.heroTypeId];
    if (!access) return;
    const chosen = hero.spellsChosenThisQuest.includes(spellName);
    if (!chosen && hero.spellsChosenThisQuest.length >= access.limit) return;
    sendCommand({ type: "SELECT_SPELL", heroId, spell: spellName, chosen: !chosen });
  }

  function rollDice(rollType: "attack" | "defense") {
    if (!hero) return;
    const effectiveAttack = hero.attackDice + hero.equipment.reduce((s, e) => s + (e.attackBonus ?? 0), 0);
    const effectiveDefend = hero.defendDice + hero.equipment.reduce((s, e) => s + (e.defendBonus ?? 0), 0);
    const diceCount = rollType === "attack" ? effectiveAttack : effectiveDefend;
    // Attack die: ~50% skull. Defense die: ~33% skull.
    const skullChance = rollType === "attack" ? 0.5 : 1 / 3;
    const results: ("skull" | "shield")[] = Array.from({ length: diceCount }, () =>
      Math.random() < skullChance ? "skull" : "shield"
    );
    sendCommand({ type: "ROLL_DICE", rollType, diceCount, results, rollerName: hero.name });
  }

  async function equipFromCatalog() {
    if (!heroId || !selectedGearId) return;
    const item = EQUIP_GEAR.find((g) => g.id === selectedGearId);
    if (!item) return;
    setEquipping(true);
    try {
      await fetch(`/api/heroes/${heroId}/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, attackBonus: item.attackBonus, defendBonus: item.defendBonus }),
      });
      // Refresh hero
      const res = await fetch(`/api/heroes/${heroId}`);
      const data = await res.json();
      if (data.hero) setHero(data.hero);
    } catch {/* ignore */} finally {
      setEquipping(false);
    }
  }

  async function addConsumableFromCatalog() {
    if (!heroId || !selectedConsumableId) return;
    const item = CONSUMABLE_GEAR.find((g) => g.id === selectedConsumableId);
    if (!item) return;
    setEquipping(true);
    try {
      await fetch(`/api/heroes/${heroId}/consumables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, effect: item.description, quantity: 1 }),
      });
      const res = await fetch(`/api/heroes/${heroId}`);
      const data = await res.json();
      if (data.hero) setHero(data.hero);
    } catch {/* ignore */} finally {
      setEquipping(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>;
  if (error) return <div className="flex items-center justify-center h-screen text-hq-red">{error}</div>;
  if (!hero) return null;

  const icon = HERO_ICONS[hero.heroTypeId] ?? "🧝";
  const spellAccess = HERO_SPELL_ACCESS[hero.heroTypeId];
  const availableSpells = spellAccess
    ? SPELLS.filter((s) => spellAccess.elements.includes(s.element))
    : [];
  const spellLimit = spellAccess?.limit ?? 0;
  const spellElements = [...new Set(availableSpells.map((s) => s.element))];

  const effectiveAttack = hero.attackDice + hero.equipment.reduce((s, e) => s + (e.attackBonus ?? 0), 0);
  const effectiveDefend = hero.defendDice + hero.equipment.reduce((s, e) => s + (e.defendBonus ?? 0), 0);

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
              {hero.equipment.length === 0 ? (
                <p className="text-parchment/40 text-sm">No equipment</p>
              ) : (
                <ul className="space-y-2">
                  {hero.equipment.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-sm">
                      <span className="text-parchment flex-1">{e.name}</span>
                      {e.attackBonus && (
                        <span className="badge bg-hq-red/30 text-hq-red">+{e.attackBonus} ATK</span>
                      )}
                      {e.defendBonus && (
                        <span className="badge bg-blue-900 text-blue-300">+{e.defendBonus} DEF</span>
                      )}
                    </li>
                  ))}
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
                        {g.name} — {g.description} ({g.goldCost}g)
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary text-sm" onClick={equipFromCatalog} disabled={equipping}>
                    Equip
                  </button>
                </div>
              </div>
            </div>

            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Consumables</h2>
              {hero.consumables.length === 0 ? (
                <p className="text-parchment/40 text-sm">No consumables</p>
              ) : (
                <ul className="space-y-2">
                  {hero.consumables.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-parchment">
                        {item.name}
                        {item.quantity > 1 && (
                          <span className="text-parchment/50"> ×{item.quantity}</span>
                        )}
                      </span>
                      {item.effect && (
                        <span className="text-xs text-parchment/50">{item.effect}</span>
                      )}
                      <button
                        className="btn-secondary text-xs px-2 py-0.5"
                        onClick={() => useItem(item.id)}
                      >
                        Use
                      </button>
                    </li>
                  ))}
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
                        {g.name} — {g.description} ({g.goldCost}g)
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary text-sm" onClick={addConsumableFromCatalog} disabled={equipping}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "spells" && (
          <div className="card space-y-4">
            <div>
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Spells</h2>
              {availableSpells.length === 0 ? (
                <p className="text-parchment/40 text-sm mt-3">This hero cannot cast spells</p>
              ) : (
                <p className="text-xs text-parchment/50 mt-1">
                  Select spells for this quest ({hero.spellsChosenThisQuest.length}/{spellLimit} chosen)
                </p>
              )}
            </div>

            {spellElements.map((element) => {
              const elementSpells = availableSpells.filter((s) => s.element === element);
              return (
                <div key={element}>
                  <p className="text-xs font-bold text-parchment/60 uppercase tracking-wider mb-2">
                    {ELEMENT_ICONS[element]} {ELEMENT_LABELS[element]}
                  </p>
                  <div className="space-y-2">
                    {elementSpells.map((spell) => {
                      const chosen = hero.spellsChosenThisQuest.includes(spell.name);
                      const atLimit = !chosen && hero.spellsChosenThisQuest.length >= spellLimit;
                      return (
                        <label
                          key={spell.id}
                          className={`flex items-start gap-3 cursor-pointer ${atLimit ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={chosen}
                            disabled={atLimit}
                            className="accent-hq-amber w-4 h-4 mt-0.5 shrink-0"
                            onChange={() => toggleSpell(spell.name)}
                          />
                          <div>
                            <p className={`text-sm font-semibold ${chosen ? "text-parchment" : "text-parchment/70"}`}>
                              {spell.name}
                            </p>
                            <p className="text-xs text-parchment/50">{spell.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Dice roll toast */}
      {diceToast && (
        <div className="fixed bottom-4 left-4 right-4 z-50 bg-hq-brown border border-hq-amber rounded-lg px-4 py-3 shadow-lg">
          <p className="text-sm text-parchment text-center">{diceToast}</p>
        </div>
      )}
    </div>
  );
}
