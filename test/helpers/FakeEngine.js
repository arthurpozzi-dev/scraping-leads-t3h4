import { NotSupportedError } from "../../src/infrastructure/engine/Engine.js";

/** Test double de Engine com respostas configuráveis e registro de chamadas. */
export class FakeEngine {
  constructor({ name = "fake", supportsBrowser = true, html = "<html></html>", status = 200 } = {}) {
    this.name = name;
    this.supportsBrowser = supportsBrowser;
    this._html = html;
    this._status = status;
    this.calls = [];
  }
  async fetchHtml(url, opts = {}) {
    this.calls.push({ url, opts });
    return { html: this._html, status: this._status, finalUrl: url };
  }
  async launchBrowser() {
    if (!this.supportsBrowser) throw new NotSupportedError("no browser");
    const browser = { closed: false };
    browser.close = async () => { browser.closed = true; };
    browser.newPage = async () => ({ async goto() {}, async content() { return this._html; }, url() { return "about:blank"; }, async close() {} });
    return browser;
  }
  async close() {}
}
