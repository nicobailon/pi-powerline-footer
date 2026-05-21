import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface QuotaData {
  glm: { fiveHrPct: number; sevenDayPct: number } | null;
  deepseek: { balance: string } | null;
}

let cached: { timestamp: number; data: QuotaData } = { timestamp: 0, data: { glm: null, deepseek: null } };
let fetchInProgress = false;

function getZaiKey(): string | null {
  const env = process.env.ZAI_API_KEY?.trim();
  if (env) return env;
  try {
    return readFileSync(resolve(process.env.HOME ?? "~", ".config/zai_api_key"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function getDeepseekKey(): string | null {
  try {
    const raw = readFileSync(resolve(process.env.HOME ?? "~", ".pi/agent/auth.json"), "utf8");
    const auth = JSON.parse(raw);
    const entry = auth?.deepseek;
    if (typeof entry === "object" && entry?.key) return entry.key;
    if (typeof entry === "string") return entry;
  } catch { /* ignore */ }
  return process.env.DEEPSEEK_API_KEY?.trim() ?? null;
}

async function fetchGlmQuota(key: string): Promise<QuotaData["glm"]> {
  try {
    const res = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const limits: any[] = data?.data?.limits ?? [];
    const tokenLimits = limits.filter((l: any) => l.type === "TOKENS_LIMIT");
    if (tokenLimits.length === 0) return null;
    return {
      fiveHrPct: tokenLimits[0]?.percentage ?? 0,
      sevenDayPct: tokenLimits[1]?.percentage ?? 0,
    };
  } catch {
    return null;
  }
}

async function fetchDeepseekBalance(key: string): Promise<QuotaData["deepseek"]> {
  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const infos: any[] = data?.balance_infos ?? [];
    const usd = infos.find((b: any) => b.currency === "USD");
    if (!usd) return null;
    return { balance: usd.total_balance };
  } catch {
    return null;
  }
}

export async function refreshQuotas(): Promise<QuotaData> {
  if (Date.now() - cached.timestamp < CACHE_TTL_MS && !fetchInProgress) {
    return cached.data;
  }

  if (fetchInProgress) return cached.data;
  fetchInProgress = true;

  const zaiKey = getZaiKey();
  const dsKey = getDeepseekKey();

  const [glm, deepseek] = await Promise.all([
    zaiKey ? fetchGlmQuota(zaiKey) : Promise.resolve(null),
    dsKey ? fetchDeepseekBalance(dsKey) : Promise.resolve(null),
  ]);

  cached = { timestamp: Date.now(), data: { glm, deepseek } };
  fetchInProgress = false;
  return cached.data;
}

export function getQuotaData(): QuotaData {
  return cached.data;
}
