import { requireToken, signToken } from "./auth.mjs";
import { HERO_BASE_STATS, QUESTS, resolveEffectiveRules } from "./data.mjs";
import {
  buildSnapshot,
  createId,
  createJoinCode,
  getCampaignById,
  getCampaignByJoinCode,
  getHeroById,
  getPartyById,
  getSessionById,
  listHeroesByCampaign,
} from "./repository.mjs";
import { executeCommand } from "./commands.mjs";
import { CampaignRealtimeHub } from "./realtime.mjs";

const APP_TITLE = "HQ Helper";

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function html(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

function error(message, status = 400, init = {}) {
  return json({ error: message }, { ...init, status });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function ensureUniqueJoinCode(db) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const joinCode = createJoinCode();
    const existing = await db.prepare("SELECT id FROM campaigns WHERE join_code = ?").bind(joinCode).first();
    if (!existing) return joinCode;
  }
  throw new Error("Failed to generate unique join code");
}

async function handleCreateCampaign(request, env) {
  const body = await readJson(request);
  const name = body?.name?.trim();
  const enabledPacks = Array.isArray(body?.enabledPacks) ? body.enabledPacks : [];

  if (!name || enabledPacks.length === 0) {
    return error("name and enabledPacks are required", 400);
  }

  const campaignId = createId("campaign");
  const partyId = createId("party");
  const joinCode = await ensureUniqueJoinCode(env.DB);
  const createdAt = new Date().toISOString();
  const questLog = QUESTS
    .filter((quest) => enabledPacks.includes(quest.packId))
    .map((quest, index) => ({
      questId: quest.id,
      status: index === 0 ? "available" : "locked",
      completedAt: null,
    }));

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO campaigns (
          id, name, join_code, enabled_packs, party_id, current_session_id, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?)`
      )
      .bind(campaignId, name, joinCode, JSON.stringify(enabledPacks), partyId, createdAt),
    env.DB
      .prepare(
        `INSERT INTO parties (
          id, campaign_id, reputation_tokens, unlocked_mercenary_types, mercenaries_json
        ) VALUES (?, ?, 0, '[]', '[]')`
      )
      .bind(partyId, campaignId),
    ...questLog.map((entry) =>
      env.DB
        .prepare(
          `INSERT INTO quest_log (campaign_id, quest_id, status, completed_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(campaignId, entry.questId, entry.status, entry.completedAt)
    ),
  ]);

  const campaign = await getCampaignById(env.DB, campaignId);
  const token = await signToken(env, { campaignId, role: "gm" });
  return json({ campaign, joinCode, token }, { status: 201 });
}

async function handleJoinCampaign(request, env) {
  const body = await readJson(request);
  const joinCode = body?.joinCode?.trim()?.toUpperCase() ?? "";

  if (!joinCode) {
    return error("joinCode is required", 400);
  }

  const campaign = await getCampaignByJoinCode(env.DB, joinCode);
  if (!campaign) {
    return error("Campaign not found", 404);
  }

  const playerId = createId("player");
  const joinedAt = new Date().toISOString();

  await env.DB
    .prepare(
      "INSERT INTO campaign_members (campaign_id, player_id, joined_at) VALUES (?, ?, ?)"
    )
    .bind(campaign.id, playerId, joinedAt)
    .run();

  const token = await signToken(env, {
    campaignId: campaign.id,
    role: "player",
    playerId,
  });

  return json({ campaign, playerId, token });
}

async function handleGetCampaign(request, url, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }
  const campaignId = url.pathname.split("/").pop();
  if (auth.payload.campaignId !== campaignId) {
    return error("Forbidden: token is not scoped to this campaign", 403);
  }
  const campaign = await getCampaignById(env.DB, campaignId);
  if (!campaign) {
    return error("Not found", 404);
  }
  return json({ campaign });
}

async function handleCreateHero(request, env) {
  const auth = await requireToken(request, env, ["player"]);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }

  const body = await readJson(request);
  const heroTypeId = body?.heroTypeId;
  const name = body?.name?.trim();
  const partyId = body?.partyId;
  const { campaignId, playerId } = auth.payload;

  if (!heroTypeId || !name) {
    return error("heroTypeId and name are required", 400);
  }
  if (!playerId) {
    return error("Token is missing playerId — re-join the campaign", 400);
  }

  const stats = HERO_BASE_STATS[heroTypeId];
  if (!stats) {
    return error("Invalid heroTypeId", 400);
  }

  const campaign = await getCampaignById(env.DB, campaignId);
  if (!campaign) {
    return error("Campaign not found", 404);
  }

  const rules = resolveEffectiveRules(campaign.enabledPacks);
  if (!rules.allowedHeroes.includes(heroTypeId)) {
    return error(`Hero type "${heroTypeId}" is not allowed in this campaign's enabled packs`, 400);
  }

  const heroCountRow = await env.DB
    .prepare("SELECT COUNT(*) AS cnt FROM heroes WHERE campaign_id = ?")
    .bind(campaignId)
    .first();
  if ((heroCountRow?.cnt ?? 0) >= rules.constraints.maxPartySize) {
    return error(
      `Party is full (max ${rules.constraints.maxPartySize} heroes)`,
      409,
    );
  }

  const existing = await env.DB
    .prepare("SELECT id FROM heroes WHERE campaign_id = ? AND hero_type_id = ?")
    .bind(campaignId, heroTypeId)
    .first();
  if (existing) {
    return error(`A ${heroTypeId} already exists in this campaign`, 409);
  }

  const now = new Date().toISOString();
  const heroId = createId("hero");
  await env.DB
    .prepare(
      `INSERT INTO heroes (
        id, campaign_id, party_id, player_id, hero_type_id, name,
        body_points_max, body_points_current, mind_points_max, mind_points_current,
        attack_dice, defend_dice, gold, equipped_json, inventory_json, consumables_json,
        artifacts_json, alchemy_json, spells_json, status_flags_json,
        hideout_rest_used_this_quest, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      heroId,
      campaignId,
      partyId ?? null,
      playerId,
      heroTypeId,
      name,
      stats.bodyPointsMax,
      stats.bodyPointsMax,
      stats.mindPointsMax,
      stats.mindPointsMax,
      stats.attackDice,
      stats.defendDice,
      JSON.stringify({}),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({ reagents: [], potions: [] }),
      JSON.stringify([]),
      JSON.stringify({
        isDead: false,
        isInShock: false,
        isDisguised: false,
        hasDisguiseToken: false,
      }),
      now,
      now,
    )
    .run();

  const hero = await getHeroById(env.DB, heroId);
  const token = await signToken(env, { campaignId, role: "player", playerId, heroId });
  return json({ hero, token }, { status: 201 });
}

async function handleClaimHero(request, url, env) {
  const auth = await requireToken(request, env, ["player"]);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }

  const heroId = url.pathname.split("/")[3];
  const { campaignId, playerId } = auth.payload;
  if (!playerId) {
    return error("Token is missing playerId — re-join the campaign", 400);
  }

  const member = await env.DB
    .prepare("SELECT player_id FROM campaign_members WHERE campaign_id = ? AND player_id = ?")
    .bind(campaignId, playerId)
    .first();
  if (!member) {
    return error("Forbidden: playerId is not a member of this campaign", 403);
  }

  const hero = await getHeroById(env.DB, heroId);
  if (!hero) {
    return error("Hero not found", 404);
  }
  if (hero.campaignId !== campaignId) {
    return error("Forbidden: hero is not in your campaign", 403);
  }
  if (hero.playerId && hero.playerId !== playerId) {
    return error("Forbidden: hero belongs to a different player", 403);
  }

  if (!hero.playerId) {
    const now = new Date().toISOString();
    await env.DB
      .prepare("UPDATE heroes SET player_id = ?, updated_at = ? WHERE id = ?")
      .bind(playerId, now, heroId)
      .run();
  }

  const freshHero = await getHeroById(env.DB, heroId);
  const token = await signToken(env, { campaignId, role: "player", playerId, heroId });
  return json({ hero: freshHero, token });
}

async function handleListCampaignHeroes(request, url, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }
  const campaignId = url.pathname.split("/").pop();
  if (auth.payload.campaignId !== campaignId) {
    return error("Forbidden: token is not scoped to this campaign", 403);
  }
  const heroes = await listHeroesByCampaign(env.DB, campaignId);
  return json({ heroes });
}

async function handleGetHero(request, url, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }
  const heroId = url.pathname.split("/").pop();
  const hero = await getHeroById(env.DB, heroId);
  if (!hero) {
    return error("Not found", 404);
  }
  if (hero.campaignId !== auth.payload.campaignId) {
    return error("Forbidden: hero is not in your campaign", 403);
  }
  return json({ hero });
}

async function handleGetParty(request, url, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }
  const partyId = url.pathname.split("/").pop();
  const party = await getPartyById(env.DB, partyId);
  if (!party) {
    return error("Not found", 404);
  }
  if (party.campaignId !== auth.payload.campaignId) {
    return error("Forbidden: party is not in your campaign", 403);
  }
  return json({ party });
}

async function handleGetSession(request, url, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }
  const sessionId = url.pathname.split("/").pop();
  const session = await getSessionById(env.DB, sessionId);
  if (!session) {
    return error("Not found", 404);
  }
  if (session.campaignId !== auth.payload.campaignId) {
    return error("Forbidden: session is not in your campaign", 403);
  }
  return json({ session });
}

function getRealtimeStub(env, campaignId) {
  const id = env.HQ_REALTIME.idFromName(campaignId);
  return env.HQ_REALTIME.get(id);
}

async function notifyRealtime(env, campaignId, message) {
  const stub = getRealtimeStub(env, campaignId);
  await stub.fetch("https://realtime.internal/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
}

async function handleRealtimeTicket(request, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }

  const ticket = crypto.randomUUID();
  const expiresAt = Date.now() + 30_000;
  const ticketData = {
    ticket,
    campaignId: auth.payload.campaignId,
    payload: auth.payload,
    expiresAt,
  };

  const stub = getRealtimeStub(env, auth.payload.campaignId);
  await stub.fetch("https://realtime.internal/store-ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ticketData),
  });

  return json({ ticket });
}

async function handleRealtimeUpgrade(request, url, env) {
  const ticket = url.searchParams.get("ticket");
  if (!ticket) {
    return error("Unauthorized: ticket required", 401);
  }

  const campaignId = url.searchParams.get("campaignId") ?? "";
  if (!campaignId) {
    return error("Unauthorized: campaignId required", 401);
  }

  const sessionId = url.searchParams.get("sessionId") ?? "";
  const clientId = crypto.randomUUID();
  const stub = getRealtimeStub(env, campaignId);
  const upstream = new Request(
    `https://realtime.internal/connect?ticket=${encodeURIComponent(ticket)}&clientId=${encodeURIComponent(clientId)}&sessionId=${encodeURIComponent(sessionId)}`,
    { headers: request.headers }
  );
  return stub.fetch(upstream);
}

async function handleRealtimeSnapshot(request, url, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }
  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  const snapshot = await buildSnapshot(env.DB, auth.payload.campaignId, sessionId);
  return json({ snapshot });
}

async function handleCommand(request, env) {
  const auth = await requireToken(request, env);
  if (auth.error) {
    return json(auth.error.body, { status: auth.error.status });
  }

  const cmd = await readJson(request);
  if (!cmd?.type) {
    return error("Command type is required", 400);
  }

  try {
    await executeCommand(cmd, {
      db: env.DB,
      payload: auth.payload,
      notify: (campaignId, message) => notifyRealtime(env, campaignId, message),
    });
    return json({ ok: true });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Command failed", 400);
  }
}

async function checkDatabase(env) {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first();
    return {
      ok: result?.ok === 1,
      detail: "D1 binding responded",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Unknown D1 error",
    };
  }
}

function renderHome(env) {
  const hostname = env.APP_HOSTNAME || "HQHelper.savvy-des.com";
  const appEnv = env.APP_ENV || "dev";
  const version = env.APP_VERSION || "bootstrap";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${APP_TITLE}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f1efe7;
        --panel: rgba(255, 252, 244, 0.88);
        --ink: #1f1d1a;
        --muted: #6f675d;
        --accent: #9f3d22;
        --accent-soft: #d98a5f;
        --line: rgba(31, 29, 26, 0.12);
        --shadow: 0 24px 60px rgba(69, 41, 18, 0.18);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top, rgba(217, 138, 95, 0.32), transparent 35%),
          linear-gradient(180deg, #f8f4e7 0%, var(--bg) 100%);
      }

      main {
        width: min(960px, calc(100% - 32px));
        margin: 0 auto;
        padding: 56px 0 72px;
      }

      .hero {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 28px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .hero-inner {
        padding: 40px 32px 24px;
        background:
          linear-gradient(135deg, rgba(159, 61, 34, 0.12), transparent 55%),
          linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.2));
      }

      .eyebrow {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(159, 61, 34, 0.08);
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1 {
        margin: 18px 0 12px;
        font-size: clamp(40px, 7vw, 76px);
        line-height: 0.95;
      }

      p {
        margin: 0;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.6;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        padding: 24px 32px 32px;
      }

      .card {
        padding: 18px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.72);
      }

      .card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
      }

      code {
        font-family: "SFMono-Regular", SFMono-Regular, ui-monospace, monospace;
        font-size: 14px;
        color: var(--ink);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }

      a.button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 999px;
        color: white;
        background: linear-gradient(135deg, var(--accent), var(--accent-soft));
        text-decoration: none;
        font-weight: 600;
      }

      a.link {
        color: var(--accent);
        text-decoration: none;
        align-self: center;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-inner">
          <span class="eyebrow">Cloudflare Workers Fork</span>
          <h1>${APP_TITLE}</h1>
          <p>
            The new Cloudflare-native deployment is now bootstrapped at <code>${hostname}</code>.
            This is the migration foundation: Terraform owns the Worker service, custom domain,
            and D1 database while the Node/Socket.IO stack is being replatformed.
          </p>
          <div class="actions">
            <a class="button" href="/api/health">API Health</a>
            <a class="link" href="/api/meta">View deployment metadata</a>
          </div>
        </div>
        <div class="grid">
          <article class="card">
            <strong>Environment</strong>
            <code>${appEnv}</code>
          </article>
          <article class="card">
            <strong>Version</strong>
            <code>${version}</code>
          </article>
          <article class="card">
            <strong>Database</strong>
            <code>D1 bound as DB</code>
          </article>
          <article class="card">
            <strong>Next</strong>
            <code>Port REST API, then realtime</code>
          </article>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

async function handleFkHealthCheck(env) {
  // Probe whether PRAGMA foreign_keys is actually enforced on this connection.
  // Try to insert a party row that references a campaign that does not exist.
  // With FK ON this must produce a constraint error; with FK OFF it silently succeeds.
  let fkEnforced = false;
  try {
    await env.DB
      .prepare(
        "INSERT INTO parties (id, campaign_id, reputation_tokens, unlocked_mercenary_types, mercenaries_json) VALUES ('__fk_probe__', '__nonexistent_campaign_fk_probe__', 0, '[]', '[]')"
      )
      .run();
    // FK is OFF — the stray row was inserted; clean it up
    await env.DB.prepare("DELETE FROM parties WHERE id = '__fk_probe__'").run();
  } catch {
    // A constraint error means FK enforcement is active
    fkEnforced = true;
  }
  return json(
    { ok: fkEnforced, fkEnforced, checkedAt: new Date().toISOString() },
    { status: fkEnforced ? 200 : 500 }
  );
}

export default {
  async fetch(request, env) {
    // Enable FK enforcement for this D1 connection.
    // SQLite's foreign_keys PRAGMA defaults to OFF and does not persist across connections.
    // D1 allocates a fresh connection per Worker invocation, so this must run every request.
    await env.DB.prepare("PRAGMA foreign_keys = ON").run();

    const url = new URL(request.url);
    if (url.pathname === "/api/realtime" && request.headers.get("upgrade") === "websocket") {
      return handleRealtimeUpgrade(request, url, env);
    }

    if (request.method === "POST" && url.pathname === "/api/realtime/ticket") {
      return handleRealtimeTicket(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/realtime/snapshot") {
      return handleRealtimeSnapshot(request, url, env);
    }

    if (request.method === "POST" && url.pathname === "/api/commands") {
      return handleCommand(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/campaigns") {
      return handleCreateCampaign(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/campaigns/join") {
      return handleJoinCampaign(request, env);
    }

    if (request.method === "GET" && /^\/api\/campaigns\/[^/]+$/.test(url.pathname)) {
      return handleGetCampaign(request, url, env);
    }

    if (request.method === "POST" && url.pathname === "/api/heroes") {
      return handleCreateHero(request, env);
    }

    if (request.method === "POST" && /^\/api\/heroes\/[^/]+\/claim$/.test(url.pathname)) {
      return handleClaimHero(request, url, env);
    }

    if (request.method === "GET" && /^\/api\/heroes\/campaign\/[^/]+$/.test(url.pathname)) {
      return handleListCampaignHeroes(request, url, env);
    }

    if (request.method === "GET" && /^\/api\/heroes\/[^/]+$/.test(url.pathname)) {
      return handleGetHero(request, url, env);
    }

    if (request.method === "GET" && /^\/api\/parties\/[^/]+$/.test(url.pathname)) {
      return handleGetParty(request, url, env);
    }

    if (request.method === "GET" && /^\/api\/sessions\/[^/]+$/.test(url.pathname)) {
      return handleGetSession(request, url, env);
    }

    if (url.pathname === "/api/health/fk") {
      return handleFkHealthCheck(env);
    }

    if (url.pathname === "/api/health") {
      const database = await checkDatabase(env);

      return json({
        ok: database.ok,
        service: "hq-helper-worker",
        environment: env.APP_ENV || "dev",
        hostname: env.APP_HOSTNAME || null,
        database,
        checkedAt: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/meta") {
      return json({
        service: "hq-helper-worker",
        environment: env.APP_ENV || "dev",
        hostname: env.APP_HOSTNAME || null,
        version: env.APP_VERSION || "bootstrap",
        migrationStage: "foundation",
        plannedMilestones: [
          "Terraform-managed Worker and custom domain",
          "D1 schema and repository layer",
          "REST API port",
          "Durable Object realtime port",
          "Frontend migration"
        ]
      });
    }

    return html(renderHome(env));
  }
};

export { CampaignRealtimeHub };
