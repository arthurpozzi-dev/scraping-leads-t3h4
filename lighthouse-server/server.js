/**
 * Worker Lighthouse self-hosted — compatível com o contrato de query do PageSpeed.
 *
 * Roda o Lighthouse oficial do Google (GoogleChrome/lighthouse) num Chromium
 * headless e devolve o Lighthouse Result (lhr) cru em JSON. O `PageSpeedClient`
 * do app aceita esse formato direto (`data.lighthouseResult || data`), então este
 * worker entra no lugar da API do Google só preenchendo `LIGHTHOUSE_SERVER_URL`.
 *
 *   GET /         ?url=<site>&strategy=mobile|desktop&category=performance[&category=seo...]
 *   GET /healthz  -> { ok, active, max, queued }
 *
 * Velocidade:
 *  - Concorrência interna: até LH_CONCURRENCY runs em paralelo num worker (cada um
 *    abre seu próprio Chrome, para uma medição limpa e isolada).
 *  - Escala horizontal: suba vários workers (LH_PORT distinto, ou réplicas Docker)
 *    e aponte o app para todos — ele faz round-robin (lista separada por vírgula
 *    em LIGHTHOUSE_SERVER_URL) ou use o nginx do docker-compose como URL única.
 *
 * Reaproveita o Chromium já instalado pelo Playwright (não baixa outro Chrome).
 *
 * Variáveis de ambiente (lidas do ambiente ou do .env da raiz do projeto):
 *   LH_PORT          porta HTTP do worker (padrão 3001)
 *   LH_CONCURRENCY   runs simultâneos (padrão = núcleos - 1)
 *   LH_CHROME_PATH    binário do Chrome (padrão: o Chromium do Playwright)
 *   LH_CHROME_FLAGS   flags extras do Chrome, separadas por espaço
 *   LH_USER_DATA_DIR  diretório de perfil do Chrome (necessário p/ Chromium snap,
 *                     que não enxerga /tmp; aponte para algo dentro de ~/snap/...)
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import { chromium } from "playwright";
import { parseCategories, buildLhFlags } from "./lhFlags.js";

// Carrega o .env da raiz (LH_CHROME_PATH, LH_USER_DATA_DIR, etc.). Variáveis já
// definidas no ambiente (ex.: LH_PORT passado pela frota) têm precedência.
try {
  process.loadEnvFile?.();
} catch {
  /* sem .env: usa os defaults */
}

const PORT = Number(process.env.LH_PORT) || 3001;
const MAX = Math.max(1, Number(process.env.LH_CONCURRENCY) || os.cpus().length - 1);
const CHROME_PATH = process.env.LH_CHROME_PATH || chromium.executablePath();
const CHROME_FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  ...(process.env.LH_CHROME_FLAGS ? process.env.LH_CHROME_FLAGS.split(" ").filter(Boolean) : []),
];

// ---- Semáforo: limita quantos Lighthouse rodam ao mesmo tempo ---------------
let active = 0;
const waiters = [];
function acquire() {
  if (active < MAX) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}
function release() {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

const USER_DATA_DIR = process.env.LH_USER_DATA_DIR || "";
let runSeq = 0;

/** Mata o Chrome com segurança: kill() pode devolver Promise OU undefined conforme a versão. */
async function killChrome(chrome) {
  try {
    await chrome.kill();
  } catch {
    /* já morto / sem handle: ignora */
  }
}

/**
 * Uma medição: abre um Chrome dedicado, roda o Lighthouse e fecha o Chrome.
 * `onChrome` recebe a instância do Chrome assim que sobe, para o chamador poder
 * matá-la se o cliente desconectar (libera o slot na hora).
 */
async function runLighthouse(url, { strategy, categories, onChrome }) {
  // Perfil único por run: sem base, o chrome-launcher usa /tmp; com base (snap),
  // criamos um subdir único para não conflitar entre runs concorrentes.
  const userDataDir = USER_DATA_DIR ? path.join(USER_DATA_DIR, `run-${process.pid}-${runSeq++}`) : undefined;
  if (userDataDir) fs.mkdirSync(userDataDir, { recursive: true });
  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: CHROME_PATH,
      chromeFlags: CHROME_FLAGS,
      ...(userDataDir ? { userDataDir } : {}),
    });
    onChrome?.(chrome);
    const result = await lighthouse(url, buildLhFlags({ strategy, categories, port: chrome.port }));
    if (!result?.lhr) throw new Error("Lighthouse não devolveu resultado.");
    return result.lhr;
  } finally {
    // Mata o Chrome (se subiu) e apaga o perfil — senão os dirs run-* vazam disco.
    if (chrome) await killChrome(chrome);
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

// O Lighthouse pode emitir erros de protocolo ASSÍNCRONOS que escapam do
// try/catch da requisição — tipicamente quando o Chrome é morto no meio de um
// run abortado ("Target closed"). Num worker stateless (1 Chrome por run, sem
// estado compartilhado) isso é isolado e recuperável: logamos e seguimos vivos
// em vez de derrubar o processo (e com ele os outros runs em andamento).
process.on("unhandledRejection", (e) => console.error("[lh] unhandledRejection:", e?.message || e));
process.on("uncaughtException", (e) => console.error("[lh] uncaughtException:", e?.message || e));

const app = express();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, active, max: MAX, queued: waiters.length });
});

app.get("/", async (req, res) => {
  const url = String(req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "Parâmetro 'url' é obrigatório." });
  const strategy = String(req.query.strategy || "mobile");
  const categories = parseCategories(req.query);

  await acquire();
  const startedAt = Date.now();
  // Se o cliente desistir (timeout/abort), mata o Chrome para não segurar o slot
  // com um run abandonado — caso contrário a fila trava sob carga.
  let chromeRef = null;
  let finished = false;
  const onClose = () => {
    if (!finished && chromeRef) killChrome(chromeRef);
  };
  res.on("close", onClose);
  try {
    const lhr = await runLighthouse(url, { strategy, categories, onChrome: (c) => (chromeRef = c) });
    finished = true;
    if (res.writableEnded) return; // cliente já foi embora
    // O Lighthouse pode "concluir" com erro de runtime (site fora do ar, etc.).
    if (lhr.runtimeError?.code) {
      return res.status(502).json({ error: lhr.runtimeError.message || lhr.runtimeError.code });
    }
    res.json(lhr); // lhr cru: o PageSpeedClient aceita sem o envelope { lighthouseResult }
  } catch (e) {
    finished = true;
    if (!res.writableEnded) res.status(502).json({ error: e?.message || "Falha ao executar o Lighthouse." });
  } finally {
    res.off("close", onClose);
    const ms = Date.now() - startedAt;
    release();
    console.log(`[lh] ${strategy} [${categories.join(",")}] ${url} — ${ms}ms (${active}/${MAX} ativos, ${waiters.length} na fila)`);
  }
});

app.listen(PORT, () => {
  console.log(`\n  Lighthouse worker em http://localhost:${PORT}  ·  concorrência: ${MAX}`);
  console.log(`  Chrome: ${CHROME_PATH}\n`);
});
