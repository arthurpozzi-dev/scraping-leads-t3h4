import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/infrastructure/http/server.js";

function get(server, path) {
  return new Promise((resolve) => {
    const { port } = server.address();
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    });
  });
}

test("/api/scrape resolves the engine from the query param", async () => {
  const requested = [];
  const fakeEngine = { name: "cloakbrowser", supportsBrowser: true };
  const engines = {
    get(name, opts) {
      requested.push({ name, opts });
      return name === "cloakbrowser" ? fakeEngine : { name: "playwright", supportsBrowser: true };
    },
    async closeAll() {},
  };
  let scrapeEngineName = null;
  const scraper = {
    async scrape({ engine }) {
      scrapeEngineName = engine?.name;
      return [];
    },
  };
  const app = createServer({ scraper, gridScraper: null, engines });
  const server = app.listen(0);
  try {
    const body = await get(server, "/api/scrape?input=teste&engine=cloakbrowser");
    assert.ok(requested.some((r) => r.name === "cloakbrowser"), "engines.get chamado com cloakbrowser");
    assert.equal(scrapeEngineName, "cloakbrowser");
    assert.match(body, /event: done/);
  } finally {
    server.close();
  }
});

test("/api/scrape with scrapling (no live browser) falls back to playwright for the Maps scrape", async () => {
  const engines = {
    get(name) {
      if (name === "scrapling") return { name: "scrapling", supportsBrowser: false };
      return { name: "playwright", supportsBrowser: true };
    },
    async closeAll() {},
  };
  let scrapeEngineName = null;
  const scraper = { async scrape({ engine }) { scrapeEngineName = engine?.name; return []; } };
  const app = createServer({ scraper, gridScraper: null, engines });
  const server = app.listen(0);
  try {
    const body = await get(server, "/api/scrape?input=teste&engine=scrapling&scraplingMode=stealth");
    assert.equal(scrapeEngineName, "playwright"); // degrada para playwright na coleta
    assert.match(body, /scrapling/i); // avisa o usuário
  } finally {
    server.close();
  }
});
