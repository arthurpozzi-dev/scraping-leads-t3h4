/**
 * Engine = provider de scraping com duas capacidades.
 *
 *  - `fetchHtml(url, opts)`  — camada HTTP (emails, texto de site, health, pb=).
 *  - `launchBrowser(opts)`   — navegação ao vivo (deep-scrape do Maps, fallback JS).
 *
 * Nem todo engine faz as duas coisas: Scrapling não fornece browser ao vivo
 * (`supportsBrowser=false`) e lança NotSupportedError em launchBrowser.
 *
 * @typedef {Object} Engine
 * @property {string} name
 * @property {boolean} supportsBrowser
 * @property {(url:string, opts?:{timeoutMs?:number, headers?:Record<string,string>, mode?:string}) => Promise<{html:string,status:number,finalUrl:string}>} fetchHtml
 * @property {(opts?:{headless?:boolean}) => Promise<import("playwright").Browser>} launchBrowser
 * @property {() => Promise<void>} close
 */

export class NotSupportedError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "NotSupportedError";
  }
}
