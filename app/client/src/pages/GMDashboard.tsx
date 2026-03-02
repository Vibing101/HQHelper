import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { GEAR_CATALOG, ITEM_CATALOG, QUESTS, MONSTER_TYPES, resolveEffectiveRules, countHitsForHeroAttack, countBlocksForHeroDefense } from "@hq/shared";
import type { CombatDieFace, EquipSlot } from "@hq/shared";
import type { Campaign, Hero, Session } from "@hq/shared";
import { joinSession, onDiceRoll, onError, onStateUpdate, sendCommand } from "../socket";

const EQUIP_GEAR = ITEM_CATALOG.filter((g) => g.equipSlot !== undefined);
const CONSUMABLE_GEAR = GEAR_CATALOG.filter((g) => g.category === "consumable");
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
  const [socketError, setSocketError] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // Monster spawn form
  const [spawnType, setSpawnType] = useState(MONSTER_TYPES[0].id);
  const [spawnLabel, setSpawnLabel] = useState("");
  const [spawnRoom, setSpawnRoom] = useState("room-1");

  // Auto-fill label with next sequential number when monster type or session changes
  useEffect(() => {
    if (!spawnType) return;
    const count = session?.monsters.filter((m) => m.monsterTypeId === spawnType).length ?? 0;
    const mt = MONSTER_TYPES.find((m) => m.id === spawnType);
    if (mt) setSpawnLabel(`${mt.name} ${count + 1}`);
  }, [spawnType, session?.monsters]);

  // Hero management state
  const [managedHeroId, setManagedHeroId] = useState<string | null>(null);
  const [goldAmount, setGoldAmount] = useState("");
  const [newConsumName, setNewConsumName] = useState("");
  const [newConsumQty, setNewConsumQty] = useState("1");
  const [newConsumEffect, setNewConsumEffect] = useState("");

  // Gear catalog dropdowns for hero management
  const [gmGearId, setGmGearId] = useState(EQUIP_GEAR[0]?.id ?? "");
  const [gmConsumableId, setGmConsumableId] = useState(CONSUMABLE_GEAR[0]?.id ?? "");

  // Dice roll toast
  const [diceToast, setDiceToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (update.type === "HERO_CREATED") {
        setHeroes((prev) => [...prev, update.hero]);
      }
      if (update.type === "SESSION_STARTED") {
        setSession(update.session);
        setCampaign(update.campaign);
        setActiveTab("monsters");
      }
      if (update.type === "SESSION_ENDED") {
        setSession(null);
        setCampaign(update.campaign);
      }
      if (update.type === "CAMPAIGN_UPDATED") {
        setCampaign(update.campaign);
      }
    });
    return unsub;
  }, [campaignId]);

  // Dice roll toast listener
  useEffect(() => {
    const unsub = onDiceRoll((roll) => {
      const faces = roll.results as CombatDieFace[];
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

  useEffect(() => {
    const unsub = onError((err) => setSocketError(err.message));
    return unsub;
  }, []);

  // When a session becomes available (on load or after starting one), also join its socket room
  const sessionId = session?.id;
  useEffect(() => {
    if (campaignId && sessionId) {
      joinSession({ campaignId, sessionId, role: "gm" });
    }
  }, [campaignId, sessionId]);

  function startSession() {
    if (!selectedQuestId) return;
    sendCommand({ type: "START_SESSION", questId: selectedQuestId });
  }

  function endSession() {
    if (!session) return;
    sendCommand({ type: "END_SESSION", sessionId: session.id });
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

  function markQuestCompleted(questId: string) {
    sendCommand({ type: "SET_QUEST_STATUS", questId, status: "completed" });
  }

  function unlockQuest(questId: string) {
    sendCommand({ type: "SET_QUEST_STATUS", questId, status: "available" });
  }

  // ─── Hero Management ──────────────────────────────────────────────────────────

  function awardGold() {
    if (!managedHeroId || !goldAmount) return;
    sendCommand({ type: "ADD_GOLD", heroId: managedHeroId, amount: Number(goldAmount) });
    setGoldAmount("");
  }

  function removeEquipment(heroId: string, slot: EquipSlot) {
    sendCommand({ type: "UNEQUIP_ITEM", heroId, slot });
  }

  function addConsumable() {
    if (!managedHeroId || !newConsumName.trim()) return;
    sendCommand({
      type: "ADD_CONSUMABLE",
      heroId: managedHeroId,
      name: newConsumName.trim(),
      quantity: Number(newConsumQty) || 1,
      effect: newConsumEffect.trim() || undefined,
    });
    setNewConsumName("");
    setNewConsumQty("1");
    setNewConsumEffect("");
  }

  function equipFromCatalog() {
    if (!managedHeroId || !gmGearId) return;
    const item = EQUIP_GEAR.find((g) => g.id === gmGearId);
    if (!item?.equipSlot) return;
    sendCommand({ type: "EQUIP_ITEM", heroId: managedHeroId, itemId: item.id, slot: item.equipSlot as EquipSlot });
  }

  function addConsumableFromCatalog() {
    if (!managedHeroId || !gmConsumableId) return;
    const item = CONSUMABLE_GEAR.find((g) => g.id === gmConsumableId);
    if (!item) return;
    sendCommand({ type: "ADD_CONSUMABLE", heroId: managedHeroId, name: item.name, effect: item.description, quantity: 1 });
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
              isGM={true}
              onUnlockQuest={unlockQuest}
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
                    const rules = resolveEffectiveRules(campaign?.enabledPacks ?? [quest.packId], quest);
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
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-display text-hq-amber">Party</h2>
              {heroes.length > 0 && (
                <span className="text-sm text-parchment/60">
                  💰 Party gold: <span className="text-hq-amber font-bold">{heroes.reduce((s, h) => s + h.gold, 0)}</span>
                </span>
              )}
            </div>
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
                      {Object.keys(managedHero.equipped ?? {}).length > 0 && (
                        <ul className="space-y-1 mb-3">
                          {(Object.entries(managedHero.equipped ?? {}) as [EquipSlot, { instanceId: string; itemId: string }][]).map(([slot, e]) => {
                            const def = ITEM_CATALOG.find((i) => i.id === e.itemId);
                            return (
                              <li key={slot} className="flex items-center gap-2 text-sm">
                                <span className="text-parchment/40 w-24 shrink-0 text-xs">{slot}</span>
                                <span className="flex-1 text-parchment">
                                  {def?.name ?? e.itemId}
                                  {def?.attackDiceBonus ? <span className="text-hq-red ml-1">+{def.attackDiceBonus}ATK</span> : null}
                                  {def?.defendDiceBonus ? <span className="text-blue-400 ml-1">+{def.defendDiceBonus}DEF</span> : null}
                                </span>
                                <button
                                  className="text-xs text-hq-red hover:underline"
                                  onClick={() => removeEquipment(managedHero.id, slot)}
                                >
                                  Remove
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {/* Armory catalog */}
                      <div className="flex gap-2">
                        <select className="input flex-1 text-sm" value={gmGearId} onChange={(e) => setGmGearId(e.target.value)}>
                          {EQUIP_GEAR.map((g) => (
                            <option key={g.id} value={g.id}>{g.name} — {g.description}</option>
                          ))}
                        </select>
                        <button className="btn-secondary text-sm" onClick={equipFromCatalog}>Equip</button>
                      </div>
                    </div>

                    {/* Consumables */}
                    <div>
                      <p className="text-xs text-parchment/60 mb-2 uppercase tracking-wider">Consumables</p>
                      {(managedHero.consumables ?? []).length > 0 && (
                        <ul className="space-y-1 mb-3">
                          {(managedHero.consumables ?? []).map((c) => {
                            const def = ITEM_CATALOG.find((i) => i.id === c.itemId);
                            const label = c.name ?? def?.name ?? c.itemId;
                            const effect = c.effect ?? def?.description;
                            return (
                            <li key={c.instanceId} className="text-sm text-parchment">
                              {label} ×{c.quantity}
                              {effect ? <span className="text-parchment/50 ml-1">({effect})</span> : null}
                            </li>
                          );})}
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
                      {/* General Store catalog */}
                      <div className="pt-2 border-t border-parchment/10">
                        <p className="text-xs text-parchment/50 mb-1">From General Store</p>
                        <div className="flex gap-2">
                          <select className="input flex-1 text-sm" value={gmConsumableId} onChange={(e) => setGmConsumableId(e.target.value)}>
                            {CONSUMABLE_GEAR.map((g) => (
                              <option key={g.id} value={g.id}>{g.name} — {g.description}</option>
                            ))}
                          </select>
                          <button className="btn-secondary text-sm" onClick={addConsumableFromCatalog}>Add</button>
                        </div>
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
