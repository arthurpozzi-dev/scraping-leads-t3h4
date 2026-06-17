import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleMapsScraper } from "../src/infrastructure/scraper/GoogleMapsScraper.js";

test("scrape uses the injected engine.launchBrowser", async () => {
  let launchCalled = false;
  const engine = {
    name: "fake",
    supportsBrowser: true,
    async launchBrowser({ headless }) {
      launchCalled = true;
      assert.equal(headless, true);
      // browser stub whose newContext aborts navigation with a sentinel
      return {
        async newContext() { throw new Error("SENTINEL_STOP"); },
        async close() {},
      };
    },
  };
  const scraper = new GoogleMapsScraper({ headless: true });
  await assert.rejects(() => scraper.scrape({ input: "restaurantes", engine }), /SENTINEL_STOP/);
  assert.equal(launchCalled, true);
});
