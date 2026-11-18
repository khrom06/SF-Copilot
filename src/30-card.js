/* ==================================================================== CARD */
/*
 * custom:sf-copilot-card — reads the logbook, finds the habits (10-engine.js) and proposes automations with their evidence.
 * Nothing is created without a person asking, and a real automation only ever comes after a dry run: "Dry run" creates an automation that
 * only writes in the logbook what it would have done; once it has run for `trial_days` days AND has acted at least once, "Create it for
 * real" (two presses) replaces it by the real one. Both are ordinary automations, visible and editable in Settings → Automations.
 * Unlocking, opening covers and garage / gate / door covers are never proposed unless `allow` says so (see sfcpRisk in 20-automation.js).
 * Only a user whose is_admin is exactly true gets buttons; the server (Home Assistant) is what really refuses the others.
 *
 * type: custom:sf-copilot-card
 * days: 21                 # history analysed (7 to 60)
 * exclude: [light.x]       # entities never proposed
 * physical: false          # true: changes with no context at all (wall switches…) count as manual actions
 * trial_days: 7            # how long a dry run must have run before it can become real (1 to 30)
 * require_trial: true      # false: lets "Create" skip the dry run (not recommended)
 * allow: []                # [unlock, open_cover, access]: actions that are blocked by default
 * max: 8                   # proposals shown
 * theme: dark | light | auto
 */
const SFCP_SEL = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const SFCP_OWN = /^sf_copilot_(trial_)?[a-z0-9]+$/;
const SFCP_CTX_CLASSES = ["door", "window", "opening", "garage_door", "motion", "occupancy", "presence"];
class SfCopilotCard extends HTMLElement {
  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("sf-copilot-card: config required");
    const n = (v, d, lo, hi) => { const x = Number(v); return isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
    this._config = { days: n(config.days, 21, 7, 60), max: n(config.max, 8, 1, 30), physical: config.physical === true, trial_days: n(config.trial_days, 7, 1, 30), require_trial: config.require_trial !== false,
      allow: (Array.isArray(config.allow) ? config.allow : []).filter((x) => SFCP_ALLOW.includes(x)), theme: ["dark", "light", "auto"].includes(config.theme) ? config.theme : "auto",
      exclude: (Array.isArray(config.exclude) ? config.exclude : config.exclude ? [config.exclude] : []).filter((x) => typeof x === "string" && SFCP_SEL.test(x)) };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._res = null; this._err = null; this._render();
    if (this._hass && this.isConnected) this._scan();
  }
  set hass(h) {
    const first = !this._hass; this._hass = h;
    if (first && this._config && this.isConnected) this._scan();
    if (first && !this._ignored) this._loadIgnored();
    // only re-render when what is shown can change (automations created or triggered, language, theme), not on every state change
    const sig = this._sig();
    if (sig !== this._lastSig) { this._lastSig = sig; this._render(); this._loadSince(); }
  }
  get hass() { return this._hass; }
  connectedCallback() { if (this._hass && this._config && !this._res && !this._busy) this._scan(); this._render(); }
  disconnectedCallback() { if (this._armT) { clearTimeout(this._armT); this._armT = null; } this._armed = null; }
  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6 }; }
  static getStubConfig() { return { days: 21 }; }

  get _lang() { const h = this._hass, l = String((h && ((h.locale && h.locale.language) || h.language)) || "en").slice(0, 2); return l in SFCP_T ? l : "en"; }
  _t(k, v) { return sfcpTr(this._lang, k, v); }
  _esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  _name(id) { const s = this._hass && this._hass.states[id]; return String((s && s.attributes.friendly_name) || String(id).split(".")[1].replace(/_/g, " ")); }
  _theme() { const t = this._config.theme; return t === "light" ? "light" : t === "dark" ? "dark" : this._hass && this._hass.themes && this._hass.themes.darkMode === false ? "light" : "dark"; }
  // Automations already made from a proposal: their ids carry the proposal id.
  _made() {
    const out = {}; if (!this._hass) return out;
    for (const [eid, s] of Object.entries(this._hass.states)) {
      if (!eid.startsWith("automation.")) continue; const m = /^sf_copilot_(trial_)?([a-z0-9]+)$/.exec(String(s.attributes.id || "")); if (!m) continue;
      (out[m[2]] = out[m[2]] || {})[m[1] ? "trial" : "real"] = { entity: eid, id: s.attributes.id, last: s.attributes.last_triggered, since: s.last_changed, state: s.state };
    }
    return out;
  }
  _sig() { if (!this._hass) return ""; const m = this._made(); return [this._lang, this._theme(), this._admin(), !!this._hass.user, JSON.stringify(m)].join("|"); }

  // Fail closed: only an explicit is_admin === true is an administrator. (This only decides what the card SHOWS: Home Assistant itself
  // refuses config/automation/config to non-administrators, @require_admin on GET, POST and DELETE.)
  _admin() { const u = this._hass && this._hass.user; return !!u && u.is_admin === true; }
  _policy() { const h = this._hass; return { allow: this._config.allow, dc: (id) => { const s = h && h.states && h.states[id]; return s && s.attributes ? s.attributes.device_class : undefined; } }; }

  // ---------------------------------------------------------------- data
  async _ws(msg) { return this._hass.callWS(msg); }
  async _scan() {
    if (this._busy || !this._hass || !this._hass.callWS) return;
    this._busy = true; this._err = null; this._autos = null; this._cov = null; this._step = this._t("loading"); this._render();
    try {
      const h = this._hass, ex = new Set(this._config.exclude), reg = h.entities || {}, now = Date.now(), t0 = now - this._config.days * SFCP_DAY;
      const visible = (id) => !ex.has(id) && !(reg[id] && (reg[id].hidden || reg[id].entity_category));
      const act = Object.keys(h.states).filter((id) => SFCP_STATES[sfcpDomain(id)] && visible(id));
      const ctx = Object.keys(h.states).filter((id) => visible(id) && (sfcpDomain(id) === "person" || (sfcpDomain(id) === "binary_sensor" && SFCP_CTX_CLASSES.includes(h.states[id].attributes.device_class))));
      const humans = new Set(Object.values(h.states).filter((s) => s.entity_id.startsWith("person.") && s.attributes.user_id).map((s) => s.attributes.user_id));
      const log = async (ids, from) => { const out = []; for (let i = 0; i < ids.length; i += 60) { const r = await this._ws({ type: "logbook/get_events", start_time: new Date(from).toISOString(), end_time: new Date(now).toISOString(), entity_ids: ids.slice(i, i + 60) }); if (Array.isArray(r)) out.push(...r); } return out; };
      // 1. two days of everything, to leave out the entities that change all the time (screensavers, chargers polling…): never habits,
      //    and they would make the full request heavy
      const rate = {}; for (const x of await log([...act, ...ctx], now - 2 * SFCP_DAY)) if (x && x.entity_id) rate[x.entity_id] = (rate[x.entity_id] || 0) + 1;
      const keepA = act.filter((id) => (rate[id] || 0) / 2 <= 40), keepC = ctx.filter((id) => (rate[id] || 0) / 2 <= 150);
      this._step = this._t("loading2", { n: keepA.length + keepC.length }); this._render();
      // 2. the whole period for the rest
      const all = await log([...keepA, ...keepC], t0), ctxSet = new Set(keepC), events = [], contexts = [];
      // how the changes were classified, and why: what people see when "nothing is found" because nobody is linked to a person
      const diag = { humans: humans.size, me: !!(h.user && humans.has(h.user.id)), cause: { human: 0, auto: 0, physical: 0 }, why: {}, unlinked: new Set() };
      for (const x of all) {
        if (!x || typeof x.entity_id !== "string" || typeof x.state !== "string" || !isFinite(x.when)) continue;
        const t = x.when * 1000;
        if (ctxSet.has(x.entity_id)) contexts.push({ e: x.entity_id, s: x.state, t });
        else { const w = sfcpWhy(x, humans); events.push({ e: x.entity_id, s: x.state, t, cause: w.cause });
          if ((SFCP_STATES[sfcpDomain(x.entity_id)] || []).includes(x.state)) { diag.cause[w.cause]++; diag.why[w.why] = (diag.why[w.why] || 0) + 1; if (w.why === "unlinked_user") diag.unlinked.add(x.context_user_id); } }
      }
      this._diag = diag;
      const cfg = h.config || {};
      this._data = { events, contexts, t0, t1: now, lat: cfg.latitude, lon: cfg.longitude };
      this._analyze();
    } catch (e) { this._err = String((e && (e.message || e.code)) || e).slice(0, 200); }
    this._busy = false; this._render();
    this._loadAutos().then((r) => r && this._relate().then(() => { this._cover(); this._render(); }), () => {});
  }
  // When each dry run started, from the automation's own description (administrators only: reading it is an admin API). Cached; forgotten when the trial goes.
  async _loadSince() {
    if (!this._hass || !this._admin() || this._sinceBusy) return;
    const trials = Object.entries(this._made()).filter(([, m]) => m.trial).map(([id]) => id); this._since = this._since || {};
    for (const id of Object.keys(this._since)) if (!trials.includes(id)) delete this._since[id];
    const todo = trials.filter((id) => !(id in this._since)); if (!todo.length) return;
    this._sinceBusy = true;
    for (const id of todo) { try { const c = await this._get(`sf_copilot_trial_${id}`); this._since[id] = sfcpTrialSince(c && c.description); } catch (e) { this._since[id] = null; } }
    this._sinceBusy = false; this._render();
  }
  // Existing automations, read once per scan (administrators only: the config API is admin-only), to tell what a proposal would duplicate.
  // Reads at most 400, six at a time; the ones without an id (YAML) cannot be read and are counted, never guessed.
  async _loadAutos(fresh) {
    if (!this._hass || !this._admin()) return null;
    if (this._autos && !fresh) return this._autos;
    const h = this._hass, list = Object.values(h.states).filter((s) => s.entity_id.startsWith("automation.")), items = [];
    const hasId = (s) => typeof s.attributes.id === "string" && s.attributes.id, mine = list.filter((s) => hasId(s) && !SFCP_OWN.test(s.attributes.id)), todo = mine.slice(0, 400);
    const lost = new Set([...list.filter((s) => !hasId(s)), ...mine.slice(400)].map((s) => s.entity_id)); let i = 0;
    const worker = async () => { while (i < todo.length) { const s = todo[i++]; try { const c = await this._get(s.attributes.id); if (c) items.push({ entity_id: s.entity_id, id: s.attributes.id, alias: s.attributes.friendly_name || (c && c.alias) || s.entity_id, off: s.state === "off", config: c }); else lost.add(s.entity_id); } catch (e) { lost.add(s.entity_id); } } };
    await Promise.all(Array.from({ length: 6 }, worker));
    const r = { items, unread: lost.size, lost, n: items.length }; if (!fresh) this._autos = r; return r;
  }
  _reg() { const h = this._hass; return (id) => { const e = h && h.entities && h.entities[id], d = e && e.device_id && h.devices && h.devices[e.device_id]; return { device_id: e && e.device_id, area_id: (e && e.area_id) || (d && d.area_id) }; }; }
  // Automations that cannot be read (written in YAML files, packages…) are still found through Home Assistant's own "related" search, and
  // reported as "maybe": we know they touch the entity, not what they do.
  async _relate() {
    if (!this._autos || !this._res || !this._hass.callWS) return; this._rel = this._rel || {};
    const ents = [...new Set(this._res.proposals.map((p) => p.entity))].filter((e) => !(e in this._rel) && this._autos.lost.size);
    for (const e of ents) { try { const r = await this._ws({ type: "search/related", item_type: "entity", item_id: e }); this._rel[e] = r && Array.isArray(r.automation) ? r.automation.filter((x) => typeof x === "string") : []; } catch (err) { this._rel[e] = []; } }
  }
  _cover() {
    if (!this._autos || !this._res) return; this._cov = {};
    for (const p of this._res.proposals) {
      const c = this._cov[p.id] = sfcpOverlap(p, this._autos.items, { reg: this._reg() }), st = this._hass.states;
      for (const a of (this._rel && this._rel[p.entity]) || []) if (this._autos.lost.has(a) && !SFCP_OWN.test(String((st[a] && st[a].attributes.id) || ""))) c.unknown.push({ entity_id: a, alias: String((st[a] && st[a].attributes.friendly_name) || a), off: !!(st[a] && st[a].state === "off") });
    }
  }
  // Habits from the history read once: "less clear habits" only loosens the thresholds, it does not read the history again.
  // Loose = 4 days instead of 5, half of the days instead of 60 %, one time in two after an event instead of 60 %.
  _analyze() {
    if (!this._data) return;
    const loose = !!this._loose, options = { physical: this._config.physical, max: 30, ...(loose ? { minDays: 4, support: 0.45, confidence: 0.5 } : {}) };
    this._res = sfcpAnalyze({ ...this._data, options }); this._res.at = this._data.t1; this._res.loose = loose; this._cover(); if (this._autos && this._rel) this._relate().then(() => { this._cover(); this._render(); });
  }
  // Ignored proposals: per Home Assistant user (frontend user data, follows the person on every device), browser storage as a fallback.
  async _loadIgnored() {
    this._ignored = new Set();
    try { const r = await this._ws({ type: "frontend/get_user_data", key: "sf_copilot" }); const v = r && r.value; if (v && Array.isArray(v.ignored)) this._ignored = new Set(v.ignored.filter((x) => typeof x === "string").slice(0, 500)); }
    catch (e) { try { const v = JSON.parse(localStorage.getItem("sf-copilot-ignored") || "[]"); if (Array.isArray(v)) this._ignored = new Set(v.filter((x) => typeof x === "string")); } catch (e2) { /* no storage */ } }
    this._render();
  }
  async _saveIgnored() {
    const v = [...this._ignored].slice(-500);
    try { await this._ws({ type: "frontend/set_user_data", key: "sf_copilot", value: { ignored: v } }); }
    catch (e) { try { localStorage.setItem("sf-copilot-ignored", JSON.stringify(v)); } catch (e2) { /* no storage */ } }
  }

  // ---------------------------------------------------------------- texts
  _verb(p) {
    const d = sfcpDomain(p.entity), s = p.state;
    if (d === "input_boolean") return this._t(s === "on" ? "ib_on" : "ib_off");
    if (d === "climate" && s !== "off") { let m = s; try { if (this._hass.formatEntityState && this._hass.states[p.entity]) m = this._hass.formatEntityState(this._hass.states[p.entity], s); } catch (e) { /* raw */ } return this._t("mode", { m }); }
    return this._t(s);
  }
  _hm(min) { const d = new Date(); d.setHours(Math.floor(min / 60), Math.round(min % 60), 0, 0); try { return new Intl.DateTimeFormat(this._hass.locale && this._hass.locale.language || this._lang, { hour: "2-digit", minute: "2-digit" }).format(d); } catch (e) { return sfcpHHMM(min).slice(0, 5); } }
  _state(id, s) { const so = this._hass.states[id]; try { if (so && this._hass.formatEntityState) return String(this._hass.formatEntityState(so, s)); } catch (e) { /* raw */ } return s; }
  _sentence(p) {
    const a = this._verb(p), name = this._name(p.entity), scope = this._t(p.scope || "all");
    if (p.type === "time") return this._t("at", { a, name, h: this._hm(p.at), scope });
    if (p.type === "sun") { const ev = this._t(p.sun.event), n = Math.abs(p.sun.offset); return this._t(n === 0 ? "sun_at" : p.sun.offset < 0 ? "sun_before" : "sun_after", { a, name, n, ev, scope }); }
    if (p.type === "follow") return this._t("follow", { a, name, tname: this._name(p.trigger.entity), ts: this._state(p.trigger.entity, p.trigger.state) }) + (p.band ? this._t("band", { f: this._hm(p.band.from), t: this._hm(p.band.to) }) : "");
    return this._t("duration", { name, n: p.after });
  }
  _evidence(p) {
    if (p.type === "time" || p.type === "sun") return this._t("ev_time", { h: p.hits, t: p.total, s: Math.max(1, Math.round(p.spread / 2)) });
    if (p.type === "follow") return this._t("ev_follow", { h: p.hits, t: p.total, d: p.delay });
    return this._t("ev_duration", { h: p.hits, lo: p.low, hi: p.high });
  }
  _ago(iso) {
    const t = Date.parse(iso || ""); if (!isFinite(t)) return "";
    const m = Math.round((Date.now() - t) / 60000); if (m < 1) return this._t("ago_now"); if (m < 60) return this._t("ago_min", { n: m });
    const hh = Math.round(m / 60); return hh < 48 ? this._t("ago_h", { n: hh }) : this._t("ago_d", { n: Math.round(hh / 24) });
  }
  _cfg(p, mode, since) { const s = this._sentence(p); return sfcpAutomation(p, { alias: this._t("alias", { s }), description: this._t("desc", { e: this._evidence(p) }), trial: this._t("trialMsg", { s }), since: since ? new Date(since).toISOString() : "" }, mode, this._policy()); }

  // ---------------------------------------------------------------- actions
  async _get(id) { try { return await this._hass.callApi("GET", `config/automation/config/${id}`); } catch (e) { if (e && e.status_code === 404) return null; throw e; } }
  // Is the dry run of `p` old enough and has it acted? Read from Home Assistant at the moment of the call, never from what the card showed.
  async _trialVerdict(p) {
    const m = this._made()[p.id], t = m && m.trial; if (!t) return this._t("trialFirst");
    const cfg = await this._get(`sf_copilot_trial_${p.id}`), since = sfcpTrialSince(cfg && cfg.description); if (since === null) return this._t("trialUnknown");
    this._since = this._since || {}; this._since[p.id] = since;
    const days = this._config.trial_days, left = Math.ceil((since + days * SFCP_DAY - Date.now()) / SFCP_DAY);
    if (left > 0) return this._t("trialYoung", { n: days });
    if (t.state !== "on") return this._t("trialOff");
    if (!(Date.parse(t.last || "") >= since)) return this._t("trialSilent");
    return "";
  }
  // The only place that writes. Fails closed: unknown admin status, blocked action, existing automation, dry run missing or too young.
  async _save(p, mode) {
    if (!this._admin()) throw new Error(this._hass && this._hass.user ? this._t("noAdmin") : this._t("noAdminUnknown"));
    const since = mode === "trial" ? Date.now() : 0, cfg = this._cfg(p, mode, since); if (!cfg) throw new Error(this._t("blocked"));
    const id = `sf_copilot_${mode === "trial" ? "trial_" : ""}${p.id}`;
    if (mode === "real" && this._config.require_trial) { const why = await this._trialVerdict(p); if (why) throw new Error(why); }
    if (mode === "real") {   // an automation made since the proposal appeared may already do the same: read them again, now
      const fresh = await this._loadAutos(true), dup = fresh && sfcpOverlap(p, fresh.items, { reg: this._reg() }).duplicate.find((d) => !d.off);
      if (dup) throw new Error(this._t("coveredErr", { a: dup.alias }));
    }
    if (await this._get(id)) throw new Error(this._t("exists"));   // never replace an automation that is already there (maybe edited by hand)
    await this._hass.callApi("POST", `config/automation/config/sf_copilot_${mode === "trial" ? "trial_" : ""}${p.id}`, cfg);
    if (mode === "trial") { this._since = this._since || {}; this._since[p.id] = since; }
  }
  async _do(kind, p, btn) {
    if (!p || this._doing) return;
    // creating for real needs two presses within 4 s (the trial and the rest are harmless and can be undone in one press)
    if ((kind === "create" || kind === "promote") && !(this._armed === `${kind}|${p.id}`)) {
      this._armed = `${kind}|${p.id}`; if (this._armT) clearTimeout(this._armT);
      this._armT = setTimeout(() => { this._armed = null; this._armT = null; this._render(); }, 4000); this._render(); return;
    }
    this._armed = null; if (this._armT) { clearTimeout(this._armT); this._armT = null; }
    this._doing = p.id; this._fail = null; this._render();
    const made = this._made()[p.id] || {};
    try {
      if (kind !== "ignore" && !this._admin()) throw new Error(this._hass.user ? this._t("noAdmin") : this._t("noAdminUnknown"));   // permissions can change after the card was loaded
      if (kind === "trial") await this._save(p, "trial");
      else if (kind === "stop" && made.trial && SFCP_OWN.test(made.trial.id)) await this._hass.callApi("DELETE", `config/automation/config/${made.trial.id}`);
      else if (kind === "create") await this._save(p, "real");
      else if (kind === "promote") { await this._save(p, "real"); if (made.trial && SFCP_OWN.test(made.trial.id)) await this._hass.callApi("DELETE", `config/automation/config/${made.trial.id}`); }
      else if (kind === "ignore") { this._ignored = this._ignored || new Set(); this._ignored.add(p.id); await this._saveIgnored(); }
    } catch (e) { this._fail = { id: p.id, msg: String((e && (e.body && e.body.message || e.message)) || e).slice(0, 160) }; }
    this._doing = null; this._render();
  }
  // Why a dry run cannot be promoted yet ("" when it can). Display only: _save asks Home Assistant again before writing anything.
  _left(p, m) {
    if (!this._config.require_trial || !m.trial) return "";
    const since = this._since && this._since[p.id]; if (!since) return this._t("trialUnknown");
    const left = Math.ceil((since + this._config.trial_days * SFCP_DAY - Date.now()) / SFCP_DAY);
    if (left > 0) return this._t("trialLeft", { n: left });
    if (m.trial.state !== "on") return this._t("trialOff");
    return Date.parse(m.trial.last || "") >= since ? "" : this._t("trialNeverActed");
  }
  _more(entityId) { const ev = new Event("hass-more-info", { bubbles: true, composed: true }); ev.detail = { entityId }; this.dispatchEvent(ev); }

  // ---------------------------------------------------------------- render
  _render() {
    if (!this.shadowRoot || !this._config) return;
    const th = this._theme(); if (this.getAttribute("theme") !== th) this.setAttribute("theme", th);
    const head = (sub) => `<div class="head"><span>${this._esc(this._t("title"))}</span><span class="sub">${sub}</span></div>`;
    let body = "";
    if (!this._hass) body = `<div class="msg">${this._esc(this._t("loading"))}</div>`;
    else if (this._err) body = `<div class="msg err" role="alert">${this._esc(this._t("error", { e: this._err }))}</div><div class="acts" style="margin-left:0"><button data-k="rescan">${this._esc(this._t("retry"))}</button></div>`;
    else if (!this._res) body = `<div class="msg" role="status">${this._esc(this._step || this._t("loading"))}</div>`;
    else {
      const made = this._made(), ign = this._ignored || new Set(), admin = this._admin(), policy = this._policy();
      const known = this._res.proposals.filter((p) => sfcpAction(p.entity, p.state) && this._hass.states[p.entity]), risk = (p) => sfcpRisk(p.entity, p.state, policy);
      const cov = (p) => (this._cov && this._cov[p.id]) || { duplicate: [], overlap: [], unknown: [] }, active = (p) => cov(p).duplicate.filter((d) => !d.off);
      const safe = known.filter((p) => risk(p).level !== "blocked"), blocked = known.filter((p) => risk(p).level === "blocked");
      const covered = safe.filter((p) => active(p).length && !made[p.id]), all = safe.filter((p) => !covered.includes(p));
      const shown = all.filter((p) => !ign.has(p.id) || made[p.id]).slice(0, this._config.max), nIgn = all.filter((p) => ign.has(p.id) && !made[p.id]).length;
      const st = this._res.stats;
      if (!shown.length) body = `<div class="msg">${this._esc(this._t(this._res.loose ? "emptyLoose" : "empty"))}<br>${this._esc(st.days < 5 ? this._t("emptyFew", { m: 5 }) : this._t("emptyWhy", { n: st.actions, d: st.days }))}</div>`;
      for (const p of shown) {
        const m = made[p.id] || {}, cls = m.real ? "done" : m.trial ? "trial" : "", busy = this._doing === p.id, dis = busy || !!this._doing ? " disabled" : "";
        const icon = { time: "mdi:clock-outline", sun: p.sun && p.sun.event === "sunrise" ? "mdi:weather-sunset-up" : "mdi:weather-sunset-down", follow: "mdi:link-variant", duration: "mdi:timer-outline" }[p.type];
        const btn = (k, label, pri) => { const armed = this._armed === `${k}|${p.id}`; return `<button data-k="${k}" data-id="${this._esc(p.id)}" class="${armed ? "armed" : pri ? "pri" : ""}"${dis}>${this._esc(armed ? this._t("confirm") : label)}</button>`; };
        let acts = "";
        if (m.real) acts = `<button data-k="open" data-e="${this._esc(m.real.entity)}">${this._esc(this._t("open"))}</button>`;
        else if (!admin) acts = "";
        else if (m.trial) { const left = this._left(p, m); acts = (left ? "" : btn("promote", this._t("promote"), true)) + btn("stop", this._t("stop")); }
        else acts = btn("trial", this._t("trial"), this._config.require_trial) + (this._config.require_trial ? "" : btn("create", this._t("create"), true)) + btn("ignore", this._t("ignore"));
        const rk = risk(p), flag = rk.level === "sensitive" ? "riskSensitive" : rk.level === "notice" ? "riskNotice" : "";
        const cv = cov(p), names = (l) => l.map((d) => d.alias).slice(0, 3).join(", ");
        const ovl = [...(cv.duplicate.length ? [cv.duplicate] : []), ...(cv.overlap.length ? [cv.overlap] : [])].map((l) => `<div class="badge warn">⚠ ${this._esc(this._t("overlapBadge", { a: names(l) }))}</div>`).join("") + (cv.unknown.length ? `<div class="badge warn">⚠ ${this._esc(this._t("unknownBadge", { a: names(cv.unknown) }))}</div>` : "");
        const badge = ovl + (flag ? `<div class="badge warn">⚠ ${this._esc(this._t(flag))}</div>` : "") + (m.real ? `<div class="badge">✓ ${this._esc(this._t("created"))}</div>` : m.trial ? `<div class="badge">${this._esc(this._t("trying", { a: this._ago(m.trial.since) }))} · ${this._esc(m.trial.last ? this._t("wouldHave", { a: this._ago(m.trial.last) }) : this._t("neverYet"))}${admin && this._left(p, m) ? " · " + this._esc(this._left(p, m)) : ""}</div>` : "");
        const strip = p.days ? `<div class="strip" aria-hidden="true">${p.days.map((x) => `<i class="${x.st}"></i>`).join("")}</div>` : "";
        const yaml = sfcpYaml(this._cfg(p, "real") || {});
        body += `<div class="p ${cls}"><div class="ti"><ha-icon icon="${icon}"></ha-icon><span>${this._esc(this._sentence(p))}</span></div>
          <div class="ev">${this._esc(this._evidence(p))}</div>${strip}
          <div class="cf"><span>${this._esc(this._t("conf"))}</span><span class="tr"><b style="width:${Math.round(sfcpReliability(p.hits, p.total) * 100)}%"></b></span><span>${Math.round(sfcpReliability(p.hits, p.total) * 100)} %</span></div>
          ${badge}${this._fail && this._fail.id === p.id ? `<div class="badge err" role="alert">${this._esc(this._t("failed", { e: this._fail.msg }))}</div>` : ""}
          ${acts ? `<div class="acts">${acts}</div>` : ""}<details><summary>${this._esc(this._t("yaml"))}</summary><pre>${this._esc(yaml)}</pre></details></div>`;
      }
      const notes = [];
      if (covered.length) notes.push(`<span role="status">${this._esc(this._t("coveredN", { n: covered.length }))}<br>${covered.map((p) => `${this._esc(this._sentence(p))} → ${this._esc(active(p).map((d) => d.alias).slice(0, 3).join(", "))}`).join("<br>")}</span>`);
      if (this._autos && (this._autos.unread || this._autos.n)) notes.push(`<span>${this._esc(this._t("autosInfo", { n: this._autos.n, s: this._autos.unread }))}</span>`);
      if (blocked.length) notes.push(`<span role="status">${this._esc(this._t("blockedN", { n: blocked.length }))}<br>${blocked.map((p) => this._esc(this._sentence(p))).join("<br>")}</span>`);
      if (!admin && shown.length) notes.push(`<span>${this._esc(this._t(this._hass.user ? "noAdmin" : "noAdminUnknown"))}</span>`);
      const dg = this._diag;
      if (dg) {
        const warn = dg.humans === 0 ? "diagNoPerson" : !dg.me && this._hass.user ? "diagMe" : "";
        if (warn) notes.push(`<span role="alert">${this._esc(this._t(warn))}</span>`);
        const rows = ["human", "automation", "script", "unlinked_user", "physical", "other"].filter((k) => dg.why[k]).map((k) => `${dg.why[k]} ${this._t("why_" + k)}`);
        notes.push(`<details class="diag"><summary>${this._esc(this._t("diag", { h: dg.cause.human, a: dg.cause.auto, p: dg.cause.physical }))}</summary><div>${this._esc(this._t("diagTitle"))} :<br>${rows.map((r) => this._esc(r)).join("<br>")}${dg.unlinked.size ? "<br>" + this._esc(this._t("diagUnlinked", { n: dg.why.unlinked_user || 0 })) : ""}${!this._config.physical && dg.why.physical ? "<br>" + this._esc(this._t("physIgnored")) : ""}</div></details>`);
      }
      if (nIgn) notes.push(`<span>${this._esc(this._t("ignored", { n: nIgn }))} · <button data-k="unignore">${this._esc(this._t("showAll"))}</button></span>`);
      notes.push(`<span><button data-k="loose">${this._esc(this._t(this._res.loose ? "strict" : "loose"))}</button> <button data-k="rescan"${this._busy ? " disabled" : ""}>${this._esc(this._t("rescan"))}</button></span>`);
      body += `<div class="foot">${notes.join("")}</div>`;
    }
    const sub = this._res ? this._esc(this._t("sub", { d: this._config.days, n: this._res.stats.actions })) : "";
    const html = `<style>${SFCP_CSS}</style><div class="hud"><i class="c tl"></i><i class="c br"></i>${head(sub)}${body}</div>`;
    if (html === this._html) return;
    // keep the open "show the automation" panels across re-renders
    const open = new Set([...this.shadowRoot.querySelectorAll("details[open]")].map((d) => d.closest(".p") && d.closest(".p").querySelector("[data-id]") && d.closest(".p").querySelector("[data-id]").dataset.id).filter(Boolean));
    this._html = html; this.shadowRoot.innerHTML = html;
    this.shadowRoot.querySelectorAll(".p").forEach((el) => { const b = el.querySelector("[data-id]"); if (b && open.has(b.dataset.id)) el.querySelector("details").open = true; });
    this.shadowRoot.querySelectorAll("button[data-k]").forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation(); const k = b.dataset.k;
      if (k === "rescan") { this._res = null; this._data = null; this._scan(); return; }
      if (k === "loose") { this._loose = !this._loose; this._analyze(); this._render(); return; }
      if (k === "unignore") { this._ignored = new Set(); this._saveIgnored(); this._render(); return; }
      if (k === "open") { this._more(b.dataset.e); return; }
      const p = this._res && this._res.proposals.find((x) => x.id === b.dataset.id); this._do(k, p, b);
    }));
  }
}
if (!customElements.get("sf-copilot-card")) customElements.define("sf-copilot-card", SfCopilotCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "sf-copilot-card")) window.customCards.push({ type: "sf-copilot-card", name: "SF · Copilot", description: "Finds your manual habits in the history and proposes the automations, with their evidence, a mandatory dry run and a validated creation." });
