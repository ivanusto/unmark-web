/*
 * Thin client for the watermarks-remover HTTP service (server.py):
 *   GET  /health, GET /capabilities, POST /inspect, POST /clean
 * See https://github.com/guillaumemeyer/watermarks-remover/tree/main/service
 *
 * The service is loopback-only and sends no CORS headers (by upstream design).
 * To use it from this page, serve the page from the same origin (serve_local.py)
 * or put a reverse proxy in front that allows this page's origin — see README
 * "Connecting a server".
 * Bearer token is sent when configured; nothing is persisted unless the user
 * ticks "remember in this browser".
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "unmark-web.server";
  const STORAGE_KEY_LEGACY = "watermarks-remover-web.server";  // key used before the rename
  const DEFAULT_URL = "http://127.0.0.1:8765";
  const config = { baseUrl: "", apiKey: "", remember: false };

  function load() {
    try {
      const raw = root.localStorage && (root.localStorage.getItem(STORAGE_KEY) || root.localStorage.getItem(STORAGE_KEY_LEGACY));
      if (raw) {
        const saved = JSON.parse(raw);
        config.baseUrl = String(saved.baseUrl || "");
        config.apiKey = String(saved.apiKey || "");
        config.remember = true;
      }
    } catch (_) { /* storage unavailable (file://, private mode) */ }
    return config;
  }

  function save(next) {
    Object.assign(config, next);
    config.baseUrl = normalizeUrl(config.baseUrl);
    try {
      if (config.remember) root.localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: config.baseUrl, apiKey: config.apiKey }));
      else root.localStorage.removeItem(STORAGE_KEY);
      root.localStorage.removeItem(STORAGE_KEY_LEGACY);  // superseded once we've written the new key

    } catch (_) { /* ignore */ }
    return config;
  }

  function normalizeUrl(u) {
    u = (u || "").trim();
    if (!u) return "";
    if (u.startsWith("/")) return u.replace(/\/+$/, "") || "/"; // same-origin path, e.g. "/api" (serve_local.py)
    if (!/^https?:\/\//i.test(u)) u = "http://" + u;
    return u.replace(/\/+$/, "");
  }

  function headers(json, auth = true) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    if (auth && config.apiKey) h["Authorization"] = "Bearer " + config.apiKey;
    return h;
  }

  /* `base` defaults to the configured watermarks service; the rewrite proxy
   * passes its own same-origin prefix. `auth` must be false for anything other
   * than that service — otherwise the service's bearer token would be sent to
   * an unrelated endpoint. `signal` lets the caller cancel before the timeout. */
  async function request(method, path, body, { timeoutMs = 120000, base = null, auth = true, signal = null } = {}) {
    const baseUrl = base === null ? config.baseUrl : base;
    if (base === null && !config.baseUrl) throw new ApiError("no server configured", 0);
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    let res, payload = null;
    try {
      // Same-origin whenever the combined path is absolute — covers "/api",
      // "/llm" and the bare "" base used by /llm-config alike.
      const url = baseUrl + path;
      const origin = url.startsWith("/") && root.location ? root.location.origin : "";
      res = await fetch(origin + url, {
        method, headers: headers(!!body, auth), body: body ? JSON.stringify(body) : undefined,
        mode: "cors", cache: "no-store", signal: ctrl.signal,
      });
      // fetch settles once the headers land, so the body can still be pending
      // here. The timeout and the caller's signal stay armed until it is read,
      // or a server that flushes headers early would be uncancellable.
      try {
        payload = await res.json();
      } catch (e) {
        if (e.name === "AbortError") throw e;   // cancelled mid-body, not a parse failure
        /* non-JSON body — payload stays null */
      }
    } catch (e) {
      if (e.name === "AbortError") throw new ApiError(timedOut ? "request timed out" : "cancelled", 0);
      throw new ApiError("network/CORS error — is the server running and allowing this origin?", 0);
    } finally {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", abort);
    }
    if (!res.ok || (payload && payload.ok === false)) {
      const msg = (payload && payload.error) || `HTTP ${res.status}`;
      throw new ApiError(msg, res.status);
    }
    return payload;
  }

  class ApiError extends Error {
    constructor(message, status) { super(message); this.name = "ApiError"; this.status = status; }
  }

  function bytesToBase64(u8) {
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  const api = {
    DEFAULT_URL, config, load, save, normalizeUrl, ApiError, bytesToBase64, base64ToBytes,
    health: () => request("GET", "/health", null, { timeoutMs: 5000 }),
    capabilities: () => request("GET", "/capabilities", null, { timeoutMs: 5000 }),
    inspect: (u8, name) => request("POST", "/inspect", { file: bytesToBase64(u8), name }),
    clean: (u8, name, options) => request("POST", "/clean", { file: bytesToBase64(u8), name, options: options || {} }),

    /* Optional AI rewrite. Only serve_local.py answers these: /llm-config says
     * whether an endpoint is configured, /llm proxies to it. Both are
     * same-origin and never carry the watermarks service's API key. */
    llmConfig: () => request("GET", "/llm-config", null, { base: "", auth: false, timeoutMs: 3000 }),
    llmModels: () => request("GET", "/v1/models", null, { base: "/llm", auth: false, timeoutMs: 5000 }),
    llmRewrite: (systemPrompt, text, model, signal) => request("POST", "/v1/chat/completions", {
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }],
      stream: false,
      temperature: 0.3,
    }, { base: "/llm", auth: false, timeoutMs: 300000, signal }),
  };
  root.WmApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
