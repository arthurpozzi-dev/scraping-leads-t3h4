// test/server.cache.test.js
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

// Extrai o id do evento SSE "done" do /api/scrape.
function idFromDone(body) {
  const m = body.match(/event: done\s*\ndata: (\{.*\})/);
  return m ? JSON.parse(m[1]).id : null;
}

test("per-job page cache is reused across the emails and socials routes", async () => {
  const calls = new Map();
  const engines = { get: () => ({ name: "playwright", supportsBrowser: true }), async closeAll() {} };
  const scraper = {
    async scrape() {
      return [
        { nome: "A", site: "https://shared.com", telefone: "1111", nota: 4.5, avaliacoes: 10 },
        { nome: "B", site: "https://shared.com", telefone: "2222", nota: 4.5, avaliacoes: 10 },
      ];
    },
  };
  const emailScraper = {
    async scrapeContacts(url) {
      calls.set(url, (calls.get(url) || 0) + 1);
      return { emails: ["a@a.com"], socials: [], pagesVisited: 1 };
    },
  };
  const app = createServer({ scraper, gridScraper: null, emailScraper, engines });
  const server = app.listen(0);
  try {
    const scrapeBody = await get(server, "/api/scrape?input=teste");
    const id = idFromDone(scrapeBody);
    assert.ok(id, "scrape returned an id");
    await get(server, `/api/emails/${id}`);
    const afterEmails = [...calls.values()].reduce((a, b) => a + b, 0);
    assert.equal(afterEmails, 1, "emails route fetched the shared site once");
    await get(server, `/api/socials/${id}`);
    const afterSocials = [...calls.values()].reduce((a, b) => a + b, 0);
    assert.equal(afterSocials, 1, "socials route reused the cached fetch");
  } finally {
    server.close();
  }
});
