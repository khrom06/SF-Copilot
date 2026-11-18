/* ============================================================== AUTOMATION */
/*
 * From a proposal to a standard Home Assistant automation (the same object the automation editor saves), and its YAML to read or copy.
 * Nothing here talks to Home Assistant: the card decides when, and only on the person's request, to send this object.
 */
const SFCP_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/, SFCP_MARK = "sf-copilot-trial-since: ";
// When a dry run was created (ms), read back from its description; null when absent or unreadable (then the trial counts for nothing).
function sfcpTrialSince(description) { const m = new RegExp(`^${SFCP_MARK}(\\d{4}-\\d\\d-\\d\\dT[0-9:.]+Z)$`, "m").exec(String(description || "")), t = m ? Date.parse(m[1]) : NaN; return isFinite(t) ? t : null; }
function sfcpHHMM(min) { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`; }
function sfcpOffset(min) { const a = Math.abs(Math.round(min)); return `${min < 0 ? "-" : ""}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}:00`; }
// The service call that puts `entity` into `state`, or null when the engine has no safe way to express it.
function sfcpAction(entity, state) {
  if (!SFCP_ID.test(String(entity))) return null;
  const d = sfcpDomain(entity), t = { target: { entity_id: entity } };
  if (["light", "switch", "fan", "input_boolean"].includes(d) && (state === "on" || state === "off")) return { action: `${d}.turn_${state}`, ...t };
  if (d === "cover" && (state === "open" || state === "closed")) return { action: state === "open" ? "cover.open_cover" : "cover.close_cover", ...t };
  if (d === "lock" && (state === "locked" || state === "unlocked")) return { action: state === "locked" ? "lock.lock" : "lock.unlock", ...t };
  if (d === "climate" && SFCP_STATES.climate.includes(state)) return { action: "climate.set_hvac_mode", ...t, data: { hvac_mode: state } };
  return null;
}
// ---- Safety policy. The engine finds habits, it does not decide what is safe to automate: this decides, by what the action DOES.
//   blocked by default (needs an explicit `allow` entry in the card config, written by an administrator):
//     unlock                lock.unlock
//     open_cover            cover.open_cover (a shutter, a blind, a window… but the engine cannot always tell a garage from a shutter, so none by default)
//     access                any cover whose device_class is garage, gate or door, opened OR closed (a closing door can hurt someone), on top of open_cover
//   allowed but flagged "notice" in the card: closing a cover, changing the mode of a climate.
//   allowed: lights, switches, fans, input_booleans on/off, lock.lock.
const SFCP_ALLOW = ["unlock", "open_cover", "access"], SFCP_ACCESS_CLASSES = ["garage", "gate", "door"];
// policy = { allow: ["unlock", …], dc: (entity_id) => device_class | undefined }. No policy = nothing allowed.
function sfcpRisk(entity, state, policy) {
  const d = sfcpDomain(entity), allow = new Set(policy && Array.isArray(policy.allow) ? policy.allow.filter((x) => SFCP_ALLOW.includes(x)) : []);
  const dc = policy && typeof policy.dc === "function" ? policy.dc(entity) : undefined, access = SFCP_ACCESS_CLASSES.includes(dc), needs = [];
  let level = "ok";
  if (d === "lock" && state === "unlocked") needs.push("unlock");
  if (d === "cover") { if (state === "open") needs.push("open_cover"); if (access) needs.push("access"); if (!needs.length) level = "notice"; }
  if (d === "climate") level = "notice";
  const missing = needs.filter((n) => !allow.has(n));
  return { level: missing.length ? "blocked" : needs.length ? "sensitive" : level, needs, missing };
}
// The service call for `entity` -> `state`, or null when it is unsafe under `policy` or the engine cannot express it. Every way of building
// a real or trial automation goes through here.
function sfcpSafeAction(entity, state, policy) { const a = sfcpAction(entity, state); return a && sfcpRisk(entity, state, policy).level !== "blocked" ? a : null; }
// texts = { alias, description, trial } (already in the person's language). mode "trial" replaces the action by a logbook entry: the
// automation runs for real, writes what it would have done, and touches nothing.
function sfcpAutomation(p, texts, mode, policy) {
  const act = sfcpSafeAction(p.entity, p.state, policy); if (!act) return null;
  const cfg = { alias: String((texts && texts.alias) || "SF Copilot").slice(0, 120), description: String((texts && texts.description) || "").slice(0, 600), triggers: [], conditions: [], actions: [], mode: "single" };
  if (p.type === "time") cfg.triggers.push({ trigger: "time", at: sfcpHHMM(p.at) });
  else if (p.type === "sun") cfg.triggers.push({ trigger: "sun", event: p.sun.event, ...(p.sun.offset ? { offset: sfcpOffset(p.sun.offset) } : {}) });
  else if (p.type === "follow") { if (!SFCP_ID.test(String(p.trigger.entity))) return null; cfg.triggers.push({ trigger: "state", entity_id: p.trigger.entity, to: p.trigger.state }); }
  else if (p.type === "duration") cfg.triggers.push({ trigger: "state", entity_id: p.entity, to: "on", for: { minutes: p.after } });
  else return null;
  // the moment a dry run was created lives in the automation itself (it survives a restart and a page reload), so the card can enforce the observation period
  if (mode === "trial" && texts && texts.since) cfg.description += `\n${SFCP_MARK}${texts.since}`;
  if ((p.type === "time" || p.type === "sun") && p.scope !== "all") cfg.conditions.push({ condition: "time", weekday: p.scope === "weekend" ? ["sat", "sun"] : ["mon", "tue", "wed", "thu", "fri"] });
  if (p.type === "follow" && p.band) cfg.conditions.push({ condition: "time", after: sfcpHHMM(p.band.from), before: sfcpHHMM(p.band.to) });
  // never act on something that is already in the wanted state (no useless call, no light flicker)
  if (p.type !== "duration" && sfcpDomain(p.entity) !== "climate") cfg.conditions.push({ condition: "not", conditions: [{ condition: "state", entity_id: p.entity, state: p.state }] });
  cfg.actions.push(mode === "trial" ? { action: "logbook.log", data: { name: "SF Copilot", message: String((texts && texts.trial) || "dry run").slice(0, 200), entity_id: p.entity } } : act);
  return cfg;
}
// YAML of a plain object made of strings, numbers, booleans, arrays and objects (what sfcpAutomation produces). Strings are quoted
// whenever YAML could read them as something else.
function sfcpYaml(v, ind = 0) {
  const pad = "  ".repeat(ind);
  const str = (s) => (/^[A-Za-z_][A-Za-z0-9_ .()/-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/[:#]\s|\s$/.test(s) ? s : JSON.stringify(s));
  const scalar = (x) => (typeof x === "string" ? str(x) : x === null || x === undefined ? "null" : String(x));
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return v.map((x) => { if (x && typeof x === "object") { const body = sfcpYaml(x, ind + 1); return `${pad}- ${body.slice((ind + 1) * 2)}`; } return `${pad}- ${scalar(x)}`; }).join("\n");
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v); if (!keys.length) return "{}";
    return keys.map((k) => { const x = v[k];
      if (x && typeof x === "object" && (Array.isArray(x) ? x.length : Object.keys(x).length)) return `${pad}${k}:\n${sfcpYaml(x, Array.isArray(x) ? ind : ind + 1)}`;
      return `${pad}${k}: ${Array.isArray(x) ? "[]" : x && typeof x === "object" ? "{}" : scalar(x)}`; }).join("\n");
  }
  return pad + scalar(v);
}
