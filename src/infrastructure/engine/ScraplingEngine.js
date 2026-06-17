/**
 * Engine Scrapling (Python) — falado via sidecar HTTP local.
 *
 * Scrapling é uma lib Python; o Node não a importa direto. Este engine sobe o
 * sidecar (scrapling-sidecar/app.py) sob demanda e faz POST /fetch. Cobre a
 * camada de FETCH (HTTP) nos modos fast/dynamic/stealth. Não fornece browser ao
 * vivo: `launchBrowser` lança NotSupportedError (o servidor degrada para o
 * caminho de fetch quando Scrapling é escolhido para o Maps interativo).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NotSupportedError } from "./Engine.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIDECAR_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scrapling-sidecar");

/** Resolve o executável Python: env SCRAPLING_PYTHON > venv do sidecar > python3. */
function resolvePython() {
  if (process.env.SCRAPLING_PYTHON) return process.env.SCRAPLING_PYTHON;
  const venv = process.platform === "win32"
    ? join(SIDECAR_DIR, ".venv", "Scripts", "python.exe")
    : join(SIDECAR_DIR, ".venv", "bin", "python3");
  if (existsSync(venv)) return venv;
  return "python3";
}

export class ScraplingEngine {
  /**
   * @param {{ mode?:string, port?:number, spawnImpl?:Function, fetchImpl?:typeof fetch, baseUrl?:string }} [options]
   */
  constructor({ mode = "fast", port = 8765, spawnImpl, fetchImpl, baseUrl } = {}) {
    this.name = "scrapling";
    this.supportsBrowser = false;
    this.mode = mode;
    this._port = port;
    this._spawn = spawnImpl || spawn;
    this._fetch = fetchImpl || globalThis.fetch;
    this._baseUrl = baseUrl || null;
    this._proc = null;
    this._ready = baseUrl ? Promise.resolve() : null;
  }

  /** Sobe o sidecar (se ainda não estiver) e espera o /health responder. */
  async _ensure() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      this._baseUrl = `http://127.0.0.1:${this._port}`;
      const py = resolvePython();
      this._proc = this._spawn(py, [join(SIDECAR_DIR, "app.py"), "--port", String(this._port)], {
        cwd: SIDECAR_DIR,
        stdio: "ignore",
      });
      this._proc.on?.("error", () => {});
      for (let i = 0; i < 40; i++) {
        try {
          const r = await this._fetch(`${this._baseUrl}/health`);
          if (r.ok) return;
        } catch {
          /* ainda subindo */
        }
        await sleep(500);
      }
      throw new Error(
        "Scrapling sidecar não respondeu — verifique Python ≥3.10 e as deps (ver scrapling-sidecar/README.md)."
      );
    })();
    return this._ready;
  }

  async fetchHtml(url, { timeoutMs = 20000, mode } = {}) {
    await this._ensure();
    const res = await this._fetch(`${this._baseUrl}/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, mode: mode || this.mode, timeout: timeoutMs }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Scrapling: ${data.error}`);
    return { html: data.html, status: data.status ?? 0, finalUrl: data.final_url || url };
  }

  async launchBrowser() {
    throw new NotSupportedError(
      "Scrapling não fornece browser ao vivo; use Playwright/CloakBrowser para o deep-scrape do Maps."
    );
  }

  async close() {
    if (this._proc) {
      try { this._proc.kill(); } catch { /* já morto */ }
      this._proc = null;
    }
  }
}
