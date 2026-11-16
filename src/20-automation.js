/* ============================================================== AUTOMATION */
/*
 * From a proposal to a standard Home Assistant automation (the same object the automation editor saves), and its YAML to read or copy.
 * Nothing here talks to Home Assistant: the card decides when, and only on the person's request, to send this object.
 */
const SFCP_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
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
// texts = { alias, description, trial } (already in the person's language). mode "trial" replaces the action by a logbook entry: the
// automation runs for real, writes what it would have done, and touches nothing.
function sfcpAutomation(p, texts, mode) {
  const act = sfcpAction(p.entity, p.state); if (!act) return null;
  const cfg = { alias: String((texts && texts.alias) || "SF Copilot").slice(0, 120), description: String((texts && texts.description) || "").slice(0, 600), triggers: [], conditions: [], actions: [], mode: "single" };
  if (p.type === "time") cfg.triggers.push({ trigger: "time", at: sfcpHHMM(p.at) });
  else if (p.type === "sun") cfg.triggers.push({ trigger: "sun", event: p.sun.event, ...(p.sun.offset ? { offset: sfcpOffset(p.sun.offset) } : {}) });
  else if (p.type === "follow") { if (!SFCP_ID.test(String(p.trigger.entity))) return null; cfg.triggers.push({ trigger: "state", entity_id: p.trigger.entity, to: p.trigger.state }); }
  else if (p.type === "duration") cfg.triggers.push({ trigger: "state", entity_id: p.entity, to: "on", for: { minutes: p.after } });
  else return null;
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
