/* ================================================================== */
/*  allah — Rank with all spawned agents                              */
/*                                                                    */
/*  Reads agents.json, picks a random agent, ranks tokens with it.    */
/*  Rotates through agents across runs.                               */
/*                                                                    */
/*  Env:                                                              */
/*    RANK_COUNT   — tokens per agent per run (default: 3)            */
/*    RANK_TAB     — market tab (default: all)                        */
/*    COOLDOWN_MS  — delay between submissions (default: 65s)         */
/*    ALLAH_KEY    — allah's own key (ranks alongside spawned agents)  */
/* ================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PumpStudioClient } from "./client.js";
import { analyze } from "./analyzer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const RANK_COUNT = Number(process.env.RANK_COUNT) || 3;
const RANK_TAB = (process.env.RANK_TAB || "all") as "all" | "live" | "new" | "graduated";
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS) || 65_000;
const ALLAH_KEY = process.env.PUMP_STUDIO_API_KEY;
const AGENTS_FILE = path.join(ROOT, "agents.json");

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

async function rankWith(agentName: string, apiKey: string, count: number): Promise<{ submitted: number; xp: number }> {
  const client = new PumpStudioClient(apiKey);
  let submitted = 0;
  let totalXp = 0;

  const tokens = await client.getMarket(RANK_TAB, count);
  if (tokens.length === 0) {
    console.log(`  [${agentName}] no tokens found`);
    return { submitted: 0, xp: 0 };
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const label = `  [${agentName}][${i + 1}/${tokens.length}]`;

    try {
      const dp = await client.getDataPoint(token.mint);
      const result = analyze(dp);

      const submission = await client.submitAnalysis({
        mint: token.mint,
        sentiment: result.sentiment,
        score: result.score,
        summary: result.summary,
        snapshot: result.snapshot,
        quant: result.quant,
      });

      if (submission.ok) {
        submitted++;
        const xp = submission.xpEarned ?? 0;
        totalXp += xp;
        console.log(`${label} ${token.symbol} → ${result.sentiment.toUpperCase()} +${xp}XP`);
      } else {
        console.log(`${label} ${token.symbol} → ✗ ${submission.error}`);
      }
    } catch (err: any) {
      console.log(`${label} ${token.symbol} → ERR ${err.message}`);
    }

    if (i < tokens.length - 1) await sleep(COOLDOWN_MS);
  }

  return { submitted, xp: totalXp };
}

async function run() {
  console.log(`\n🕌 allah — rank-all`);
  console.log(`   tab: ${RANK_TAB} | count/agent: ${RANK_COUNT} | cooldown: ${COOLDOWN_MS / 1000}s\n`);

  const agents = loadAgents();
  const keys: Array<{ name: string; key: string }> = [];

  /* Add allah's own key if available */
  if (ALLAH_KEY) {
    keys.push({ name: "allah", key: ALLAH_KEY });
  }

  /* Add all spawned agents */
  for (const a of agents) {
    keys.push({ name: a.name, key: a.key });
  }

  if (keys.length === 0) {
    console.log("  no agents found (set PUMP_STUDIO_API_KEY or run spawn first)\n");
    return;
  }

  console.log(`  ${keys.length} agents loaded\n`);

  let totalSubmitted = 0;
  let totalXp = 0;

  for (let i = 0; i < keys.length; i++) {
    const agent = keys[i]!;
    console.log(`→ [${i + 1}/${keys.length}] ${agent.name}`);

    const result = await rankWith(agent.name, agent.key, RANK_COUNT);
    totalSubmitted += result.submitted;
    totalXp += result.xp;

    console.log(`  [${agent.name}] ${result.submitted} submitted, +${result.xp} XP\n`);

    if (i < keys.length - 1) await sleep(5_000);
  }

  console.log(`${"═".repeat(50)}`);
  console.log(`  TOTAL: ${totalSubmitted} submissions, +${totalXp} XP`);
  console.log(`  AGENTS: ${keys.length}`);
  console.log(`${"═".repeat(50)}\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
