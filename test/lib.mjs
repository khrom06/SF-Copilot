// Loads the pure modules of src/ (engine, automation builder) into a sandbox, for node tests without a browser.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export function load() {
  const ctx = vm.createContext({ console, Math, Date, JSON, Map, Set, Number, String, Array, Object, isFinite, isNaN });
  const code = ["10-engine.js", "20-automation.js"].map((f) => fs.readFileSync(path.join(root, "src", f), "utf8")).join("\n");
  vm.runInContext(code + "\n;globalThis.__x = { sfcpAnalyze, sfcpActions, sfcpCause, sfcpReliability, sfcpSun, sfcpDays, sfcpAutomation, sfcpYaml, sfcpAction, sfcpHHMM };", ctx, { filename: "src" });
  return ctx.__x;
}
