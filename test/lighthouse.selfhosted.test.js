import { test } from "node:test";
import assert from "node:assert/strict";
import { PageSpeedClient } from "../src/infrastructure/pagespeed/PageSpeedClient.js";
import { parseCategories, buildLhFlags } from "../lighthouse-server/lhFlags.js";

const okBody = { categories: { performance: { score: 0.5 } }, audits: {}, fetchTime: "t" };

test("round-robins across comma-separated self-hosted instances", async () => {
  const seen = [];
  const fetchImpl = async (u) => {
    seen.push(u.split("?")[0]);
    return { ok: true, status: 200, json: async () => okBody };
  };
  const c = new PageSpeedClient({ baseUrl: " http://a/run, http://b/run ,http://c/run ", fetchImpl });
  for (const url of ["a", "b", "c", "d"]) await c.analyze(`https://${url}.com`);
  assert.deepEqual(seen, ["http://a/run", "http://b/run", "http://c/run", "http://a/run"]);
});

test("a single instance is used for every request (no Google)", async () => {
  const seen = [];
  const fetchImpl = async (u) => {
    seen.push(u.split("?")[0]);
    return { ok: true, status: 200, json: async () => okBody };
  };
  const c = new PageSpeedClient({ baseUrl: "http://only/run", fetchImpl });
  await c.analyze("https://x.com");
  await c.analyze("https://y.com");
  assert.deepEqual(seen, ["http://only/run", "http://only/run"]);
});

test("parseCategories: repeated, comma, default and filtering", () => {
  assert.deepEqual(parseCategories({}), ["performance"]);
  assert.deepEqual(parseCategories({ category: "seo" }), ["seo"]);
  assert.deepEqual(parseCategories({ category: ["performance", "seo"] }), ["performance", "seo"]);
  assert.deepEqual(parseCategories({ category: "performance,seo" }), ["performance", "seo"]);
  assert.deepEqual(parseCategories({ category: ["seo", "seo"] }), ["seo"]); // dedup
  assert.deepEqual(parseCategories({ category: "bogus" }), ["performance"]); // inválida -> default
  assert.deepEqual(parseCategories({ category: "pwa" }), ["performance"]); // removida no LH 12 -> default
});

test("buildLhFlags maps strategy to form factor", () => {
  const mob = buildLhFlags({ strategy: "mobile", categories: ["performance"], port: 9222 });
  assert.equal(mob.formFactor, "mobile");
  assert.equal(mob.screenEmulation.mobile, true);
  assert.equal(mob.port, 9222);
  assert.deepEqual(mob.onlyCategories, ["performance"]);

  const desk = buildLhFlags({ strategy: "desktop", categories: ["performance", "seo"] });
  assert.equal(desk.formFactor, "desktop");
  assert.equal(desk.screenEmulation.mobile, false);
  assert.equal(desk.throttling.cpuSlowdownMultiplier, 1);
});
