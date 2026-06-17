/**
 * Helpers puros do worker Lighthouse — sem dependência de Chrome, fáceis de testar.
 *
 * Traduzem o contrato de query do PageSpeed (strategy + category) para as flags
 * que o Lighthouse oficial (GoogleChrome/lighthouse) espera.
 */

/** Categorias que o Lighthouse 12+ sabe pontuar (a categoria "pwa" foi removida na v12). */
export const VALID_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

/**
 * Lê as categorias da query do PageSpeed: aceita `?category=a&category=b` OU
 * `?category=a,b`. Fallback para ["performance"]. Ignora valores desconhecidos.
 */
export function parseCategories(query = {}) {
  const raw = query.category ?? query.categories;
  if (raw == null) return ["performance"];
  const list = Array.isArray(raw) ? raw : [raw];
  const cats = list
    .flatMap((c) => String(c).split(","))
    .map((c) => c.trim().toLowerCase())
    .filter((c) => VALID_CATEGORIES.includes(c));
  return cats.length ? [...new Set(cats)] : ["performance"];
}

/**
 * Monta as flags do Lighthouse a partir da strategy (mobile|desktop), categorias
 * e da porta de debug do Chrome. Espelha os presets mobile/desktop do PageSpeed.
 */
export function buildLhFlags({ strategy = "mobile", categories = ["performance"], port } = {}) {
  const desktop = String(strategy).toLowerCase() === "desktop";
  return {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: categories,
    formFactor: desktop ? "desktop" : "mobile",
    screenEmulation: desktop
      ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
      : { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    throttling: desktop
      ? { rttMs: 40, throughputKbps: 10 * 1024, cpuSlowdownMultiplier: 1 }
      : { rttMs: 150, throughputKbps: 1.6 * 1024, cpuSlowdownMultiplier: 4 },
  };
}
