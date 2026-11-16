// Engine tests: each habit rule on synthetic history where the right answer is known, plus the cases that must give NOTHING.
// Run: TZ=Europe/Paris node test/engine.test.mjs
import { load } from "./lib.mjs";
const E = load(), fails = []; let checks = 0;
const ok = (c, msg) => { checks++; if (!c) fails.push(msg); };
const DAY = 86400000, MIN = 60000;
let seed = 42; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
// local midnight of the day `k` days before a fixed Monday (2026-06-15)
const base = new Date(2026, 5, 15, 0, 0, 0).getTime(), day = (k) => { const d = new Date(base); d.setDate(d.getDate() - k); return d.getTime(); };
const t1 = base + 12 * 3600000, t0 = day(28);
const isWe = (ms) => [0, 6].includes(new Date(ms).getDay());
const toggle = (e, t, cause = "human", on = "on", off = "off") => [{ e, s: off, t: t - 5 * 3600000 - Math.floor(rnd() * 1000), cause: "auto" }, { e, s: on, t, cause }];
const run = (events, contexts = [], options = {}, geo = {}) => E.sfcpAnalyze({ events, contexts, t0, t1, options, ...geo });

// 1. Weekday routine: on around 19:25 on 17 of the 20 weekdays, never at weekends.
{ const ev = []; let n = 0;
  for (let k = 1; k <= 28; k++) { const d = day(k); if (isWe(d)) continue; n++; if (n % 7 === 0) continue; ev.push(...toggle("light.desk", d + (19 * 60 + 25 + Math.round(rnd() * 20 - 10)) * MIN)); }
  const r = run(ev), p = r.proposals.find((x) => x.entity === "light.desk" && x.state === "on");
  ok(p && p.type === "time", "weekday routine: a time proposal is expected, got " + JSON.stringify(r.proposals.map((x) => x.type + ":" + x.entity)));
  if (p) { ok(p.scope === "weekdays", "weekday routine: scope weekdays expected, got " + p.scope); ok(p.at >= 19 * 60 + 15 && p.at <= 19 * 60 + 35, "weekday routine: around 19:25 expected, got " + p.at);
    ok(p.total === 20 && p.hits >= 16 && p.hits <= 18, `weekday routine: about 17 of 20 expected, got ${p.hits}/${p.total}`); ok(p.days.filter((x) => x.st === "na").length === 8, "weekday routine: the 8 weekend days are not eligible");
    const cfg = E.sfcpAutomation(p, { alias: "A", description: "D" }); ok(cfg && cfg.triggers[0].trigger === "time" && /^19:[123]\d:00$/.test(cfg.triggers[0].at), "weekday routine: time trigger expected");
    ok(cfg && cfg.conditions.some((c) => c.condition === "time" && c.weekday.join() === "mon,tue,wed,thu,fri"), "weekday routine: weekday condition expected");
    ok(cfg && cfg.actions[0].action === "light.turn_on" && cfg.actions[0].target.entity_id === "light.desk", "weekday routine: light.turn_on expected"); }
  ok(!r.proposals.some((x) => x.entity === "light.desk" && x.state === "off"), "weekday routine: the automatic switch-off must not become a habit");
}
// 2. The same history done by an automation is not a habit.
{ const ev = []; for (let k = 1; k <= 28; k++) ev.push(...toggle("light.auto", day(k) + 20 * 60 * MIN, "auto"));
  ok(run(ev).proposals.length === 0, "automated actions must give no proposal"); }
// 3. Physical presses count (wall switch), unless the option says otherwise.
{ const ev = []; for (let k = 1; k <= 28; k++) ev.push(...toggle("light.wall", day(k) + (7 * 60 + Math.round(rnd() * 10)) * MIN, "physical"));
  ok(run(ev, [], { physical: true }).proposals.some((x) => x.entity === "light.wall" && x.scope === "all"), "physical: true counts presses on the device");
  ok(run(ev).proposals.length === 0, "by default changes without context are not habits (integrations syncing, devices coming back)"); }
// 4. Follows the sun, not the clock: 15 minutes before sunset over 4 weeks (sunset drifts ~30 min in that time in spring).
{ const lat = 44.84, lon = -0.58, ev = [], b2 = new Date(2026, 2, 30).getTime(), d2 = (k) => { const d = new Date(b2); d.setDate(d.getDate() - k); return d.getTime(); };
  for (let k = 1; k <= 28; k++) { const s = E.sfcpSun(d2(k) + 12 * 3600000, lat, lon); ev.push(...toggle("light.porch", s.sunset - 15 * MIN + Math.round(rnd() * 8 - 4) * MIN)); }
  const r = E.sfcpAnalyze({ events: ev, contexts: [], t0: d2(28), t1: b2 + 3600000, lat, lon }), p = r.proposals.find((x) => x.entity === "light.porch");
  ok(p && p.type === "sun" && p.sun.event === "sunset", "sun habit: a sunset proposal is expected, got " + JSON.stringify(p && [p.type, p.sun]));
  if (p && p.sun) { ok(Math.abs(p.sun.offset + 15) <= 5, "sun habit: offset about -15 min, got " + p.sun.offset); const cfg = E.sfcpAutomation(p, {}); ok(cfg.triggers[0].trigger === "sun" && cfg.triggers[0].event === "sunset" && /^-00:1[05]:00$/.test(cfg.triggers[0].offset), "sun habit: sun trigger with a negative offset: " + JSON.stringify(cfg.triggers[0])); }
  const s = E.sfcpSun(new Date(2026, 5, 21, 12).getTime(), 48.85, 2.35), hh = (ms) => new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
  ok(Math.abs(hh(s.sunrise) - 3.78) < 0.1 && Math.abs(hh(s.sunset) - 19.97) < 0.1, `sun times Paris 21 June: sunrise ~03:47 UTC, sunset ~19:58 UTC, got ${hh(s.sunrise).toFixed(2)} / ${hh(s.sunset).toFixed(2)}`);
  ok(E.sfcpSun(new Date(2026, 5, 21, 12).getTime(), 80, 10) === null, "sun times: no sunset in the polar day");
  const noGeo = E.sfcpAnalyze({ events: ev, contexts: [], t0: d2(28), t1: b2 + 3600000 }); ok(!noGeo.proposals.some((x) => x.type === "sun"), "sun habit: without coordinates only clock proposals");
}
// 5. Follow: the light is turned on within a minute after the door opens, 9 times out of 10.
{ const ev = [], ctx = []; for (let k = 1; k <= 20; k++) { const t = day(k) + (18 * 60 + Math.round(rnd() * 240)) * MIN; ctx.push({ e: "binary_sensor.door", s: "on", t }, { e: "binary_sensor.door", s: "off", t: t + 20000 }); if (k % 10 !== 0) ev.push(...toggle("light.hall", t + 15000 + Math.round(rnd() * 40000))); else ev.push({ e: "light.hall", s: "off", t: t - 5 * 3600000, cause: "auto" }); }
  // a door opening while the light is ALREADY on is not an occasion: it must not lower the confidence
  for (let k = 1; k <= 20; k++) ctx.push({ e: "binary_sensor.door", s: "on", t: day(k) + 23.5 * 3600000 });
  const r = run(ev, ctx), p = r.proposals.find((x) => x.type === "follow" && x.entity === "light.hall" && x.trigger.entity === "binary_sensor.door");
  ok(p && p.trigger.state === "on", "follow: door opens -> light on expected, got " + JSON.stringify(r.proposals.map((x) => [x.type, x.entity, x.trigger && x.trigger.entity + "=" + x.trigger.state])));
  ok(run(ev, ctx).proposals.filter((x) => x.type === "follow" && x.entity === "light.hall").length === 1, "follow: one action is explained once (door opens), not again by the door closing");
  if (p) { // 20 evening openings + the 2 late ones on the evenings the light stayed off = 22 occasions; the 18 late ones with the light on do not count
    ok(p.hits === 18 && p.total === 22 && Math.abs(p.confidence - 18 / 22) < 0.01, `follow: 18 of 22 occasions expected, got ${p.hits}/${p.total}`); ok(!p.band, "follow: no time band when it holds all day");
    const cfg = E.sfcpAutomation(p, {}); ok(cfg.triggers[0].trigger === "state" && cfg.triggers[0].entity_id === "binary_sensor.door" && cfg.triggers[0].to === "on", "follow: state trigger expected");
    ok(cfg.conditions.some((c) => c.condition === "not" && c.conditions[0].entity_id === "light.hall" && c.conditions[0].state === "on"), "follow: do nothing when the light is already on"); }
}
// 6. Follow only in the evening: motion all day long, the light follows only between 19:00 and 22:30.
{ const ev = [], ctx = []; for (let k = 1; k <= 24; k++) { for (let h = 7; h < 17; h += 1.5) ctx.push({ e: "binary_sensor.motion", s: "on", t: day(k) + h * 3600000 + Math.round(rnd() * 300000) }); const t = day(k) + (19 * 60 + 30 + Math.round(rnd() * 150)) * MIN; ctx.push({ e: "binary_sensor.motion", s: "on", t }); if (k % 6 !== 0) ev.push({ e: "light.sofa", s: "off", t: day(k) + 6 * 3600000, cause: "auto" }, { e: "light.sofa", s: "on", t: t + 20000, cause: "human" }); }
  const p = run(ev, ctx).proposals.find((x) => x.type === "follow" && x.entity === "light.sofa");
  ok(p && p.band && p.band.from >= 17 * 60 && p.band.from <= 19 * 60 + 30 && p.band.to >= 22 * 60 && p.band.to <= 23 * 60 + 45, "follow in the evening: a time band around 19:00–22:30 is expected, got " + JSON.stringify(p && p.band));
  if (p && p.band) { const cfg = E.sfcpAutomation(p, {}); ok(cfg.conditions.some((c) => c.condition === "time" && c.after && c.before), "follow in the evening: the automation carries the time band"); }
}
// 7. A motion sensor that fires all day with a light that rarely follows gives nothing.
{ const ev = [], ctx = []; for (let k = 1; k <= 24; k++) for (let h = 7; h < 23; h += 0.5) { const t = day(k) + h * 3600000; ctx.push({ e: "binary_sensor.busy", s: "on", t }); if (rnd() < 0.04) ev.push(...toggle("light.rare", t + 30000)); }
  ok(!run(ev, ctx).proposals.some((x) => x.type === "follow"), "follow: a weak link (4 %) must not be proposed"); }
// 8. Duration: a towel heater switched off by hand 40 to 50 minutes after it came on.
{ const ev = []; for (let k = 1; k <= 12; k++) { const t = day(k) + (7 * 60 + Math.round(rnd() * 600)) * MIN; ev.push({ e: "switch.towel", s: "on", t, cause: "human" }, { e: "switch.towel", s: "off", t: t + (40 + Math.round(rnd() * 10)) * MIN, cause: "human" }); }
  const p = run(ev).proposals.find((x) => x.type === "duration" && x.entity === "switch.towel");
  ok(p && p.after >= 45 && p.after <= 50 && p.median >= 40 && p.median <= 50, "duration: switch off after about 45–50 min expected, got " + JSON.stringify(p && [p.after, p.median]));
  if (p) { const cfg = E.sfcpAutomation(p, {}); ok(cfg.triggers[0].for.minutes === p.after && cfg.triggers[0].to === "on" && cfg.actions[0].action === "switch.turn_off", "duration: state-for trigger and turn_off expected"); }
  const wild = []; for (let k = 1; k <= 12; k++) { const t = day(k) + 8 * 3600000; wild.push({ e: "switch.wild", s: "on", t, cause: "human" }, { e: "switch.wild", s: "off", t: t + (5 + Math.round(rnd() * 300)) * MIN, cause: "human" }); }
  const rw = run(wild); ok(!rw.proposals.some((x) => x.type === "duration"), "duration: irregular durations must give nothing, got " + JSON.stringify(rw.proposals.filter((x) => x.type === "duration").map((x) => [x.low, x.median, x.high])));
}
// 9. Unavailable flaps are not actions; pure noise gives nothing.
{ const ev = []; for (let k = 1; k <= 28; k++) { const t = day(k) + 9 * 3600000; ev.push({ e: "light.flap", s: "on", t: t - 3600000, cause: "auto" }, { e: "light.flap", s: "unavailable", t, cause: "physical" }, { e: "light.flap", s: "on", t: t + 60000, cause: "physical" }); }
  ok(run(ev).proposals.length === 0, "an entity that goes unavailable and comes back must give no proposal");
  const noise = []; for (let i = 0; i < 400; i++) noise.push({ e: "light.n" + (i % 9), s: rnd() < 0.5 ? "on" : "off", t: t0 + Math.floor(rnd() * 28 * DAY), cause: "human" });
  const rn = run(noise); ok(rn.proposals.length === 0, "random actions must give no proposal, got " + JSON.stringify(rn.proposals.map((x) => [x.type, x.entity, x.hits, x.total])));
}
// 10. Stable ids, ranking, cap, hostile input.
{ const ev = []; for (let k = 1; k <= 28; k++) for (let i = 0; i < 20; i++) ev.push(...toggle("light.m" + i, day(k) + (6 * 60 + i * 40 + Math.round(rnd() * 6)) * MIN));
  const a = run(ev), b = run(ev.slice().reverse()); ok(a.proposals.length === 12, "at most 12 proposals by default, got " + a.proposals.length); ok(run(ev, [], { max: 3 }).proposals.length === 3, "the max option caps the list");
  ok(a.proposals.map((p) => p.id).join() === b.proposals.map((p) => p.id).join(), "the result must not depend on the order of the input"); ok(new Set(a.proposals.map((p) => p.id)).size === a.proposals.length, "proposal ids are unique");
  ok(a.stats.days === 28 && a.stats.actions > 500, "stats: days and actions counted");
  for (const bad of [null, undefined, {}, { events: "x" }, { events: [null, 5, {}, { e: 5 }, { e: "light.a", s: "on", t: "x" }], contexts: [null, { e: "x" }] }, { events: [{ e: "light.a", s: "on", t: 1 }], t0: 5, t1: 1 }]) { try { const r = E.sfcpAnalyze(bad); ok(Array.isArray(r.proposals), "hostile input: a list is always returned"); } catch (err) { fails.push("hostile input throws: " + err.message); } }
  ok(E.sfcpAutomation({ type: "time", entity: "light.a; rm", state: "on", at: 60, scope: "all" }, {}) === null, "a malformed entity id gives no automation");
  ok(E.sfcpAutomation({ type: "time", entity: "sensor.a", state: "on", at: 60, scope: "all" }, {}) === null, "a domain that cannot be commanded gives no automation");
  ok(E.sfcpAction("cover.x", "closed").action === "cover.close_cover" && E.sfcpAction("climate.x", "heat").data.hvac_mode === "heat", "cover and climate actions");
}
// 12. Too regular to be a person, and simultaneous changes.
{ const ev = []; for (let k = 1; k <= 12; k++) { const t = day(k) + (7 * 60 + Math.round(rnd() * 600)) * MIN; ev.push({ e: "switch.timer", s: "on", t, cause: "human" }, { e: "switch.timer", s: "off", t: t + 45 * MIN, cause: "human" }); }
  ok(!run(ev).proposals.some((x) => x.type === "duration"), "duration: always exactly 45 min is a timer, not a habit");
  const ex = []; for (let k = 1; k <= 28; k++) ex.push(...toggle("light.exact", day(k) + 21 * 3600000));
  ok(!run(ex).proposals.some((x) => x.entity === "light.exact"), "time: every day at the same second is a timer, not a habit");
  const gr = []; for (let k = 1; k <= 20; k++) { const t = day(k) + (20 * 60 + Math.round(rnd() * 120)) * MIN; gr.push(...toggle("light.ga", t), ...toggle("light.gb", t + 400)); }
  ok(!run(gr).proposals.some((x) => x.type === "follow"), "follow: two lights changing in the same second are one action (a group), not a habit");
}
{ const ev = []; for (let k = 1; k <= 12; k++) { const t = day(k) + (7 * 60 + Math.round(rnd() * 600)) * MIN; ev.push({ e: "switch.sync", s: "on", t, cause: "physical" }, { e: "switch.sync", s: "off", t: t + (40 + Math.round(rnd() * 10)) * MIN, cause: "physical" }); }
  ok(!run(ev).proposals.some((x) => x.type === "duration"), "duration: switch-offs without context only count with physical: true");
  ok(run(ev, [], { physical: true }).proposals.some((x) => x.type === "duration"), "duration: physical: true counts them"); }
// 13. Who did it: logbook entries.
{ const H = new Set(["u1"]), c = (x) => E.sfcpCause(x, H);
  ok(c({}) === "physical", "no context: physical"); ok(c({ context_user_id: "u1", context_event_type: "call_service", context_domain: "light" }) === "human", "a person calling a service: human");
  ok(c({ context_user_id: "u1", context_event_type: "call_service", context_domain: "script" }) === "auto", "a script started by a person: auto (its timing is the script's)");
  ok(c({ context_user_id: "sys", context_event_type: "call_service", context_domain: "climate" }) === "auto", "a service account (Node-RED): auto");
  ok(c({ context_event_type: "automation_triggered", context_domain: "automation" }) === "auto" && c({ context_user_id: "u1", context_event_type: "automation_triggered" }) === "auto", "automations: auto");
  ok(c(null) === "auto", "hostile entry: auto"); }
// 14. Reliability shown: cautious on few occasions.
{ const R = E.sfcpReliability; ok(Math.abs(R(4, 4) - 0.71) < 0.02, "4 out of 4 reads about 71 %, got " + R(4, 4)); ok(R(18, 20) > 0.75 && R(18, 20) < 0.85, "18 out of 20 reads about 78 %, got " + R(18, 20)); ok(R(40, 40) > 0.95, "40 out of 40 is near 100 %"); ok(R(0, 0) === 0 && R(3, 0) === 0, "no occasion: 0"); }
// 11. Trial mode and YAML.
{ const p = { type: "time", entity: "light.desk", state: "on", at: 19 * 60 + 25, scope: "weekdays" }, trial = E.sfcpAutomation(p, { alias: "SF Copilot · Desk: on at 19:25", description: "x", trial: "would turn Desk on" }, "trial");
  ok(trial.actions.length === 1 && trial.actions[0].action === "logbook.log" && !JSON.stringify(trial.actions).includes("turn_on"), "trial: the only action is a logbook entry");
  const y = E.sfcpYaml(E.sfcpAutomation(p, { alias: "SF Copilot · Desk: on at 19:25", description: "it's a test: yes" }));
  ok(/^alias: "SF Copilot · Desk: on at 19:25"$/m.test(y) && /^description: "it's a test: yes"$/m.test(y), "yaml: strings with a colon are quoted:\n" + y);
  ok(/^triggers:\n- trigger: time\n  at: "19:25:00"$/m.test(y), "yaml: trigger block:\n" + y); ok(/^  weekday:\n  - mon\n  - tue/m.test(y), "yaml: nested list:\n" + y); ok(/^- condition: not\n  conditions:\n  - condition: state\n    entity_id: light\.desk\n    state: "on"$/m.test(y), "yaml: nested objects in lists:\n" + y); ok(/entity_id: light\.desk/.test(y) && /^mode: single$/m.test(y), "yaml: plain scalars");
  ok(E.sfcpYaml({ a: "on", b: "no", c: true, d: 5, e: [], f: {} }) === 'a: "on"\nb: "no"\nc: true\nd: 5\ne: []\nf: {}', "yaml: words YAML would read as booleans are quoted: " + E.sfcpYaml({ a: "on", b: "no", c: true, d: 5, e: [], f: {} }));
}
if (fails.length) { console.log(`FAIL engine: ${fails.length} problem(s) of ${checks} checks`); fails.forEach((f) => console.log(" - " + f)); process.exit(1); }
console.log(`OK: engine (${checks} checks)`);
