import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "powerline-currency-rates-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;

const { formatUsdCost, __resetCurrencyRatesForTest } = await import("../currency-rates.ts");

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(root, { recursive: true, force: true });
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("currency rates try every source in order when they fail", async (t) => {
  __resetCurrencyRatesForTest();
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requested.push(String(url));
    return new Response("", { status: 503 });
  });

  assert.equal(formatUsdCost(1, "EUR"), "-- EUR");
  await waitFor(() => requested.length === 3);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(requested, [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
    "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
    "https://allratestoday.com/api/compat/currency-api/latest/v1/currencies/usd.min.json",
  ]);
  __resetCurrencyRatesForTest();
});

test("currency rates fall back to the next source when one fails", async (t) => {
  __resetCurrencyRatesForTest();
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requested.push(new URL(String(url)).hostname);
    if (requested.length < 3) return new Response("", { status: 404 });
    return Response.json({ date: "2026-10-30", usd: { eur: 0.9, cny: 7.2 } });
  });

  assert.equal(formatUsdCost(1, "EUR"), "-- EUR");
  await waitFor(() => formatUsdCost(1, "EUR") !== "-- EUR");

  assert.deepEqual(requested, ["cdn.jsdelivr.net", "latest.currency-api.pages.dev", "allratestoday.com"]);
  assert.equal(formatUsdCost(1, "EUR"), "€0.90");
  assert.equal(formatUsdCost(2, "CNY"), "¥14.40");
  __resetCurrencyRatesForTest();
});
