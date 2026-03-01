import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Hero } from "@hq/shared";
import { onStateUpdate, sendCommand } from "../socket";
import StatAdjuster from "../components/StatAdjuster";

const HERO_ICONS: Record<string, string> = {
  barbarian: "⚔️",
  dwarf: "🪓",
  elf: "🏹",
  wizard: "🧙",
  knight: "🛡️",
};

// Spell lists (paraphrased, no copyrighted text)
const HERO_SPELLS: Partial<Record<string, string[]>> = {
  wizard: ["Ball of Flame", "Veil of Mist", "Swift Wind", "Rock Skin", "Courage", "Tempest", "Lightning Bolt", "Rust", "Genie", "Pass Through Rock"],
  elf: ["Veil of Mist", "Swift Wind", "Courage"],
};

const SPELL_LIMITS: Partial<Record<string, number>> = { wizard: 4, elf: 2 };

export default function PlayerSheet() {
  const { heroId } = useParams<{ heroId: string }>();
  const [hero, setHero] = useState<Hero | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"stats" | "inventory" | "spells">("stats");

  useEffect(() => {
    if (!heroId) return;
    fetch(`/api/heroes/${heroId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setHero(data.hero);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [heroId]);

  useEffect(() => {
    const unsub = onStateUpdate((update) => {
      if (update.type === "HERO_UPDATED" && update.hero.id === heroId) {
        setHero(update.hero);
      }
    });
    return unsub;
  }, [heroId]);

  function adjustStat(pool: "BP" | "MP", delta: number) {
    if (!heroId) return;
    sendCommand({ type: "ADJUST_POINTS", entityType: "hero", entityId: heroId, pool, delta });
  }

  function useItem(itemId: string) {
    if (!heroId) return;
    sendCommand({ type: "USE_ITEM", heroId, itemId });
  }

  function toggleSpell(spell: string) {
    if (!hero || !heroId) return;
    const limit = SPELL_LIMITS[hero.heroTypeId] ?? 0;
    const chosen = hero.spellsChosenThisQuest.includes(spell);
    // Prevent selecting beyond the limit on the client before the server rejects it
    if (!chosen && hero.spellsChosenThisQuest.length >= limit) return;
    sendCommand({ type: "SELECT_SPELL", heroId, spell, chosen: !chosen });
  }

  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>;
  if (error) return <div className="flex items-center justify-center h-screen text-hq-red">{error}</div>;
  if (!hero) return null;

  const icon = HERO_ICONS[hero.heroTypeId] ?? "🧝";
  const spells = HERO_SPELLS[hero.heroTypeId] ?? [];
  const spellLimit = SPELL_LIMITS[hero.heroTypeId] ?? 0;

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
          <div className="text-right text-xs text-parchment/60">
            <p>💰 {hero.gold} gold</p>
            <p>⚔️ {hero.attackDice}🎲 | 🛡️ {hero.defendDice}🎲</p>
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

      <main className="flex-1 p-4 space-y-4 overflow-y-auto">
        {tab === "stats" && (
          <div className="space-y-6">
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
          </div>
        )}

        {tab === "inventory" && (
          <div className="space-y-4">
            <div className="card">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider mb-3">Equipment</h2>
              {hero.equipment.length === 0 ? (
                <p className="text-parchment/40 text-sm">No equipment</p>
              ) : (
                <ul className="space-y-2">
                  {hero.equipment.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-sm">
                      <span className="text-parchment">{e.name}</span>
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
            </div>

            <div className="card">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider mb-3">Consumables</h2>
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
            </div>
          </div>
        )}

        {tab === "spells" && (
          <div className="card">
            <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider mb-3">
              Available Spells
            </h2>
            {spells.length === 0 ? (
              <p className="text-parchment/40 text-sm">This hero cannot cast spells</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-parchment/50 mb-3">
                  Select spells for this quest ({hero.spellsChosenThisQuest.length}/{spellLimit} chosen)
                </p>
                {spells.map((spell) => {
                  const chosen = hero.spellsChosenThisQuest.includes(spell);
                  const atLimit = !chosen && hero.spellsChosenThisQuest.length >= spellLimit;
                  return (
                    <label
                      key={spell}
                      className={`flex items-center gap-3 cursor-pointer ${atLimit ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={chosen}
                        disabled={atLimit}
                        className="accent-hq-amber w-4 h-4"
                        onChange={() => toggleSpell(spell)}
                      />
                      <span className={`text-sm ${chosen ? "text-parchment" : "text-parchment/60"}`}>
                        {spell}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
