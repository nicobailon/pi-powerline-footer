import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getAgentPath } from "./paths.ts";

export const SUPPORTED_COST_CURRENCIES = ["USD", "CNY", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "INR", "KRW"] as const;
export type CostCurrencyCode = typeof SUPPORTED_COST_CURRENCIES[number];

const CURRENCY_SYMBOLS: Record<CostCurrencyCode, string> = {
  USD: "$",
  CNY: "¥",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CAD: "CA$",
  AUD: "A$",
  CHF: "CHF ",
  INR: "₹",
  KRW: "₩",
};

const RATE_TTL_MS = 24 * 60 * 60 * 1000;
// Tried in order. jsDelivr and pages.dev are the two hosts the currency-api README lists;
// the last one serves the same JSON shape (ECB rates, allratestoday.com).
const RATE_URLS = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
  "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
  "https://allratestoday.com/api/compat/currency-api/latest/v1/currencies/usd.min.json",
];
const RATE_CACHE_PATH = getAgentPath("powerline-footer", "currency-rates.json");

type RateTable = Partial<Record<CostCurrencyCode, number>>;

interface CachedRates {
  timestamp: number;
  rates: RateTable;
}

let cachedRates: CachedRates | null = null;
let pendingFetch: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeCostCurrency(value: unknown): CostCurrencyCode | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return (SUPPORTED_COST_CURRENCIES as readonly string[]).includes(code) ? code as CostCurrencyCode : undefined;
}

function parseCachedRates(value: unknown): CachedRates | null {
  if (!isRecord(value) || typeof value.timestamp !== "number" || !isRecord(value.rates)) return null;

  const rates: RateTable = { USD: 1 };
  for (const currency of SUPPORTED_COST_CURRENCIES) {
    const rate = value.rates[currency.toLowerCase()] ?? value.rates[currency];
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      rates[currency] = rate;
    }
  }

  return { timestamp: value.timestamp, rates };
}

async function readCachedRatesFromDisk(): Promise<CachedRates | null> {
  try {
    return parseCachedRates(JSON.parse(await readFile(RATE_CACHE_PATH, "utf8")));
  } catch {
    return null;
  }
}

async function writeCachedRatesToDisk(rates: CachedRates): Promise<void> {
  try {
    await mkdir(dirname(RATE_CACHE_PATH), { recursive: true });
    await writeFile(RATE_CACHE_PATH, JSON.stringify(rates));
  } catch {
    // The footer can still use in-memory rates when the cache file is unavailable.
  }
}

async function fetchRatesFrom(url: string): Promise<CachedRates> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`currency rate fetch failed with HTTP ${response.status}`);

  const body = await response.json();
  if (!isRecord(body) || !isRecord(body.usd)) throw new Error("currency rate response did not include USD rates");

  const rates: RateTable = { USD: 1 };
  for (const currency of SUPPORTED_COST_CURRENCIES) {
    if (currency === "USD") continue;
    const rate = body.usd[currency.toLowerCase()];
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      rates[currency] = rate;
    }
  }

  return { timestamp: Date.now(), rates };
}

async function fetchLatestRates(): Promise<CachedRates> {
  let lastError: unknown;
  for (const url of RATE_URLS) {
    try {
      return await fetchRatesFrom(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function ensureRatesRefreshing(now: number): void {
  if (pendingFetch) return;
  if (cachedRates && now - cachedRates.timestamp < RATE_TTL_MS) return;

  pendingFetch = (async () => {
    if (!cachedRates) cachedRates = await readCachedRatesFromDisk();
    if (cachedRates && Date.now() - cachedRates.timestamp < RATE_TTL_MS) return;
    if (typeof fetch !== "function") return;

    try {
      const rates = await fetchLatestRates();
      cachedRates = rates;
      void writeCachedRatesToDisk(rates);
    } catch {
      if (!cachedRates) cachedRates = await readCachedRatesFromDisk();
    }
  })().finally(() => {
    pendingFetch = null;
  });
}

function getRate(currency: CostCurrencyCode): number | null {
  if (currency === "USD") return 1;

  const rate = cachedRates?.rates[currency];
  ensureRatesRefreshing(Date.now());

  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function formatUsdCost(amountUsd: number, currency: CostCurrencyCode = "USD"): string | null {
  const rate = getRate(currency);
  if (!rate) return `-- ${currency}`;

  const amount = amountUsd * rate;
  const decimals = currency === "JPY" || currency === "KRW" ? 0 : 2;
  return `${CURRENCY_SYMBOLS[currency]}${amount.toFixed(decimals)}`;
}

export function __setCurrencyRatesForTest(rates: RateTable, timestamp = Date.now()): void {
  cachedRates = { timestamp, rates: { USD: 1, ...rates } };
  pendingFetch = null;
}

export function __resetCurrencyRatesForTest(): void {
  cachedRates = null;
  pendingFetch = null;
}
