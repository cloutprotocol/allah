/* ================================================================== */
/*  allah — Agent spawner                                             */
/*                                                                    */
/*  Discovers obscure tokens, registers new agents using their        */
/*  names + images, saves keys, and optionally ranks immediately.     */
/*                                                                    */
/*  Env:                                                              */
/*    SPAWN_COUNT  — agents to spawn (default: 5)                     */
/*    SPAWN_TAB    — market tab (default: all)                        */
/*    SPAWN_OFFSET — skip top N tokens for obscurity (default: 30)    */
/* ================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const API_BASE = process.env.PUMP_API_BASE || "https://api.pump.studio";
const SPAWN_COUNT = Number(process.env.SPAWN_COUNT) || 5;
const SPAWN_TAB = process.env.SPAWN_TAB || "all";
const SPAWN_OFFSET = Number(process.env.SPAWN_OFFSET) || 30;
const AGENTS_FILE = path.join(ROOT, "agents.json");

interface MarketToken {
  mint: string;
  name: string;
  symbol: string;
  image_uri?: string;
  usd_market_cap?: number;
}

interface AgentRecord {
  name: string;
  symbol: string;
  mint: string;
  key: string;
  avatarUrl: string | null;
  registeredAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadAgents(): AgentRecord[] {
  try {
    return JSON.parse(fs.readFileSync(AGENTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveAgents(agents: AgentRecord[]) {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

async function fetchMarket(tab: string, limit: number): Promise<MarketToken[]> {
  const res = await fetch(`${API_BASE}/api/v1/market?tab=${tab}&limit=${limit}&format=json`);
  if (!res.ok) throw new Error(`Market fetch failed: ${res.status}`);
  const json = await res.json() as any;
  return json.data ?? [];
}

async function registerAgent(name: string): Promise<{ key: string } | null> {
  const res = await fetch(`${API_BASE}/api/v1/keys/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const json = await res.json() as any;
  if (!json.ok) {
    console.log(`    REG FAIL: ${json.error ?? JSON.stringify(json)}`);
    return null;
  }
  return { key: json.data.key };
}

async function setProfile(key: string, name: string, description: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/v1/agent/profile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description }),
  });
  const json = await res.json() as any;
  return json.ok === true;
}

async function setAvatar(key: string, imageUrl: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/agent/avatar`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: imageUrl }),
  });
  const json = await res.json() as any;
  return json.ok ? (json.url ?? imageUrl) : null;
}

async function run() {
  console.log(`\n🕌 allah — agent spawner`);
  console.log(`   count: ${SPAWN_COUNT} | tab: ${SPAWN_TAB} | offset: ${SPAWN_OFFSET}\n`);

  /* Load existing agents to avoid duplicates */
  const existing = loadAgents();
  const existingMints = new Set(existing.map((a) => a.mint));
  const existingNames = new Set(existing.map((a) => a.name.toLowerCase()));
  console.log(`  ${existing.length} existing agents loaded\n`);

  /* Fetch tokens — grab extra to filter */
  const fetchLimit = SPAWN_OFFSET + SPAWN_COUNT * 3;
  console.log(`→ DISCOVER  fetching ${fetchLimit} tokens from "${SPAWN_TAB}"...`);
  const allTokens = await fetchMarket(SPAWN_TAB, fetchLimit);

  /* Skip top tokens, filter out already-registered and ones without images */
  const candidates = allTokens
    .slice(SPAWN_OFFSET)
    .filter((t) => !existingMints.has(t.mint))
    .filter((t) => !existingNames.has(t.name.toLowerCase()))
    .filter((t) => t.image_uri && t.image_uri.startsWith("http"))
    .slice(0, SPAWN_COUNT);

  if (candidates.length === 0) {
    console.log("  no suitable candidates found\n");
    return;
  }

  console.log(`  found ${candidates.length} candidates\n`);

  let spawned = 0;

  for (let i = 0; i < candidates.length; i++) {
    const token = candidates[i]!;
    const label = `[${i + 1}/${candidates.length}]`;

    console.log(`${label} ─── ${token.name} (${token.symbol}) ───`);

    /* 1. Register */
    console.log(`${label} REGISTER  ${token.name}...`);
    const reg = await registerAgent(token.name);
    if (!reg) {
      console.log(`${label} SKIP\n`);
      await sleep(2_000);
      continue;
    }
    console.log(`${label} KEY       ${reg.key.slice(0, 12)}...`);

    /* 2. Set profile */
    const desc = `Autonomous quant agent tracking $${token.symbol} on Solana`;
    const profileOk = await setProfile(reg.key, token.name, desc);
    console.log(`${label} PROFILE   ${profileOk ? "✓" : "✗"}`);

    /* 3. Set avatar from token image */
    let avatarUrl: string | null = null;
    if (token.image_uri) {
      avatarUrl = await setAvatar(reg.key, token.image_uri);
      console.log(`${label} AVATAR    ${avatarUrl ? "✓" : "✗"}`);
    }

    /* 4. Save */
    existing.push({
      name: token.name,
      symbol: token.symbol,
      mint: token.mint,
      key: reg.key,
      avatarUrl,
      registeredAt: new Date().toISOString(),
    });
    saveAgents(existing);
    spawned++;

    console.log("");
    if (i < candidates.length - 1) await sleep(3_000);
  }

  console.log(`${"═".repeat(50)}`);
  console.log(`  SPAWNED: ${spawned} new agents`);
  console.log(`  TOTAL:   ${existing.length} agents in agents.json`);
  console.log(`${"═".repeat(50)}\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
