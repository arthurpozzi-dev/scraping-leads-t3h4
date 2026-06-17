/**
 * Sobe uma FROTA de workers Lighthouse em portas consecutivas, numa máquina só,
 * e imprime a lista de URLs (separadas por vírgula) pronta pra colar em
 * LIGHTHOUSE_SERVER_URL — o app faz round-robin entre elas.
 *
 *   node scripts/lighthouseFleet.js [nInstâncias] [portaInicial]
 *   LH_FLEET=4 LH_BASE_PORT=3001 npm run lighthouse:fleet
 *
 * A concorrência total é dividida entre os workers (núcleos - 1 no total), para
 * não estourar a CPU. Para escalar entre MÁQUINAS/containers, use o docker-compose
 * em lighthouse-server/ e liste as URLs de cada host aqui.
 */
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const N = Math.max(1, Number(process.argv[2] || process.env.LH_FLEET) || 3);
const BASE = Number(process.argv[3] || process.env.LH_BASE_PORT) || 3001;
const server = path.join(__dirname, "..", "lighthouse-server", "server.js");

// Divide os núcleos disponíveis entre os workers (mínimo 1 cada).
const perWorker = Math.max(1, Math.floor((os.cpus().length - 1) / N));

const children = [];
const urls = [];
for (let i = 0; i < N; i++) {
  const port = BASE + i;
  urls.push(`http://localhost:${port}`);
  children.push(
    spawn(process.execPath, [server], {
      stdio: "inherit",
      env: { ...process.env, LH_PORT: String(port), LH_CONCURRENCY: String(perWorker) },
    })
  );
}

console.log(`\n  Frota Lighthouse: ${N} workers (portas ${BASE}..${BASE + N - 1}, ${perWorker} run(s)/worker)`);
console.log(`  Cole no .env:  LIGHTHOUSE_SERVER_URL=${urls.join(",")}\n`);

const killAll = () => {
  for (const c of children) c.kill("SIGINT");
  process.exit(0);
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, killAll);
