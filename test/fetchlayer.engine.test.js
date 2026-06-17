import { test } from "node:test";
import assert from "node:assert/strict";
import { EmailScraper } from "../src/infrastructure/scraper/EmailScraper.js";
import { SiteTextScraper } from "../src/infrastructure/scraper/SiteTextScraper.js";
import { FakeEngine } from "./helpers/FakeEngine.js";

test("EmailScraper routes through engine.fetchHtml and extracts emails", async () => {
  const engine = new FakeEngine({ html: "<html><body>Fale: contato@empresa.com</body></html>" });
  const s = new EmailScraper({ engine, maxPages: 0, retries: 0 });
  const r = await s.scrapeContacts("https://empresa.com");
  assert.ok(r.emails.includes("contato@empresa.com"));
  assert.ok(engine.calls.some((c) => c.url.includes("empresa.com")));
});

test("SiteTextScraper routes through engine.fetchHtml and extracts text+emails", async () => {
  const engine = new FakeEngine({ html: "<html><body><p>Bem-vindo</p> vendas@loja.com</body></html>" });
  const s = new SiteTextScraper({ engine });
  const r = await s.fetchText("https://loja.com");
  assert.match(r.text, /Bem-vindo/);
  assert.ok(r.emails.includes("vendas@loja.com"));
  assert.ok(engine.calls.some((c) => c.url.includes("loja.com")));
});
