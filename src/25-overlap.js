/* ================================================================== OVERLAP */
/*
 * Is a proposal already covered by an automation that exists? Pure functions over automation configs (what Settings → Automations stores),
 * no Home Assistant object, so every rule is tested on its own.
 *
 * Verdict per existing automation, for one proposal (an entity put into a state, by a trigger):
 *   duplicate  it puts the same entity in the same state AND its trigger is the same one (same time within `tol` minutes, same sun
 *              event and offset, same state trigger, same delay). The proposal would do what it already does.
 *   overlap    it also acts on the entity (another trigger, or the opposite / a toggle): two automations fighting is the risk.
 *   unknown    the entity shows up in it but the engine cannot follow how (a script, a scene, a template, a blueprint).
 * Only what is written in the config can be compared: a template or a script is never evaluated. "No duplicate found" is not "no duplicate".
 */
const SFCP_TOL = 30;
function sfcpList(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
function sfcpObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
function sfcpTriggersOf(c) { return sfcpList(c && (c.triggers !== undefined ? c.triggers : c.trigger)).filter(sfcpObj); }
// Every action that is not itself a container (sequence, choose, if, repeat, parallel), however deeply nested.
function sfcpLeaves(c) {
  const out = [];
  const walk = (list, depth) => {
    if (depth > 12) return;
    for (const a of sfcpList(list)) {
      if (!sfcpObj(a)) continue;
      if (a.sequence !== undefined) walk(a.sequence, depth + 1);
      else if (a.choose !== undefined) { for (const ch of sfcpList(a.choose)) if (sfcpObj(ch)) walk(ch.sequence, depth + 1); walk(a.default, depth + 1); }
      else if (a.if !== undefined) { walk(a.then, depth + 1); walk(a.else, depth + 1); }
      else if (a.repeat !== undefined && sfcpObj(a.repeat)) walk(a.repeat.sequence, depth + 1);
      else if (a.parallel !== undefined) walk(a.parallel, depth + 1);
      else out.push(a);
    }
  };
  walk(c && (c.actions !== undefined ? c.actions : c.action), 0);
  return out;
}
// The state a service call leaves an entity in: "on", "off", "open"… ; "toggle" when it depends ; null when the call is about something else.
function sfcpIntent(service, data) {
  const s = String(service || "").split(".")[1];
  if (s === "turn_on") return "on"; if (s === "turn_off") return "off"; if (s === "toggle") return "toggle";
  if (s === "open_cover") return "open"; if (s === "close_cover") return "closed"; if (s === "lock") return "locked"; if (s === "unlock") return "unlocked";
  if (s === "set_hvac_mode" && sfcpObj(data) && typeof data.hvac_mode === "string") return data.hvac_mode;
  return null;
}
const sfcpTpl = (v) => typeof v === "string" && v.includes("{{");
// Does this action target `entity`? "direct" (named), "device" / "area" (through the registry), "unknown" (a template, a label, a floor).
function sfcpTargets(a, entity, reg) {
  const t = sfcpObj(a.target) ? a.target : {}, data = sfcpObj(a.data) ? a.data : {}, d = sfcpDomain(entity), sd = String(a.action || a.service || "").split(".")[0];
  const domainOk = sd === d || sd === "homeassistant";
  const ids = [...sfcpList(t.entity_id), ...sfcpList(a.entity_id), ...sfcpList(data.entity_id)], devs = [...sfcpList(t.device_id), ...sfcpList(data.device_id)], areas = [...sfcpList(t.area_id), ...sfcpList(data.area_id)];
  if ([...ids, ...devs, ...areas].some(sfcpTpl) || sfcpList(t.label_id).length || sfcpList(t.floor_id).length) return domainOk ? "unknown" : null;
  if (ids.includes(entity)) return "direct";
  if (!domainOk) return null;
  if (ids.includes("all")) return "area";
  const r = (reg && reg(entity)) || {};
  if (r.device_id && devs.includes(r.device_id)) return "device";
  if (r.area_id && areas.includes(r.area_id)) return "area";
  return null;
}
function sfcpClock(at) { const m = /^(\d{1,2}):(\d\d)(?::\d\d)?$/.exec(String(at)); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function sfcpOffsetMin(v) { if (typeof v === "number") return v / 60; const m = /^(-?)(\d+):(\d\d)(?::(\d\d))?$/.exec(String(v === undefined ? "0:00" : v)); return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null; }
function sfcpForMin(f) { if (typeof f === "number") return f / 60; if (sfcpObj(f)) return (Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0) + (Number(f.seconds) || 0) / 60; const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(String(f)); return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / 60 : null; }
// Is trigger `t` of an existing automation the same one as the proposal's?
function sfcpSameTrigger(p, t, tol) {
  const type = t.trigger || t.platform;
  if (p.type === "time") { const m = type === "time" ? sfcpClock(t.at) : null; if (m === null) return false; const diff = Math.abs(m - p.at) % 1440; return Math.min(diff, 1440 - diff) <= tol; }
  if (p.type === "sun") { if (type !== "sun" || t.event !== p.sun.event) return false; const o = sfcpOffsetMin(t.offset); return o !== null && Math.abs(o - p.sun.offset) <= tol; }
  if (p.type === "follow") return type === "state" && sfcpList(t.entity_id).includes(p.trigger.entity) && t.to !== undefined && t.to !== null && sfcpList(t.to).map(String).includes(String(p.trigger.state));
  if (p.type === "duration") { if (type !== "state" || !sfcpList(t.entity_id).includes(p.entity) || !sfcpList(t.to).map(String).includes("on")) return false; const m = sfcpForMin(t.for); return m !== null && Math.abs(m - p.after) <= Math.max(5, p.after * 0.25); }
  return false;
}
// autos: [{ entity_id, id, alias, off, config }]; ctx: { reg: (entity) => { device_id, area_id }, tol }.
// Returns { duplicate: [{ entity_id, alias, off }], overlap: [...], unknown: [...] } (each automation appears once, in its strongest category).
function sfcpOverlap(p, autos, ctx) {
  const out = { duplicate: [], overlap: [], unknown: [] }, tol = ctx && isFinite(ctx.tol) ? ctx.tol : SFCP_TOL, reg = ctx && ctx.reg;
  if (!p || typeof p.entity !== "string") return out;
  for (const a of Array.isArray(autos) ? autos : []) {
    const c = a && a.config; if (!sfcpObj(c)) continue;
    let acts = false, same = false, unknown = false;
    for (const leaf of sfcpLeaves(c)) {
      const svc = String(leaf.action || leaf.service || ""), hit = sfcpTargets(leaf, p.entity, reg);
      if (hit === "unknown") { unknown = true; continue; }
      if (!hit) { if ((/^(script|scene)\./.test(svc) || svc === "automation.trigger") && JSON.stringify(leaf).includes(p.entity)) unknown = true; continue; }
      acts = true; if (sfcpIntent(svc, leaf.data) === p.state) same = true;
    }
    const rec = { entity_id: a.entity_id, alias: String(a.alias || (c && c.alias) || a.entity_id || ""), off: !!a.off };
    if (acts) { if (same && sfcpTriggersOf(c).some((t) => sfcpSameTrigger(p, t, tol))) out.duplicate.push(rec); else out.overlap.push(rec); }
    // a blueprint, a template or anything else that names the entity without a readable action
    else if (unknown || (c.use_blueprint !== undefined && JSON.stringify(c.use_blueprint).includes(p.entity)) || (sfcpTplMentions(c, p.entity))) out.unknown.push(rec);
  }
  return out;
}
// The entity id appears inside a template of the automation (a condition, a trigger, an action) that the rules above did not resolve.
function sfcpTplMentions(c, entity) { try { return JSON.stringify(c).split(entity).length > 1 && /\{\{/.test(JSON.stringify(c)); } catch (e) { return false; } }
