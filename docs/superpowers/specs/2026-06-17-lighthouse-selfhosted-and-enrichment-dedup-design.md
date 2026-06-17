# Lighthouse self-hosted + dedup/cache do enriquecimento — Design

**Data:** 2026-06-17
**Branch:** feat/ui-redesign
**Status:** Aprovado para planejamento

## Objetivo

Acelerar o enriquecimento de leads com duas mudanças independentes:

1. **Instância Lighthouse self-hosted (opcional, escolhível no front-end):** permitir
   apontar a medição de laboratório (o passo lento) para uma instância própria,
   compatível com o formato PageSpeed Insights v5, removendo a fila/rate-limit da
   API hospedada do Google no passo mais caro.
2. **Camada de dedup/cache por job:** evitar trabalho repetido durante o
   enriquecimento — fetches de site idênticos, buscas web idênticas e análises de
   CWV no mesmo domínio.

Sem `lighthouseUrl` configurado e sem domínios/nomes repetidos, o comportamento é
**idêntico ao atual**. Ambas as features são puramente aditivas.

---

## Feature 1 — Instância Lighthouse self-hosted

### Estratégia de fluxo (decidida)

Mantém **CrUX primeiro** (dado de campo do Google, ~300ms) como 1º passo do modo
rápido. A instância self-hosted substitui **apenas** o fallback de laboratório
(Lighthouse) que hoje vai para a API hospedada do Google. Resultado:

```
modo rápido (padrão):  CrUX (Google) → miss → Lighthouse (SUA instância)
modo profundo (deep):  Lighthouse (SUA instância), 4 categorias, sem CrUX
```

A API key do Google segue necessária apenas para o CrUX (já é assim hoje).

### Contrato da instância (aceitar ambos os formatos)

A instância recebe uma requisição no mesmo formato de query do PageSpeed v5
(`?url=&strategy=&category=...`, `key` só se houver) e devolve JSON em **um dos
dois formatos**, ambos aceitos pelo parser:

1. **Envelope PageSpeed v5:** `{ lighthouseResult: <lhr>, loadingExperience?: {...} }`
   — formato exato do Google; já é o que `buildReport` lê hoje.
2. **`lhr` cru:** o corpo inteiro é o Lighthouse Result (`{ categories, audits, ... }`),
   sem o envelope — comum em imagens prontas de lighthouse-server.

### Mudanças de código

- **`src/infrastructure/pagespeed/PageSpeedClient.js`**
  - `buildReport(data)` (atual `:46`): detectar formato. Se `data.lighthouseResult`
    existir, usar como hoje; senão, se `data.categories`/`data.audits` existirem no
    topo, tratar `data` como o `lhr` (`const lh = data.lighthouseResult || data`).
    `loadingExperience` (campo CrUX do Google) só existe no envelope; quando ausente,
    `field` fica `null` — comportamento já previsto.
  - Construtor aceita `baseUrl` opcional. `ENDPOINT` (atual `:17`) continua como
    default; `_attempt` usa `this.baseUrl || ENDPOINT`. Resto de `_attempt`/`analyze`
    (montagem de query, timeout, retry) inalterado.
- **`src/infrastructure/http/enrichClients.js`**
  - `buildEnrichClients({ ..., lighthouseUrl })`: se `lighthouseUrl` truthy, repassa
    como `baseUrl` ao `PageSpeedClient`. CrUX continua criado normalmente no modo
    rápido (não é afetado pela instância). No modo deep, segue sem CrUX.
- **`src/infrastructure/http/server.js`**
  - `/api/enrich/:id` (`:254`): ler `lighthouseUrl` de
    `req.query.lighthouseUrl || process.env.LIGHTHOUSE_SERVER_URL || ""` (trim) e
    passar a `buildEnrichClients`.
  - `/api/report/:id/lead/...` (`:460`): idem ao montar o client para o relatório
    completo, para que PDF/HTML saiam pela mesma instância.
- **`.env.example`**: documentar `LIGHTHOUSE_SERVER_URL=` (vazio = usa PageSpeed do Google).

---

## Feature 2 — Camada de dedup/cache por job (A + B + C)

### Arquitetura

Módulo novo **`src/application/jobCache.js`** exportando `createJobCache()`, que
devolve um objeto com três memoizadores **por-promessa**:

```js
{
  page,    // (A) chave: URL normalizada      -> resultado de scrapeContacts(site)
  search,  // (B) chave: nome|cidade|estado   -> string[] de perfis
  cwv,     // (C) chave: URL/origem normalizada-> resultado bruto de rede (CrUX OU report)
}
```

Cada memoizador expõe `run(key, factory)`:
- Se `key` já tem promise registrada, retorna a **mesma promise** (dedup de
  chamadas concorrentes — importante porque os pools rodam vários leads em paralelo).
- Senão, chama `factory()`, registra a promise e a retorna.
- Em rejeição, remove a entrada (não cacheia falha permanentemente).

O cache vive em **`item.cache`** no `store` do servidor (`server.js:135`), criado
uma vez por job (lazy, na primeira rota que precisar). Como todas as rotas
(`/api/enrich`, `/api/sitetext`, `/api/emails`, `/api/socials`, `/api/report`)
compartilham o mesmo `item`, o cache **persiste entre rotas** do mesmo job. Some
junto com o job na expiração (TTL de 1h já existente).

### (A) Cache de fetch de site

- Onde: `enrichEmails` e `enrichSocials` chamam `es.scrapeContacts(lead.site)` na
  fase rápida (não-navegador).
- Envolver essa chamada com `cache.page.run(normalizeKey(lead.site), () => es.scrapeContacts(lead.site))`.
- Como ambas as rotas usam o mesmo `item.cache.page`, a rota de redes reusa o
  crawl (home + até 6 páginas de contato) já feito pela rota de e-mails, em vez de
  re-baixar tudo. `scrapeContacts` é determinístico e devolve `{emails, socials, pagesVisited}`,
  então compartilhar é seguro.
- Os fallbacks de navegador (fase 2) são por-lead e específicos — **não** entram no cache.
- As funções de aplicação recebem o memoizador via `options` (ex.: `options.pageCache`),
  opcional — sem ele, comportam-se como hoje.

### (B) Cache de busca web

- Onde: `SocialSearchScraper.search(lead)` dentro de `enrichSocials`.
- Chave: `${nome}|${cidade}|${estado}` normalizado (minúsculas, trim). Mesma lógica
  de termos que o scraper já usa em `buildQueryTerms`.
- Envolver com `cache.search.run(key, () => socialSearchScraper.search(lead))`.

### (C) Cache de análise CWV

- Onde: a chamada de I/O dentro de `enrichLeads` (a query CrUX **e** a análise
  Lighthouse).
- Chave: URL/origem normalizada do `lead.site`.
- **O cache guarda apenas o resultado bruto da rede** — o objeto CrUX
  (`{ hasField, score, lcp, ... }`) ou o `report` do Lighthouse — **não** os campos
  já mapeados para o lead. O `enrichLeads` então recalcula os campos por-lead
  (incluindo `audit_score` via `buildAuditReportModel`, que depende de campos do
  próprio lead) em cima do resultado em cache. Assim o I/O caro é deduplicado, mas
  cada lead mantém seus próprios campos derivados.
- Vale também no **relatório individual** (`/api/report`, via `ensureFullReport`):
  a análise Lighthouse completa é cacheada por URL no mesmo `item.cache.cwv`
  (chave distinta para o resultado deep, para não colidir com o resultado rápido).
- Sempre-ligado, sem toggle de UI (otimização transparente).

### Normalização de chave

Helper único em `jobCache.js` (ou reutilizar `normalizeUrl` do PageSpeedClient):
garantir protocolo, minúsculas no host, remover barra final e fragmento. Para (C),
considerar origem (host) quando fizer sentido; manter URL completa se o path
importar para a medição. Decisão de implementação fina fica no plano.

---

## Front-end

- **`public/index.html`** (bloco Opções avançadas, `:138`): novo campo ao lado da
  "Chave PageSpeed", com tooltip `.help` no padrão existente:
  - label: "Instância Lighthouse (opcional — usa o PageSpeed do Google se vazio)"
  - `<input id="lighthouseUrl" type="url" placeholder="https://lighthouse.seudominio.com" />`
  - tooltip explicando: aponta para uma instância Lighthouse própria que acelera a
    análise de laboratório; deixe vazio para usar o PageSpeed Insights do Google.
- **`public/app.js`** (`enrich()`, `:422`): adicionar
  `lighthouseUrl: $("lighthouseUrl").value.trim()` ao `URLSearchParams`.
- O dedup/cache **não** tem UI (transparente).

---

## Testes

- `buildReport`: aceita envelope PageSpeed v5 **e** `lhr` cru (dois casos).
- `PageSpeedClient` com `baseUrl` + `fetchImpl` injetado: monta a URL na base custom,
  parseia a resposta, mantém retry/timeout.
- `buildEnrichClients`: com `lighthouseUrl` repassa `baseUrl`; CrUX ainda criado no
  modo rápido.
- `jobCache`: `run` memoiza por chave; chamadas concorrentes na mesma chave
  compartilham a promise; rejeição limpa a entrada.
- Integração leve: dois leads no mesmo domínio → factory de CWV chamada 1x; rota de
  redes reusa `scrapeContacts` da rota de e-mails.
- Atualizar `test/pipeline.test.js` conforme necessário; suíte atual (75/75) deve
  seguir verde.

## Não-objetivos (YAGNI)

- Não há toggle de UI para o cache (sempre-ligado).
- Não há cache persistente entre jobs/execuções (escopo é o job em memória).
- Não há compartilhamento de HTML cru entre scrapers de tipos diferentes
  (`SiteTextScraper.fetchText` vs `EmailScraper.scrapeContacts`) — conteúdos
  diferentes; o ganho de (A) vem do reuso de `scrapeContacts` entre e-mails e redes.
- Não se implementa/instala o servidor Lighthouse self-hosted; o escopo é o lado
  cliente (campo + adaptador). A instância é fornecida pelo usuário via URL.
