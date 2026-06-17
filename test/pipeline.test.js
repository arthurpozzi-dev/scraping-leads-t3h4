/**
 * Testes das funções puras do pipeline (sem rede/browser).
 * Roda com: npm test  (usa o test runner nativo do Node).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanLeads } from "../src/application/CleanLeads.js";
import { dedupeAcrossBuscas } from "../src/application/dedupeAcrossBuscas.js";
import { filterLeads } from "../src/application/FilterLeads.js";
import { splitLeads } from "../src/application/SplitLeads.js";
import { enrichLeads } from "../src/application/EnrichLeads.js";
import { toWhatsAppLink, parseReviews, parseRating, parseAddress } from "../src/domain/Lead.js";
import { isSocialOrAggregator, classifyCwv, socialPlatform, normalizeSocialUrl, mergeSocialLinks, socialNameMatch, socialConfidence, recordSocialSources, evaluateSocials } from "../src/domain/classification.js";
import { detectErrorPage } from "../src/infrastructure/scraper/SiteHealthChecker.js";
import { extractEmails, decodeCloudflareEmails, isJunkEmail, normalizeEmail, extractSocials } from "../src/infrastructure/scraper/SiteTextScraper.js";
import { findContactLinks, urlVariants } from "../src/infrastructure/scraper/EmailScraper.js";
import { parseDuckResults, buildQueryTerms } from "../src/infrastructure/scraper/SocialSearchScraper.js";
import { columnsFor } from "../src/infrastructure/export/columns.js";

test("parse de nota e avaliações em PT-BR", () => {
  assert.equal(parseRating("4,7"), 4.7);
  assert.equal(parseReviews("(1.234)"), 1234);
  assert.equal(parseReviews("98 avaliações"), 98);
});

test("parseAddress: separa endereço pt-BR em componentes", () => {
  const a = parseAddress("Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200");
  assert.equal(a.logradouro, "Av. Paulista");
  assert.equal(a.numero, "1578");
  assert.equal(a.bairro, "Bela Vista");
  assert.equal(a.cidade, "São Paulo");
  assert.equal(a.estado, "SP");
  assert.equal(a.cep, "01310-200");
  assert.equal(a.pais, "Brasil"); // UF brasileira => país inferido

  // Com país explícito e número em segmento próprio.
  const b = parseAddress("R. Sete, 45, Centro, São Carlos - SP, 13560-000, Brasil");
  assert.equal(b.numero, "45");
  assert.equal(b.bairro, "Centro");
  assert.equal(b.cidade, "São Carlos");
  assert.equal(b.pais, "Brasil");

  // Endereço vazio => tudo em branco, sem quebrar.
  assert.equal(parseAddress("").endereco, "");
  assert.equal(parseAddress("").cidade, "");
});

test("normalizeEmail: remove %20/espaços e lixo nas pontas", () => {
  assert.equal(normalizeEmail("%20ziva@gmail.com"), "ziva@gmail.com");
  assert.equal(normalizeEmail("  Contato@Empresa.com  "), "contato@empresa.com");
  // E o e-mail "com %20" deduplica com o real ao extrair do HTML.
  const emails = extractEmails(`<p>%20ziva@gmail.com</p><a href="mailto:ziva@gmail.com">x</a>`);
  assert.deepEqual(emails, ["ziva@gmail.com"]);
});

test("extração de e-mails: descarta domínio de template (mysite.com)", () => {
  assert.ok(isJunkEmail("info@mysite.com"));
  assert.ok(!isJunkEmail("info@restaurantereal.com.br"));
});

test("WhatsApp só para celular BR", () => {
  assert.equal(toWhatsAppLink("(16) 99999-8888"), "https://wa.me/5516999998888");
  assert.equal(toWhatsAppLink("(16) 3333-4444"), ""); // fixo -> sem whatsapp
});

test("classificação de site social vs próprio", () => {
  assert.equal(isSocialOrAggregator("https://instagram.com/loja"), true);
  assert.equal(isSocialOrAggregator("https://linktr.ee/loja"), true);
  assert.equal(isSocialOrAggregator("https://www.minhaempresa.com.br"), false);
});

test("classificação Core Web Vitals", () => {
  assert.equal(classifyCwv(95), "BOM");
  assert.equal(classifyCwv(70), "MÉDIO");
  assert.equal(classifyCwv(30), "RUIM");
});

const mapsUrl = (id, extra = "") =>
  `https://www.google.com/maps/place/Lugar/@-19.9,-43.9,17z/data=!3m1!4b1!4m6!1s${id}!8m2${extra}`;

test("limpeza: junta duplicatas pelo place-id (mesmo lugar, URLs diferentes)", () => {
  const raw = [
    { nome: "Clínica X", telefone: "(31) 3333-0000", link_maps: mapsUrl("0xabc123:0xdef456", "&q=1") },
    { nome: "Clínica X", site: "https://x.com", link_maps: mapsUrl("0xabc123:0xdef456", "&q=2") },
  ];
  const out = cleanLeads(raw);
  assert.equal(out.length, 1); // mesmo place-id => 1 lead
  assert.equal(out[0].telefone, "(31) 3333-0000");
  assert.equal(out[0].site_bruto, "https://x.com"); // mesclou os campos vazios
});

test("limpeza: lugares com place-id diferente NÃO se fundem (mesmo nome)", () => {
  const raw = [
    { nome: "Cacau Show", telefone: "(31) 3333-1111", link_maps: mapsUrl("0xaaa:0x111") },
    { nome: "Cacau Show", telefone: "(31) 3333-2222", link_maps: mapsUrl("0xbbb:0x222") },
    { nome: "Cacau Show", link_maps: mapsUrl("0xccc:0x333") }, // sem telefone, outro lugar
  ];
  assert.equal(cleanLeads(raw).length, 3); // três unidades distintas
});

test("limpeza: NÃO descarta leads sem avaliação/contato (só deduplica)", () => {
  const raw = [
    { nome: "So Nome", link_maps: mapsUrl("0x1:0x1") },
    { nome: "", link_maps: mapsUrl("0x2:0x2") }, // até sem nome é mantido
  ];
  assert.equal(cleanLeads(raw).length, 2);
});

test("dedupe entre buscas: mesmo lugar em pesquisas diferentes some da 2ª", () => {
  const buscas = [
    {
      query: "dentistas campinas",
      comSite: [
        { nome: "Clínica A", site: "https://a.com", link_maps: mapsUrl("0xaaa:0x111") },
        { nome: "Clínica B", site: "https://b.com", link_maps: mapsUrl("0xbbb:0x222") },
      ],
      semSite: [],
      stats: { comSite: 2, semSite: 0 },
    },
    {
      query: "ortodontistas campinas",
      comSite: [
        // Mesmo place-id da Clínica A => duplicata entre buscas.
        { nome: "Clínica A", site: "https://a.com", link_maps: mapsUrl("0xaaa:0x111") },
        { nome: "Clínica C", site: "https://c.com", link_maps: mapsUrl("0xccc:0x333") },
      ],
      semSite: [],
      stats: { comSite: 2, semSite: 0 },
    },
  ];
  const { removed } = dedupeAcrossBuscas(buscas);
  assert.equal(removed, 1);
  assert.deepEqual(buscas[0].comSite.map((l) => l.nome), ["Clínica A", "Clínica B"]);
  assert.deepEqual(buscas[1].comSite.map((l) => l.nome), ["Clínica C"]); // A removida
  assert.equal(buscas[1].stats.comSite, 1); // contador ajustado
});

test("filtro: leads sem avaliação só entram quando mín = 0", () => {
  const semReview = cleanLeads([
    { nome: "Novo Negócio", telefone: "(16) 99999-7777" }, // sem nota/avaliações
    { nome: "Com Review", nota: "4,5", avaliacoes: "20", telefone: "(16) 99999-8888" },
  ]);
  // Padrão (mín 5): o sem review fica de fora.
  assert.deepEqual(filterLeads(semReview).map((l) => l.nome), ["Com Review"]);
  // Mín = 0: o sem review entra.
  const comZero = filterLeads(semReview, { minAvaliacoes: 0, notaMin: 0 }).map((l) => l.nome);
  assert.ok(comZero.includes("Novo Negócio") && comZero.includes("Com Review"));
});

test("filtro: faixa de avaliações e nota mínima", () => {
  const leads = cleanLeads([
    { nome: "Bom", nota: "4,5", avaliacoes: "50", telefone: "(16) 99999-1111" },
    { nome: "Poucas", nota: "5", avaliacoes: "3", telefone: "(16) 99999-2222" },
    { nome: "Muitas", nota: "4,8", avaliacoes: "500", telefone: "(16) 99999-3333" },
    { nome: "Nota baixa", nota: "3,2", avaliacoes: "40", telefone: "(16) 99999-4444" },
  ]);
  const out = filterLeads(leads); // padrão: 5–100 avaliações, nota >= 4
  assert.deepEqual(out.map((l) => l.nome), ["Bom"]);
});

test("extração de e-mails (mailto, texto, ofuscado; ignora assets)", () => {
  const html = `
    <a class="btn" href="mailto:Contato@Empresa.com.br?subject=Oi">Fale conosco</a>
    <p>Ou escreva para vendas@empresa.com.br</p>
    <span>suporte [at] empresa [dot] com</span>
    <img src="logo@2x.png">
    <a href="mailto:contato@empresa.com.br">repetido</a>`;
  const emails = extractEmails(html);
  assert.ok(emails.includes("contato@empresa.com.br"));   // mailto, minúsculo, sem ?subject
  assert.ok(emails.includes("vendas@empresa.com.br"));    // texto puro
  assert.ok(emails.includes("suporte@empresa.com"));      // desofuscado [at]/[dot]
  assert.ok(!emails.some((e) => e.includes("2x.png")));    // asset ignorado
  assert.equal(new Set(emails).size, emails.length);       // sem duplicatas
});

test("extração de e-mails: descarta placeholders e telemetria (Sentry/Wix)", () => {
  // Lixo: deve ser barrado.
  assert.ok(isJunkEmail("email@example.com"));
  assert.ok(isJunkEmail("contato@seudominio.com.br"));
  assert.ok(isJunkEmail("c183baa23371454f99f417f6616b724d@sentry.wixpress.com"));
  assert.ok(isJunkEmail("abc@sentry.io"));
  assert.ok(isJunkEmail("noreply@padaria.com.br"));      // no-reply
  assert.ok(isJunkEmail("nao-responda@loja.com"));       // não responda
  assert.ok(isJunkEmail("suporte@wix.com"));             // plataforma
  assert.ok(isJunkEmail("info@checkout.shopify.com"));   // subdomínio de plataforma
  // Real: deve passar.
  assert.ok(!isJunkEmail("contato@restaurante.com.br"));
  assert.ok(!isJunkEmail("joao@padaria.com"));
  assert.ok(!isJunkEmail("reply@empresa.com"));          // "reply" sozinho não é no-reply

  const html = `
    <p>email@example.com</p>
    <a href="mailto:c183baa23371454f99f417f6616b724d@sentry.wixpress.com">erro</a>
    <p>Fale com a gente: contato@restaurante.com.br</p>`;
  const emails = extractEmails(html);
  assert.deepEqual(emails, ["contato@restaurante.com.br"]);
});

test("extração de e-mails: decodifica Cloudflare email-protection", () => {
  // Codifica "contato@empresa.com" no formato do Cloudflare (1º byte = chave XOR).
  const enc = (email, key = 0x3f) => {
    let h = key.toString(16).padStart(2, "0");
    for (const c of email) h += (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0");
    return h;
  };
  const html =
    `<span class="__cf_email__" data-cfemail="${enc("contato@empresa.com")}">[email protected]</span>` +
    `<a href="/cdn-cgi/l/email-protection#${enc("vendas@empresa.com")}">e-mail</a>`;

  assert.deepEqual(decodeCloudflareEmails(html).sort(), ["contato@empresa.com", "vendas@empresa.com"]);
  // E o decode também entra no resultado geral de extractEmails:
  assert.ok(extractEmails(html).includes("contato@empresa.com"));
});

test("descoberta de links de contato: mesmo domínio, só pistas conhecidas", () => {
  const html = `
    <a href="/">Home</a>
    <a href="/contato">Contato</a>
    <a href="sobre-nos.html">Sobre</a>
    <a href="https://www.exemplo.com.br/fale-conosco">Fale</a>
    <a href="https://outro.com/contato">Externo</a>
    <a href="mailto:x@y.com">mail</a>
    <a href="/produtos">Produtos</a>`;
  const links = findContactLinks(html, "exemplo.com.br");
  assert.ok(links.includes("https://exemplo.com.br/contato"));
  assert.ok(links.includes("https://exemplo.com.br/sobre-nos.html"));
  assert.ok(links.includes("https://www.exemplo.com.br/fale-conosco")); // www = mesmo site
  assert.ok(!links.some((u) => u.includes("outro.com")));               // domínio externo fora
  assert.ok(!links.some((u) => u.includes("/produtos")));               // sem pista de contato
});

test("variantes de URL: alterna www/apex e cai para http", () => {
  const v = urlVariants("exemplo.com.br");
  assert.equal(v[0], "https://exemplo.com.br");
  assert.ok(v.some((u) => u.startsWith("https://www.exemplo.com.br")));
  assert.ok(v.some((u) => u.startsWith("http://")));
});

test("detecção de página de erro (soft 404 / parqueada)", () => {
  assert.ok(detectErrorPage("<html><head><title>Página não encontrada</title></head><body>x</body></html>"));
  assert.ok(detectErrorPage("<html><body><h1>Erro 404</h1></body></html>"));
  assert.ok(detectErrorPage("<title>Buy this domain</title>"));
  // Página normal não é marcada como erro:
  assert.equal(detectErrorPage("<title>Clínica X - Estética</title><body>" + "Serviços e contato. ".repeat(200) + "</body>"), null);
});

test("enriquecimento: site fora do ar vira FORA DO AR e não chama o PageSpeed", async () => {
  let psiChamado = false;
  const psiFake = { analyze: async () => { psiChamado = true; return { score: 99 }; } };
  const checkerFake = { check: async () => ({ down: true, reason: "HTTP 404" }) };
  const { leads, ok, foraDoAr } = await enrichLeads(
    [{ nome: "Site Morto", site: "https://morto.com" }],
    psiFake,
    undefined,
    { healthChecker: checkerFake, concurrency: 1 }
  );
  assert.equal(psiChamado, false);          // não desperdiça chamada no site morto
  assert.equal(leads[0].cwv_status, "FORA DO AR");
  assert.equal(leads[0].cwv_score, null);
  assert.equal(ok, 0);
  assert.equal(foraDoAr, 1);
});

test("socialPlatform: identifica a rede pela URL", () => {
  assert.equal(socialPlatform("https://instagram.com/loja"), "instagram");
  assert.equal(socialPlatform("https://m.facebook.com/Loja"), "facebook");
  assert.equal(socialPlatform("https://x.com/loja"), "twitter");
  assert.equal(socialPlatform("https://wa.me/5516999998888"), "whatsapp");
  assert.equal(socialPlatform("https://minhaempresa.com.br"), ""); // site próprio
});

test("normalizeSocialUrl: canoniza perfis e descarta links de ação/conteúdo", () => {
  // Perfis: vira https, sem www/m/query, sem barra final.
  assert.equal(normalizeSocialUrl("https://www.instagram.com/loja/?hl=pt"), "https://instagram.com/loja");
  assert.equal(normalizeSocialUrl("http://m.facebook.com/MinhaLoja/"), "https://facebook.com/MinhaLoja");
  // WhatsApp: só com número (path ou ?phone=); o "?text=" puro é descartado.
  assert.equal(normalizeSocialUrl("https://wa.me/5516999998888?text=oi"), "https://wa.me/5516999998888");
  assert.equal(normalizeSocialUrl("https://api.whatsapp.com/send?phone=5516999998888&text=oi"), "https://wa.me/5516999998888");
  assert.equal(normalizeSocialUrl("https://wa.me/?text=oi"), "");
  // Facebook profile.php?id= é perfil legítimo.
  assert.equal(normalizeSocialUrl("https://facebook.com/profile.php?id=123&ref=x"), "https://facebook.com/profile.php?id=123");
  // Lixo: compartilhamento, posts, página inicial da rede, vídeo do YouTube.
  assert.equal(normalizeSocialUrl("https://facebook.com/sharer/sharer.php?u=http://x.com"), "");
  assert.equal(normalizeSocialUrl("https://twitter.com/intent/tweet?text=oi"), "");
  assert.equal(normalizeSocialUrl("https://instagram.com/p/Abc123/"), "");
  assert.equal(normalizeSocialUrl("https://facebook.com/"), "");
  assert.equal(normalizeSocialUrl("https://youtube.com/watch?v=abc"), "");
  assert.equal(normalizeSocialUrl("https://youtube.com/@canal"), "https://youtube.com/@canal");
  // Não-social: vazio.
  assert.equal(normalizeSocialUrl("https://empresa.com.br/sobre"), "");
});

test("normalizeSocialUrl: LinkedIn — perfis /in e /company valem; conteúdo não", () => {
  assert.equal(socialPlatform("https://www.linkedin.com/company/minha-loja"), "linkedin");
  assert.equal(normalizeSocialUrl("https://www.linkedin.com/company/minha-loja/?trk=x"), "https://linkedin.com/company/minha-loja");
  assert.equal(normalizeSocialUrl("https://br.linkedin.com/in/joao-silva/"), "https://br.linkedin.com/in/joao-silva");
  // Ações/conteúdo do LinkedIn são descartados.
  assert.equal(normalizeSocialUrl("https://www.linkedin.com/sharing/share-offsite/?url=x"), "");
  assert.equal(normalizeSocialUrl("https://www.linkedin.com/feed/"), "");
  assert.equal(normalizeSocialUrl("https://www.linkedin.com/posts/alguem_abc"), "");
  assert.equal(normalizeSocialUrl("https://www.linkedin.com/jobs/view/123"), "");
});

test("extractSocials: extrai perfis dos hrefs e deduplica", () => {
  const html = `
    <a href="https://www.instagram.com/loja/">insta</a>
    <a href="https://instagram.com/loja">insta de novo</a>
    <a href="https://facebook.com/sharer/sharer.php?u=x">compartilhar</a>
    <a href="https://facebook.com/MinhaLoja">face</a>
    <a href="https://empresa.com.br/contato">contato</a>`;
  const socials = extractSocials(html);
  assert.ok(socials.includes("https://instagram.com/loja"));
  assert.ok(socials.includes("https://facebook.com/MinhaLoja"));
  assert.ok(!socials.some((u) => u.includes("sharer")));     // ação de compartilhar fora
  assert.ok(!socials.some((u) => u.includes("empresa.com"))); // site próprio fora
  assert.equal(new Set(socials).size, socials.length);        // sem duplicatas
});

test("mergeSocialLinks: mescla e deduplica preservando o que já havia", () => {
  // Já tinha o Instagram (forma crua do Maps); acrescenta Facebook, sem duplicar.
  const out = mergeSocialLinks(
    "https://www.instagram.com/loja/",
    ["https://instagram.com/loja", "https://facebook.com/MinhaLoja"]
  );
  const parts = out.split(" | ");
  assert.deepEqual(parts, ["https://instagram.com/loja", "https://facebook.com/MinhaLoja"]);
});

test("busca web: monta os termos e decodifica os resultados do DuckDuckGo", () => {
  assert.equal(buildQueryTerms({ nome: "Padaria Pão Quente", cidade: "São Carlos", estado: "SP" }),
    "Padaria Pão Quente São Carlos SP");
  const realUrl = "https://www.instagram.com/padaria";
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(realUrl)}&rut=x">Padaria</a>`;
  assert.deepEqual(parseDuckResults(html), [realUrl]);
});

test("separação: social vai para sem-site e entra em redes_sociais", () => {
  const leads = cleanLeads([
    { nome: "ComSite", site: "https://empresa.com.br", telefone: "(16) 99999-1111" },
    { nome: "SoInsta", site: "https://instagram.com/empresa", telefone: "(16) 99999-2222" },
    { nome: "SemNada", telefone: "(16) 99999-3333" },
  ]);
  const { comSite, semSite } = splitLeads(leads);
  assert.deepEqual(comSite.map((l) => l.nome), ["ComSite"]);
  assert.equal(comSite[0].site, "https://empresa.com.br");
  const soInsta = semSite.find((l) => l.nome === "SoInsta");
  assert.equal(soInsta.site, "");
  assert.ok(soInsta.redes_sociais.includes("instagram.com/empresa"));
});

test("export: redes sociais separadas por coluna e cabeçalhos legíveis por máquina", () => {
  const lead = {
    redes_sociais:
      "https://instagram.com/lojax | https://facebook.com/lojax | https://linkedin.com/company/lojax | https://wa.me/5511999998888 | https://youtube.com/@lojax",
  };
  const cols = columnsFor("sem-site");
  const colByKey = (k) => cols.find((c) => c.key === k);

  // Cada rede principal na sua própria coluna; o resto cai em "outras_redes".
  assert.equal(colByKey("instagram").value(lead), "https://instagram.com/lojax");
  assert.equal(colByKey("facebook").value(lead), "https://facebook.com/lojax");
  assert.equal(colByKey("linkedin").value(lead), "https://linkedin.com/company/lojax");
  assert.equal(
    colByKey("outras_redes").value(lead),
    "https://wa.me/5511999998888 | https://youtube.com/@lojax"
  );
  // Sem rede => célula vazia, não "undefined".
  assert.equal(colByKey("instagram").value({}), "");
  // A coluna combinada "Redes Sociais" não existe mais.
  assert.equal(colByKey("redes_sociais"), undefined);
  // Cabeçalhos: só [a-z0-9_], sem acento nem espaço (consumíveis por outra app).
  for (const c of columnsFor("com-site")) assert.match(c.header, /^[a-z0-9_]+$/);
});

test("validação: casamento de nome do negócio com o handle do perfil", () => {
  // Handle concatenado contém o nome -> casa.
  assert.ok(socialNameMatch("Padaria Pão Quente", "https://instagram.com/padaopaoquente") >= 0.5);
  // Stopwords ("de") são ignoradas; sobreposição de tokens conta.
  assert.ok(socialNameMatch("Auto Center Silva", "https://instagram.com/autocentersilva") >= 0.5);
  // Homônimo sem relação -> baixo.
  assert.ok(socialNameMatch("Padaria Pão Quente", "https://instagram.com/joao_viagens") < 0.5);
});

test("validação: confiança depende da fonte (só 'busca' é escrutinada)", () => {
  // Próprio site / Maps / desconhecida: alta, independente do nome.
  assert.equal(socialConfidence("site", 0), "alta");
  assert.equal(socialConfidence("maps", 0), "alta");
  assert.equal(socialConfidence(undefined, 0), "alta");
  // Busca: vira média se o nome casar, baixa se não.
  assert.equal(socialConfidence("busca", 0.8), "media");
  assert.equal(socialConfidence("busca", 0.1), "baixa");
});

test("validação: recordSocialSources marca só os links novos (1º a registrar vence)", () => {
  const antes = "https://instagram.com/loja";
  const depois = "https://instagram.com/loja | https://facebook.com/loja";
  const f1 = recordSocialSources({}, antes, depois, "site");
  // O link pré-existente não recebe fonte aqui; o novo recebe "site".
  assert.equal(f1["https://instagram.com/loja"], undefined);
  assert.equal(f1["https://facebook.com/loja"], "site");
  // Uma fase posterior (busca) não sobrescreve quem já tem fonte.
  const f2 = recordSocialSources(f1, depois, depois + " | https://linkedin.com/company/loja", "busca");
  assert.equal(f2["https://facebook.com/loja"], "site");
  assert.equal(f2["https://linkedin.com/company/loja"], "busca");
});

test("export: confiança geral e links a revisar derivam de fonte + nome", () => {
  const lead = {
    nome: "Loja X",
    redes_sociais: "https://instagram.com/lojax | https://facebook.com/perfil_aleatorio_999",
    redes_fontes: {
      "https://instagram.com/lojax": "site", // declarado pelo site -> alta
      "https://facebook.com/perfil_aleatorio_999": "busca", // busca + nome não casa -> baixa
    },
  };
  const evals = evaluateSocials(lead);
  assert.equal(evals.find((e) => e.plataforma === "instagram").confianca, "alta");
  assert.equal(evals.find((e) => e.plataforma === "facebook").confianca, "baixa");

  const cols = columnsFor("sem-site");
  const colByKey = (k) => cols.find((c) => c.key === k);
  // Geral = a pior das duas; revisar = só o link de busca incerto.
  assert.equal(colByKey("redes_confianca").value(lead), "baixa");
  assert.equal(colByKey("redes_revisar").value(lead), "https://facebook.com/perfil_aleatorio_999");
  // Lead só com link de site: confiança alta e nada a revisar.
  const limpo = { nome: "Loja X", redes_sociais: "https://instagram.com/lojax", redes_fontes: { "https://instagram.com/lojax": "site" } };
  assert.equal(colByKey("redes_confianca").value(limpo), "alta");
  assert.equal(colByKey("redes_revisar").value(limpo), "");
});
