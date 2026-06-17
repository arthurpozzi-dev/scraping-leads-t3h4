// test/enrich.cache.socials.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichSocials } from "../src/application/enrichSocials.js";
import { createJobCache } from "../src/application/jobCache.js";

test("searchCache runs identical web searches once across leads", async () => {
  let searches = 0;
  const socialSearchScraper = {
    async search() { searches++; return ["https://instagram.com/foo"]; },
  };
  const cache = createJobCache();
  const semSite = [
    { nome: "Bar do Zé", cidade: "Campinas", estado: "SP", redes_sociais: "" },
    { nome: "Bar do Zé", cidade: "Campinas", estado: "SP", redes_sociais: "" },
  ];
  const out = await enrichSocials(
    { comSite: [], semSite },
    { socialSearchScraper },
    undefined,
    { searchCache: cache.search }
  );
  assert.equal(searches, 1);       // one DDG search for the identical query
  assert.equal(out.viaBusca, 2);   // both leads still receive the profile
});

test("pageCache fetches a shared site once in the site phase", async () => {
  const calls = new Map();
  const emailScraper = {
    async scrapeContacts(url) {
      calls.set(url, (calls.get(url) || 0) + 1);
      return { socials: ["https://instagram.com/foo"] };
    },
  };
  const cache = createJobCache();
  const comSite = [
    { nome: "A", site: "https://shared.com", redes_sociais: "" },
    { nome: "B", site: "https://shared.com", redes_sociais: "" },
  ];
  const out = await enrichSocials({ comSite, semSite: [] }, { emailScraper }, undefined, { pageCache: cache.page });
  assert.equal([...calls.values()].reduce((a, b) => a + b, 0), 1);
  assert.equal(out.ok, 2);
});
