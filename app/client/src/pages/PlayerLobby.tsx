import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { HERO_BASE_STATS, resolveEffectiveRules, QUESTS, PACKS } from "@hq/shared";
import type { Campaign, HeroTypeId } from "@hq/shared";
import { joinSession } from "../socket";

const HERO_ICONS: Record<string, string> = {
  barbarian: "⚔️",
  dwarf: "🪓",
  elf: "🏹",
  wizard: "🧙",
  knight: "🛡️",
};

const HERO_DESCRIPTIONS: Record<string, string> = {
  barbarian: "Mighty warrior — 8 BP, hits hard",
  dwarf: "Tough and steady — 7 BP, 3 MP",
  elf: "Balanced fighter with magic — 6 BP, 4 MP",
  wizard: "Powerful spellcaster — 4 BP, 6 MP",
  knight: "Armoured defender — 7 BP, high defence",
};

export default function PlayerLobby() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Hero selection
  const [selectedHero, setSelectedHero] = useState<HeroTypeId | null>(null);
  const [heroName, setHeroName] = useState("");
  const [creating, setCreating] = useState(false);

  // Derive playerId from sessionStorage (or generate one)
  const playerId = (() => {
    let id = sessionStorage.getItem("playerId");
    if (!id) {
      id = `player-${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem("playerId", id);
    }
    return id;
  })();

  useEffect(() => {
    if (!code) return;
    fetch(`/api/campaigns/join/${code}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCampaign(data.campaign);
        sessionStorage.setItem("campaignId", data.campaign.id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [code]);

  // Compute allowed heroes from the most recent active quest (if any)
  // For lobby, we show all heroes allowed by the campaign's enabled packs
  function getAllowedHeroes(): HeroTypeId[] {
    if (!campaign) return [];
    // Check if there's an available quest to derive rules from
    const availableQuestId = campaign.questLog.find((q) => q.status === "available")?.questId;
    const quest = availableQuestId ? QUESTS.find((q) => q.id === availableQuestId) : undefined;
    if (quest) {
      return resolveEffectiveRules(quest.packId, quest).allowedHeroes;
    }
    // Fallback: union of all pack allowed heroes
    const allHeroes = new Set<HeroTypeId>();
    campaign.enabledPacks.forEach((packId) => {
      PACKS[packId].allowedHeroes.forEach((h) => allHeroes.add(h));
    });
    return Array.from(allHeroes);
  }

  async function createHero() {
    if (!selectedHero || !heroName.trim() || !campaign) return;
    setCreating(true);
    try {
      const res = await fetch("/api/heroes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heroTypeId: selectedHero,
          name: heroName.trim(),
          playerId,
          campaignId: campaign.id,
          partyId: campaign.partyId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      await joinSession({ campaignId: campaign.id, role: "player", playerId });
      sessionStorage.setItem("heroId", data.hero.id);
      navigate(`/hero/${data.hero.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>;
  if (error) return <div className="flex items-center justify-center h-screen text-hq-red">{error}</div>;
  if (!campaign) return null;

  const allowedHeroes = getAllowedHeroes();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-hq-brown border-b border-hq-amber/30 px-4 py-3">
        <h1 className="text-xl font-display text-hq-amber">{campaign.name}</h1>
        <p className="text-xs text-parchment/50">Choose your hero</p>
      </header>

      <main className="flex-1 p-4 space-y-5 overflow-y-auto">
        <p className="text-sm text-parchment/60">
          Available heroes for this quest:
        </p>

        <div className="grid grid-cols-1 gap-3">
          {allowedHeroes.map((heroTypeId) => {
            const stats = HERO_BASE_STATS[heroTypeId];
            const isSelected = selectedHero === heroTypeId;
            return (
              <button
                key={heroTypeId}
                onClick={() => setSelectedHero(heroTypeId)}
                className={`card text-left transition-all ${
                  isSelected ? "border-hq-amber ring-2 ring-hq-amber" : "hover:border-hq-amber/60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{HERO_ICONS[heroTypeId]}</span>
                  <div className="flex-1">
                    <p className="font-bold text-parchment capitalize">{heroTypeId}</p>
                    <p className="text-xs text-parchment/60">{HERO_DESCRIPTIONS[heroTypeId]}</p>
                    <div className="flex gap-3 mt-1 text-xs text-parchment/50">
                      <span>❤️ {stats.bodyPointsMax} BP</span>
                      <span>🧠 {stats.mindPointsMax} MP</span>
                      <span>⚔️ {stats.attackDice}🎲 ATK</span>
                      <span>🛡️ {stats.defendDice}🎲 DEF</span>
                    </div>
                  </div>
                  {isSelected && <span className="text-hq-amber text-xl">✓</span>}
                </div>
              </button>
            );
          })}
        </div>

        {selectedHero && (
          <div className="card space-y-3">
            <h2 className="text-sm font-bold text-hq-amber uppercase">Name your hero</h2>
            <input
              className="input"
              placeholder={`e.g. Grond the ${selectedHero}`}
              value={heroName}
              onChange={(e) => setHeroName(e.target.value)}
            />
            <button
              className="btn-primary w-full"
              onClick={createHero}
              disabled={creating || !heroName.trim()}
            >
              {creating ? "Entering dungeon…" : `Play as ${heroName || selectedHero}`}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
