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

test("contact pages are fetched in PARALLEL (capped) and all emails aggregated", async () => {
  // Engine que mede a concorrência real: se as páginas fossem em série, maxInFlight=1.
  class PageEngine {
    constructor() {
      this.name = "fake";
      this.inFlight = 0;
      this.maxInFlight = 0;
    }
    async fetchHtml(url) {
      this.inFlight++;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      await new Promise((r) => setTimeout(r, 10));
      this.inFlight--;
      if (url === "https://empresa.com" || url === "https://empresa.com/") {
        return { html: `<a href="/contato">c</a><a href="/sobre">s</a><a href="/equipe">e</a>`, status: 200, finalUrl: url };
      }
      const slug = new URL(url).pathname.replace(/\W+/g, "") || "home";
      return { html: `fale ${slug}@empresa.com`, status: 200, finalUrl: url };
    }
  }
  const engine = new PageEngine();
  const s = new EmailScraper({ engine, pageConcurrency: 2 });
  const r = await s.scrapeContacts("https://empresa.com");

  assert.ok(engine.maxInFlight >= 2, "páginas de contato deveriam rodar em paralelo");
  assert.ok(engine.maxInFlight <= 2, "não deve passar do cap pageConcurrency");
  assert.ok(r.emails.includes("contato@empresa.com"));
  assert.ok(r.emails.length >= 3, "deve agregar e-mails de várias páginas");
});

test("SiteTextScraper routes through engine.fetchHtml and extracts text+emails", async () => {
  const engine = new FakeEngine({ html: "<html><body><p>Bem-vindo</p> vendas@loja.com</body></html>" });
  const s = new SiteTextScraper({ engine });
  const r = await s.fetchText("https://loja.com");
  assert.match(r.text, /Bem-vindo/);
  assert.ok(r.emails.includes("vendas@loja.com"));
  assert.ok(engine.calls.some((c) => c.url.includes("loja.com")));
});
