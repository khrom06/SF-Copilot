/* ================================================================== ENGINE */
/*
 * Habit detection, with no DOM and no Home Assistant object: plain functions over a list of state changes, so that every rule can be
 * tested on its own (test/engine.test.mjs) and explained to the person reading the proposal.
 *
 * The engine never decides anything for the house. It returns PROPOSALS, each with the facts it rests on:
 *   - time      "on 10 of the last 12 weekday evenings you turned X on around 19:25"        -> trigger at a time (or relative to sunset / sunrise)
 *   - follow    "9 times out of 10, within 2 minutes after the door opens, you turn X on"    -> trigger on that event
 *   - duration  "you switched X off by hand 17 times, usually 40 to 50 minutes after it came on" -> switch off after a delay
 *
 * A change counts as a manual action when a person did it through Home Assistant (see sfcpCause), never when an automation, a script or a
 * service account did: what is already automated is not a habit to automate. Changes without any context (a wall switch, but just as often an
 * integration syncing or a device coming back online) only count with `physical: true`.
 */
const SFCP_DAY = 86400000;
const SFCP_DEFAULTS = { minDays: 5, support: 0.6, tolerance: 30, follow: 120, followPerson: 600, confidence: 0.6, max: 12 };
// Meaningful target states per domain: an action is a change INTO one of these, from another one of them.
const SFCP_STATES = { light: ["on", "off"], switch: ["on", "off"], fan: ["on", "off"], input_boolean: ["on", "off"], cover: ["open", "closed"], lock: ["locked", "unlocked"],
  climate: ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"] };
// Events that can start something (triggers of a "follow" habit), besides the manual actions themselves.
const SFCP_CONTEXT = { binary_sensor: ["on", "off"], person: ["home", "not_home"], media_player: ["on", "off", "playing"], device_tracker: ["home", "not_home"] };

// Who caused a logbook entry: "human" = a person (one of `humans`, the user ids of the person entities) called a service directly from a
// dashboard, the app or voice; "auto" = an automation, a script (even one a person started: its timing is the script's), a service account
// (Node-RED, AppDaemon… run as system users) or anything else with a context; "physical" = no context at all.
function sfcpWhy(x, humans) {
  if (!x || typeof x !== "object") return { cause: "auto", why: "other" };
  const u = x.context_user_id, et = x.context_event_type, dom = x.context_domain;
  if (!u && !et && !dom) return { cause: "physical", why: "physical" };
  if (dom === "script") return { cause: "auto", why: "script" };
  if (dom === "automation" || et === "automation_triggered") return { cause: "auto", why: "automation" };
  if (u && et === "call_service") return humans && humans.has(u) ? { cause: "human", why: "human" } : { cause: "auto", why: "unlinked_user" };   // a user id that no person.* entity points to
  return { cause: "auto", why: "other" };
}
function sfcpCause(x, humans) { return sfcpWhy(x, humans).cause; }
function sfcpDomain(id) { return String(id).split(".")[0]; }
function sfcpLocalDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function sfcpMinute(ms) { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
function sfcpWeekend(ms) { const g = new Date(ms).getDay(); return g === 0 || g === 6; }
function sfcpQuantile(sorted, q) { if (!sorted.length) return NaN; const p = (sorted.length - 1) * q, a = Math.floor(p), b = Math.ceil(p); return sorted[a] + (sorted[b] - sorted[a]) * (p - a); }
function sfcpStd(v) { if (v.length < 2) return 0; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length); }
// Reliability shown to people: the lower bound of the Wilson interval (80 %), so that 4 times out of 4 does not read as "100 %" while 18
// times out of 20 stays high. Thresholds use the raw ratio; only what is displayed is cautious.
function sfcpReliability(hits, total) {
  const n = Number(total), p = n > 0 ? Math.min(1, Math.max(0, Number(hits) / n)) : 0, z = 1.2816;
  if (!(n > 0)) return 0;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}
function sfcpHash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }

// Sunrise and sunset (ms, UTC) of the local day that contains `ms`. Standard solar position formulas; within about two minutes, which is
// far below the spread of a human habit. Returns null near the poles when the sun does not rise or set that day.
function sfcpSun(ms, lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const rad = Math.PI / 180, noon = sfcpLocalDay(ms) + SFCP_DAY / 2, d = noon / SFCP_DAY - 0.5 + 2440588 - 2451545;
  const lw = rad * -lon, phi = rad * lat, n = Math.round(d - 0.0009 - lw / (2 * Math.PI)), ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds), C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)), L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397)), jNoon = 2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosW = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW), jSet = 2451545 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L), jRise = jNoon - (jSet - jNoon);
  const toMs = (j) => (j + 0.5 - 2440588) * SFCP_DAY;
  return { sunrise: toMs(jRise), sunset: toMs(jSet) };
}

// Changes -> actions. `events` are raw state changes { e: entity_id, s: state, t: ms, cause: "human" | "physical" | "auto" }, in any order.
// Returns { actions: manual changes into a meaningful state, changes: every such change whatever its cause }.
function sfcpActions(events, opts) {
  const manual = new Set(opts && opts.physical === true ? ["human", "physical"] : ["human"]), per = new Map();
  for (const x of events) { if (!x || typeof x.e !== "string" || !isFinite(x.t)) continue; const a = per.get(x.e) || []; a.push(x); per.set(x.e, a); }
  const actions = [], changes = [];
  for (const [e, list] of per) {
    const ok = SFCP_STATES[sfcpDomain(e)]; if (!ok) continue;
    list.sort((a, b) => a.t - b.t);
    let prev = null;
    for (const x of list) {
      if (!ok.includes(x.s)) continue;   // unavailable, unknown, opening… are not states somebody chose: they neither count nor reset
      if (prev !== null && prev !== x.s) { const c = { e, s: x.s, t: x.t, cause: x.cause || "auto", from: prev }; changes.push(c); if (manual.has(c.cause)) actions.push(c); }
      prev = x.s;
    }
  }
  actions.sort((a, b) => a.t - b.t); changes.sort((a, b) => a.t - b.t);
  return { actions, changes };
}

// Local days fully inside the observed period [t0, t1] (the first and last partial days would bias "x days out of y").
function sfcpDays(t0, t1) {
  const out = []; let d = sfcpLocalDay(t0); if (d < t0) { const n = new Date(d); n.setDate(n.getDate() + 1); d = n.getTime(); }
  for (let k = 0; k < 400; k++) { const n = new Date(d); n.setDate(n.getDate() + 1); if (n.getTime() > t1) break; out.push(d); d = n.getTime(); }
  return out;
}

// ---- 1. Same action around the same time of day (or the same offset to sunset / sunrise).
function sfcpTimeHabits(actions, days, o) {
  const out = [], dayset = new Set(days), byKey = new Map(), nWe = days.filter(sfcpWeekend).length, nWd = days.length - nWe;
  for (const a of actions) { const d = sfcpLocalDay(a.t); if (!dayset.has(d)) continue; const k = `${a.e}|${a.s}`, l = byKey.get(k) || []; l.push({ t: a.t, d, m: sfcpMinute(a.t), we: sfcpWeekend(a.t), cause: a.cause }); byKey.set(k, l); }
  for (const [key, all] of byKey) {
    if (new Set(all.map((x) => x.d)).size < o.minDays) continue;
    let rest = all.slice();
    for (let round = 0; round < 3 && rest.length >= o.minDays; round++) {
      // densest window of 2 x tolerance minutes, counted in distinct days; tried again with the clock shifted by 12 h so that a habit
      // around midnight is not cut in two
      let best = null;
      for (const shift of [0, 720]) {
        const pts = rest.map((x) => ({ x, m: (x.m + shift) % 1440 })).sort((a, b) => a.m - b.m);
        for (let i = 0, j = 0; i < pts.length; i++) {
          while (j < pts.length && pts[j].m - pts[i].m <= 2 * o.tolerance) j++;
          const win = pts.slice(i, j), nd = new Set(win.map((p) => p.x.d)).size;
          if (!best || nd > best.nd) best = { nd, win: win.map((p) => p.x), shift };
        }
      }
      if (!best || best.nd < o.minDays) break;
      const inWin = new Set(best.win), first = new Map();   // first occurrence of each day
      for (const x of best.win.slice().sort((a, b) => a.t - b.t)) if (!first.has(x.d)) first.set(x.d, x);
      rest = rest.filter((x) => !inWin.has(x));
      const occ = [...first.values()], hitWe = occ.filter((x) => x.we).length, hitWd = occ.length - hitWe;
      const supAll = occ.length / days.length, supWd = nWd ? hitWd / nWd : 0, supWe = nWe ? hitWe / nWe : 0;
      let scope = "";
      if (supAll >= o.support && (!nWe || !nWd || (hitWe > 0 && hitWd > 0 && Math.min(supWd, supWe) >= o.support * 0.6))) scope = "all";
      else if (supWd >= o.support && hitWd >= o.minDays) scope = "weekdays";
      else if (supWe >= o.support && hitWe >= Math.min(o.minDays, 4)) scope = "weekend";
      if (!scope) continue;
      { const mm = occ.map((x) => (x.m + best.shift) % 1440).sort((a, b) => a - b); if (sfcpQuantile(mm, 0.9) - sfcpQuantile(mm, 0.1) < 2) continue; }   // to the minute every day: a timer, not a person
      const used = occ.filter((x) => scope === "all" || (scope === "weekend") === x.we), elig = days.filter((d) => scope === "all" || (scope === "weekend") === sfcpWeekend(d));
      const ms = used.map((x) => (x.m + best.shift) % 1440).sort((a, b) => a - b), med = (sfcpQuantile(ms, 0.5) - best.shift + 1440) % 1440;
      const at = (Math.round(med / 5) * 5) % 1440, hitDays = new Set(used.map((x) => x.d)), [e, s] = key.split("|");
      const p = { type: "time", entity: e, state: s, scope, at, spread: Math.round(sfcpQuantile(ms, 0.9) - sfcpQuantile(ms, 0.1)), hits: used.length, total: elig.length,
        confidence: used.length / elig.length, days: days.map((d) => ({ d, st: !elig.includes(d) ? "na" : hitDays.has(d) ? "hit" : "miss" })), physical: used.filter((x) => x.cause === "physical").length };
      // Does the habit follow the sun better than the clock? (lights at dusk drift by more than an hour over a month)
      if (isFinite(o.lat) && isFinite(o.lon) && used.length >= o.minDays) {
        for (const ev of ["sunset", "sunrise"]) {
          const off = used.map((x) => { let best = NaN; for (const dd of [-1, 0, 1]) { const sun = sfcpSun(x.t + dd * SFCP_DAY, o.lat, o.lon); if (!sun) continue; const v = (x.t - sun[ev]) / 60000; if (!isFinite(best) || Math.abs(v) < Math.abs(best)) best = v; } return best; }).filter(isFinite);
          if (off.length !== used.length) continue;
          const sd = sfcpStd(off), sc = sfcpStd(ms), mo = sfcpQuantile(off.slice().sort((a, b) => a - b), 0.5);
          if (sd <= 20 && sd < sc * 0.6 && Math.abs(mo) <= 120 && (!p.sun || sd < p.sun.sd)) p.sun = { event: ev, offset: Math.round(mo / 5) * 5, sd };
        }
        if (p.sun) { p.type = "sun"; delete p.sun.sd; }
      }
      out.push(p);
    }
  }
  return out;
}

// ---- 2. The same manual action shortly after the same event.
// `contexts` are changes { e, s, t } of the entities that can start something (a door, a presence, a person arriving…); manual actions are
// added to them, so "when I turn the TV on, I also close the shutters" is found too.
function sfcpFollowHabits(actions, contexts, o, changes) {
  const A = [], lastA = new Map(), cnt = new Map(), tl = new Map();
  // state of an entity just before a moment (from every change, whatever its cause): an event only counts as an occasion to act
  // when the thing was not already in the wanted state (motion while the light is already on is not a missed occasion)
  for (const c of changes || []) { const l = tl.get(c.e) || []; l.push(c); tl.set(c.e, l); }
  const stateAt = (e, t) => { const l = tl.get(e); if (!l || !l.length) return null; if (t <= l[0].t) return l[0].from; let a = 0, b = l.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (l[m].t < t) a = m; else b = m - 1; } return l[a].s; };
  const raw = contexts.filter((x) => x && typeof x.e === "string" && isFinite(x.t)).map((x) => ({ e: x.e, s: x.s, t: x.t })).concat(actions.map((a) => ({ e: a.e, s: a.s, t: a.t }))).sort((a, b) => a.t - b.t);
  for (const x of raw) { const k = `${x.e}|${x.s}`; if (lastA.has(k) && x.t - lastA.get(k) < 60000) continue; lastA.set(k, x.t); A.push({ k, e: x.e, s: x.s, t: x.t, m: sfcpMinute(x.t) }); cnt.set(k, (cnt.get(k) || 0) + 1); }
  const pairs = new Map(), nB = new Map();
  let lo = 0;
  for (const b of actions) {
    const bk = `${b.e}|${b.s}`; nB.set(bk, (nB.get(bk) || 0) + 1);
    while (lo < A.length && A[lo].t < b.t - o.followPerson * 1000) lo++;
    const seen = new Set();
    for (let i = lo; i < A.length && A[i].t <= b.t; i++) {
      const a = A[i]; if (a.e === b.e || seen.has(a.k)) continue;
      const w = (sfcpDomain(a.e) === "person" || sfcpDomain(a.e) === "device_tracker" ? o.followPerson : o.follow) * 1000;
      if (b.t - a.t > w || b.t - a.t < 0) continue;
      seen.add(a.k); const pk = `${a.k}>${bk}`, l = pairs.get(pk) || []; l.push({ ta: a.t, tb: b.t, m: a.m, d: sfcpLocalDay(b.t) }); pairs.set(pk, l);
    }
  }
  const out = [];
  for (const [pk, list] of pairs) {
    if (list.length < o.minDays || new Set(list.map((x) => x.d)).size < Math.min(o.minDays, 4)) continue;
    const [ak, bk] = pk.split(">"), [ae, as] = ak.split("|"), [be, bs] = bk.split("|");
    const occ = A.filter((a) => a.k === ak && stateAt(be, a.t) !== bs), nA = Math.max(occ.length, list.length);
    let conf = list.length / nA, band = null, total = nA;
    if (conf < o.confidence) {   // only at certain hours? (a light on motion in the evening, not at noon)
      const ms = list.map((x) => x.m).sort((a, b) => a - b), from = Math.max(0, Math.floor((sfcpQuantile(ms, 0.1) - 30) / 15) * 15), to = Math.min(1439, Math.ceil((sfcpQuantile(ms, 0.9) + 30) / 15) * 15);
      if (to - from <= 14 * 60) { const inBand = Math.max(occ.filter((a) => a.m >= from && a.m <= to).length, list.filter((x) => x.m >= from && x.m <= to).length), hits = list.filter((x) => x.m >= from && x.m <= to).length; if (inBand && hits / inBand >= o.confidence && hits >= o.minDays) { conf = hits / inBand; band = { from, to }; total = inBand; } }
    }
    if (conf < o.confidence) continue;
    const delays = list.map((x) => (x.tb - x.ta) / 1000).sort((a, b) => a - b);
    if (sfcpQuantile(delays, 0.5) < 2) continue;
    out.push({ type: "follow", entity: be, state: bs, trigger: { entity: ae, state: as }, band, hits: band ? Math.round(conf * total) : list.length, total, confidence: Math.min(1, conf),
      coverage: list.length / (nB.get(bk) || list.length), delay: Math.round(sfcpQuantile(delays, 0.5)), lastDays: [...new Set(list.map((x) => x.d))].sort((a, b) => a - b) });
  }
  // One action explained by two states of the same trigger (the door opens, then closes, then the light goes on): keep the state that
  // explains it most often, and on a tie the one that comes first (the cause, not the next step of the same event).
  const same = (p, q) => p !== q && p.entity === q.entity && p.state === q.state && p.trigger.entity === q.trigger.entity;
  const better = (q, p) => q.hits > p.hits * 1.1 || (q.hits >= p.hits / 1.1 && (q.delay > p.delay || (q.delay === p.delay && q.trigger.state < p.trigger.state)));
  for (let i = out.length - 1; i >= 0; i--) if (out.some((q) => same(out[i], q) && better(q, out[i]))) out.splice(i, 1);
  // A -> B and B -> A can both show up when two things are done together in either order: keep the stronger direction.
  return out.filter((p) => !out.some((q) => q !== p && q.entity === p.trigger.entity && q.trigger.entity === p.entity && q.state === p.trigger.state && q.trigger.state === p.state && (q.hits > p.hits || (q.hits === p.hits && q.confidence > p.confidence))));
}

// ---- 3. Switched off by hand after about the same time, again and again.
function sfcpDurationHabits(changes, o) {
  const per = new Map(), out = [];
  for (const c of changes) { if (!["light", "switch", "fan", "input_boolean"].includes(sfcpDomain(c.e))) continue; const l = per.get(c.e) || []; l.push(c); per.set(c.e, l); }
  for (const [e, list] of per) {
    const manual = [], every = []; let on = null;
    for (const c of list) { if (c.s === "on") on = c; else if (c.s === "off" && on) { const min = (c.t - on.t) / 60000; every.push(min); if (c.cause === "human" || (o.physical === true && c.cause === "physical")) manual.push({ min, d: sfcpLocalDay(c.t) }); on = null; } }
    if (manual.length < o.minDays || new Set(manual.map((x) => x.d)).size < Math.min(o.minDays, 4)) continue;
    const ms = manual.map((x) => x.min).sort((a, b) => a - b), med = sfcpQuantile(ms, 0.5), q1 = sfcpQuantile(ms, 0.25), q3 = sfcpQuantile(ms, 0.75);
    if (!(med >= 2 && med <= 360) || (q3 - q1) / med > 0.6) continue;
    if (sfcpQuantile(ms, 0.9) - sfcpQuantile(ms, 0.1) < 1) continue;   // always the same duration to the minute: a timer or a script, not a person
    const after = Math.max(1, med < 10 ? Math.ceil(q3) : Math.ceil(q3 / 5) * 5);   // a little after the usual moment, never before it
    out.push({ type: "duration", entity: e, state: "off", after, median: Math.round(med), low: Math.round(q1), high: Math.round(q3), hits: manual.length, total: every.length,
      confidence: ms.filter((m) => m <= after).length / ms.length, wouldAct: every.filter((m) => m > after).length, lastDays: [...new Set(manual.map((x) => x.d))].sort((a, b) => a - b) });
  }
  return out;
}

// Everything together. input = { events, contexts, t0, t1, lat, lon, options }. Returns { proposals, stats }.
function sfcpAnalyze(input) {
  input = input && typeof input === "object" ? input : {};
  const o = { ...SFCP_DEFAULTS, ...((input && input.options) || {}), lat: Number(input && input.lat), lon: Number(input && input.lon) };
  for (const k of ["minDays", "support", "tolerance", "follow", "followPerson", "confidence", "max"]) if (!(Number(o[k]) > 0)) o[k] = SFCP_DEFAULTS[k];
  const events = Array.isArray(input && input.events) ? input.events : [], ctx = Array.isArray(input && input.contexts) ? input.contexts : [];
  const t1 = isFinite(input && input.t1) ? input.t1 : Date.now(), t0 = isFinite(input && input.t0) ? input.t0 : t1 - 21 * SFCP_DAY;
  const { actions, changes } = sfcpActions(events, o), days = sfcpDays(t0, t1);
  const context = ctx.filter((x) => x && (SFCP_CONTEXT[sfcpDomain(x.e)] || []).includes(x.s));
  let props = days.length >= o.minDays ? [...sfcpTimeHabits(actions, days, o), ...sfcpFollowHabits(actions, context, o, changes), ...sfcpDurationHabits(changes, o)] : [];
  for (const p of props) {
    p.id = sfcpHash([p.type === "sun" ? "time" : p.type, p.entity, p.state, p.trigger ? `${p.trigger.entity}|${p.trigger.state}` : "", p.type === "time" || p.type === "sun" ? `${p.scope}|${Math.round(p.at / 60)}` : ""].join("~"));
    p.score = p.confidence * Math.log(1 + p.hits) * (p.type === "follow" ? 0.6 + 0.4 * p.coverage : 1);
  }
  // one action explained twice (a time habit that is really "after the door opens"): both stay, the best first
  props.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const seen = new Set(); props = props.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return { proposals: props.slice(0, Math.round(o.max)), stats: { days: days.length, actions: actions.length, human: actions.filter((a) => a.cause === "human").length, physical: actions.filter((a) => a.cause === "physical").length, entities: new Set(actions.map((a) => a.e)).size, found: props.length } };
}
