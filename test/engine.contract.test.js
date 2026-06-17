import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeEngine } from "./helpers/FakeEngine.js";
import { NotSupportedError } from "../src/infrastructure/engine/Engine.js";

test("fetchHtml returns contract shape and records the call", async () => {
  const e = new FakeEngine({ html: "<p>hi</p>", status: 200 });
  const r = await e.fetchHtml("https://x.com", { timeoutMs: 1000 });
  assert.equal(r.html, "<p>hi</p>");
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, "https://x.com");
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].url, "https://x.com");
});

test("launchBrowser throws NotSupportedError when unsupported", async () => {
  const e = new FakeEngine({ supportsBrowser: false });
  await assert.rejects(() => e.launchBrowser(), NotSupportedError);
});

test("launchBrowser returns a closeable browser when supported", async () => {
  const e = new FakeEngine({ supportsBrowser: true });
  const b = await e.launchBrowser();
  await b.close();
  assert.equal(b.closed, true);
});
