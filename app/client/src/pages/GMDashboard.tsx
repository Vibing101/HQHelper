import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { QUESTS, MONSTER_TYPES, resolveEffectiveRules } from "@hq/shared";
import type { Campaign, Hero, Session } from "@hq/shared";
import { joinSession, onStateUpdate, sendCommand } from "../socket";
import QuestSelector from "../components/QuestSelector";
import PartyOverview from "../components/PartyOverview";
import MonsterTracker from "../components/MonsterTracker";
import RoomGrid from "../components/RoomGrid";
import ServerGate from "../components/ServerGate";

type Tab = "quest" | "party" | "monsters" | "rooms";

export default function GMDashboard() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [serverReady, setServerReady] = useState(!import.meta.env.VITE_WAKE_URL);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("quest");
  const [selectedQuestId, setSelectedQuestId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // Monster spawn form
  const [spawnType, setSpawnType] = useState(MONSTER_TYPES[0].id);
  const [spawnLabel, setSpawnLabel] = useState("");
  const [spawnRoom, setSpawnRoom] = useState("room-1");

  // Hero management state
  const [managedHeroId, setManagedHeroId] = useState<string | null>(null);
  const [goldAmount, setGoldAmount] = useState("");
  const [newEquipName, setNewEquipName] = useState("");
  const [newEquipAtk, setNewEquipAtk] = useState("");
  const [newEquipDef, setNewEquipDef] = useState("");
  const [newConsumName, setNewConsumName] = useState("");
  const [newConsumQty, setNewConsumQty] = useState("1");
  const [newConsumEffect, setNewConsumEffect] = useState("");

  const loadHeroes = useCallback(async () => {
    if (!campaignId) return;
    try {
      const res = await fetch(`/api/heroes/campaign/${campaignId}`);
      const data = await res.json();
      if (res.ok) setHeroes(data.heroes);
    } catch {
      // Hero list is non-critical; silently ignore fetch errors
    }
  }, [campaignId]);

  const loadCampaign = useCallback(async () => {
    if (!campaignId) return;
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCampaign(data.campaign);
      setJoinCode(data.campaign.joinCode);

      // Resume the existing session so the GM can reload the page without losing state
      if (data.campaign.currentSessionId) {
        const sRes = await fetch(`/api/sessions/${data.campaign.currentSessionId}`);
        const sData = await sRes.json();
        if (sRes.ok) setSession(sData.session);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!serverReady) return;
    loadCampaign();
    loadHeroes();
  }, [loadCampaign, loadHeroes, serverReady]);

  // Join the campaign socket room on mount
  useEffect(() => {
    if (!campaignId || !serverReady) return;
    joinSession({ campaignId, role: "gm" });
    const unsub = onStateUpdate((update) => {
      if (update.type === "SESSION_UPDATED") setSession(update.session);
      if (update.type === "HERO_UPDATED") {
        setHeroes((prev) => prev.map((h) => (h.id === update.hero.id ? update.hero : h)));
      }
    });
    return unsub;
  }, [campaignId]);

  // When a session becomes available (on load or after starting one), also join its socket room
  const sessionId = session?.id;
  useEffect(() => {
    if (campaignId && sessionId) {
      joinSession({ campaignId, sessionId, role: "gm" });
    }
  }, [campaignId, sessionId]);

  async function startSession() {
    if (!selectedQuestId || !campaignId) return;
    const res = await fetch(`/api/campaigns/${campaignId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questId: selectedQuestId }),
    });
    const data = await res.json();
    if (res.ok) {
      setSession(data.session);
      setActiveTab("monsters");
    } else {
      setError(data.error);
    }
  }

  async function endSession() {
    if (!session) return;
    const res = await fetch(`/api/sessions/${session.id}/end`, { method: "PATCH" });
    if (res.ok) {
      setSession(null);
      loadCampaign();
    }
  }

  function spawnMonster() {
    if (!session || !spawnLabel.trim()) return;
    const mt = MONSTER_TYPES.find((m) => m.id === spawnType);
    if (!mt) return;
    sendCommand({
      type: "SPAWN_MONSTER",
      sessionId: session.id,
      monsterTypeId: spawnType,
      label: spawnLabel.trim(),
      roomId: spawnRoom,
      bodyPointsMax: mt.bodyPointsMax,
      mindPointsCurrent: mt.mindPointsCurrent,
    });
    setSpawnLabel("");
  }

  async function markQuestCompleted(questId: string) {
    await fetch(`/api/campaigns/${campaignId}/quest-log/${questId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    loadCampaign();
  }

  // ─── Hero Management ──────────────────────────────────────────────────────────

  function updateHeroInList(updated: Hero) {
    setHeroes((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
  }

  async function awardGold() {
    if (!managedHeroId || !goldAmount) return;
    const res = await fetch(`/api/heroes/${managedHeroId}/gold`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(goldAmount) }),
    });
    const data = await res.json();
    if (res.ok) {
      updateHeroInList(data.hero);
      setGoldAmount("");
    }
  }

  async function addEquipment() {
    if (!managedHeroId || !newEquipName.trim()) return;
    const res = await fetch(`/api/heroes/${managedHeroId}/equipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newEquipName.trim(),
        attackBonus: newEquipAtk ? Number(newEquipAtk) : undefined,
        defendBonus: newEquipDef ? Number(newEquipDef) : undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      updateHeroInList(data.hero);
      setNewEquipName("");
      setNewEquipAtk("");
      setNewEquipDef("");
    }
  }

  async function removeEquipment(heroId: string, equipId: string) {
    const res = await fetch(`/api/heroes/${heroId}/equipment/${equipId}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) updateHeroInList(data.hero);
  }

  async function addConsumable() {
    if (!managedHeroId || !newConsumName.trim()) return;
    const res = await fetch(`/api/heroes/${managedHeroId}/consumables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newConsumName.trim(),
        quantity: Number(newConsumQty) || 1,
        effect: newConsumEffect.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      updateHeroInList(data.hero);
      setNewConsumName("");
      setNewConsumQty("1");
      setNewConsumEffect("");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  if (!serverReady) return <ServerGate onReady={() => setServerReady(true)} />;
  if (loading) return <div className="flex items-center justify-center h-screen text-parchment">Loading…</div>;
  if (error) return <div className="flex items-center justify-center h-screen text-hq-red">{error}</div>;
  if (!campaign) return null;

  const managedHero = heroes.find((h) => h.id === managedHeroId) ?? null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "quest", label: "Quest" },
    { id: "party", label: "Party" },
    { id: "monsters", label: "Monsters" },
    { id: "rooms", label: "Rooms" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-hq-brown border-b border-hq-amber/30 px-4 py-3 flex items-center gap-3">
        <h1 className="text-xl font-display text-hq-amber flex-1">{campaign.name}</h1>
        <span className="badge-gm">GM</span>
        <div className="text-right">
          <p className="text-xs text-parchment/50">Join Code</p>
          <p className="font-mono font-bold text-hq-amber tracking-widest">{joinCode}</p>
        </div>
      </header>

      {/* Tab nav */}
      <nav className="bg-hq-brown/50 border-b border-hq-amber/20 flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              activeTab === t.id
                ? "text-hq-amber border-b-2 border-hq-amber"
                : "text-parchment/50 hover:text-parchment"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 p-4 overflow-y-auto">
        {activeTab === "quest" && (
          <div className="space-y-4">
            <QuestSelector
              campaign={campaign}
              selectedQuestId={selectedQuestId}
              onSelectQuest={setSelectedQuestId}
            />
            {selectedQuestId && (
              <div className="card space-y-3">
                <div>
                  <p className="text-sm text-parchment/70 mb-1">Selected Quest</p>
                  <p className="font-bold text-hq-amber">
                    {QUESTS.find((q) => q.id === selectedQuestId)?.title}
                  </p>
                  {(() => {
                    const quest = QUESTS.find((q) => q.id === selectedQuestId);
                    if (!quest) return null;
                    const rules = resolveEffectiveRules(quest.packId, quest);
                    return (
                      <p className="text-xs text-parchment/50 mt-1">
                        Allowed heroes: {rules.allowedHeroes.join(", ")}
                      </p>
                    );
                  })()}
                </div>
                <button className="btn-primary w-full" onClick={startSession} disabled={!!session}>
                  {session ? "Session Running" : "Start Session"}
                </button>
                {session && (
                  <>
                    <button
                      className="btn-secondary w-full text-sm"
                      onClick={() => markQuestCompleted(selectedQuestId)}
                    >
                      Mark Quest Completed
                    </button>
                    <button
                      className="btn-danger w-full text-sm"
                      onClick={endSession}
                    >
                      End Session
                    </button>
                  </>
                )}
              </div>
            )}
            {session && !selectedQuestId && (
              <div className="card space-y-2">
                <p className="text-sm text-parchment/70">Session in progress</p>
                <button className="btn-danger w-full text-sm" onClick={endSession}>
                  End Session
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "party" && (
          <div className="space-y-4">
            <h2 className="text-lg font-display text-hq-amber">Party</h2>
            <PartyOverview heroes={heroes} isGM={true} />

            {heroes.length > 0 && (
              <div className="card space-y-4">
                <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Hero Inventory</h2>
                <select
                  className="input"
                  value={managedHeroId ?? ""}
                  onChange={(e) => setManagedHeroId(e.target.value || null)}
                >
                  <option value="">Select hero to manage…</option>
                  {heroes.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.heroTypeId})
                    </option>
                  ))}
                </select>

                {managedHero && (
                  <div className="space-y-5">
                    {/* Gold */}
                    <div>
                      <p className="text-xs text-parchment/60 mb-2 uppercase tracking-wider">
                        Gold — current: {managedHero.gold}
                      </p>
                      <div className="flex gap-2">
                        <input
                          className="input flex-1"
                          type="number"
                          placeholder="Amount (negative to deduct)"
                          value={goldAmount}
                          onChange={(e) => setGoldAmount(e.target.value)}
                        />
                        <button className="btn-secondary" onClick={awardGold} disabled={!goldAmount}>
                          Award
                        </button>
                      </div>
                    </div>

                    {/* Equipment */}
                    <div>
                      <p className="text-xs text-parchment/60 mb-2 uppercase tracking-wider">Equipment</p>
                      {managedHero.equipment.length > 0 && (
                        <ul className="space-y-1 mb-3">
                          {managedHero.equipment.map((e) => (
                            <li key={e.id} className="flex items-center gap-2 text-sm">
                              <span className="flex-1 text-parchment">
                                {e.name}
                                {e.attackBonus ? <span className="text-hq-red ml-1">+{e.attackBonus}ATK</span> : null}
                                {e.defendBonus ? <span className="text-blue-400 ml-1">+{e.defendBonus}DEF</span> : null}
                              </span>
                              <button
                                className="text-xs text-hq-red hover:underline"
                                onClick={() => removeEquipment(managedHero.id, e.id)}
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="space-y-2">
                        <input
                          className="input"
                          placeholder="Item name"
                          value={newEquipName}
                          onChange={(e) => setNewEquipName(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <input
                            className="input flex-1"
                            type="number"
                            placeholder="+ATK bonus"
                            value={newEquipAtk}
                            onChange={(e) => setNewEquipAtk(e.target.value)}
                          />
                          <input
                            className="input flex-1"
                            type="number"
                            placeholder="+DEF bonus"
                            value={newEquipDef}
                            onChange={(e) => setNewEquipDef(e.target.value)}
                          />
                        </div>
                        <button
                          className="btn-secondary w-full"
                          onClick={addEquipment}
                          disabled={!newEquipName.trim()}
                        >
                          Add Equipment
                        </button>
                      </div>
                    </div>

                    {/* Consumables */}
                    <div>
                      <p className="text-xs text-parchment/60 mb-2 uppercase tracking-wider">Consumables</p>
                      {managedHero.consumables.length > 0 && (
                        <ul className="space-y-1 mb-3">
                          {managedHero.consumables.map((c) => (
                            <li key={c.id} className="text-sm text-parchment">
                              {c.name} ×{c.quantity}
                              {c.effect ? <span className="text-parchment/50 ml-1">({c.effect})</span> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            className="input flex-1"
                            placeholder="Item name"
                            value={newConsumName}
                            onChange={(e) => setNewConsumName(e.target.value)}
                          />
                          <input
                            className="input w-20"
                            type="number"
                            placeholder="Qty"
                            value={newConsumQty}
                            onChange={(e) => setNewConsumQty(e.target.value)}
                          />
                        </div>
                        <input
                          className="input"
                          placeholder="Effect (optional)"
                          value={newConsumEffect}
                          onChange={(e) => setNewConsumEffect(e.target.value)}
                        />
                        <button
                          className="btn-secondary w-full"
                          onClick={addConsumable}
                          disabled={!newConsumName.trim()}
                        >
                          Add Consumable
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "monsters" && session && (
          <div className="space-y-4">
            {/* Spawn form */}
            <div className="card space-y-3">
              <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Spawn Monster</h2>
              <select
                className="input"
                value={spawnType}
                onChange={(e) => setSpawnType(e.target.value)}
              >
                {MONSTER_TYPES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.bodyPointsMax} BP)
                  </option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Label (e.g. Goblin A)"
                value={spawnLabel}
                onChange={(e) => setSpawnLabel(e.target.value)}
              />
              <input
                className="input"
                placeholder="Room ID (e.g. room-3)"
                value={spawnRoom}
                onChange={(e) => setSpawnRoom(e.target.value)}
              />
              <button className="btn-primary w-full" onClick={spawnMonster} disabled={!spawnLabel.trim()}>
                Spawn
              </button>
            </div>

            <MonsterTracker monsters={session.monsters} sessionId={session.id} isGM={true} />
          </div>
        )}

        {activeTab === "monsters" && !session && (
          <p className="text-center text-parchment/50 py-8">Start a session first to track monsters.</p>
        )}

        {activeTab === "rooms" && session && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-hq-amber uppercase tracking-wider">Rooms — tap to cycle state</h2>
            <RoomGrid rooms={session.rooms} sessionId={session.id} isGM={true} />
          </div>
        )}

        {activeTab === "rooms" && !session && (
          <p className="text-center text-parchment/50 py-8">Start a session first to track rooms.</p>
        )}
      </main>
    </div>
  );
}
