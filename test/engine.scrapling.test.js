import { test } from "node:test";
import assert from "node:assert/strict";
import { ScraplingEngine } from "../src/infrastructure/engine/ScraplingEngine.js";
import { NotSupportedError } from "../src/infrastructure/engine/Engine.js";

test("scrapling fetchHtml posts to sidecar and maps the response", async () => {
  const fakeFetch = async (u, init) => {
    const body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ html: `<p>${body.mode}</p>`, status: 200, final_url: body.url }) };
  };
  const e = new ScraplingEngine({ mode: "stealth", baseUrl: "http://127.0.0.1:8765", fetchImpl: fakeFetch });
  const r = await e.fetchHtml("https://x.com");
  assert.equal(e.name, "scrapling");
  assert.equal(e.supportsBrowser, false);
  assert.match(r.html, /stealth/);
  assert.equal(r.finalUrl, "https://x.com");
  assert.equal(r.status, 200);
});

test("scrapling surfaces sidecar errors", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ html: "", status: 0, error: "boom" }) });
  const e = new ScraplingEngine({ baseUrl: "http://127.0.0.1:8765", fetchImpl: fakeFetch });
  await assert.rejects(() => e.fetchHtml("https://x.com"), /Scrapling: boom/);
});

test("scrapling launchBrowser is unsupported", async () => {
  const e = new ScraplingEngine({ baseUrl: "http://127.0.0.1:8765" });
  await assert.rejects(() => e.launchBrowser(), NotSupportedError);
});
