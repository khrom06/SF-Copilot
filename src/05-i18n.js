/* ==================================================================== I18N */
// French and English; any other language falls back to English. {x} is replaced by vars.x.
const SFCP_T = {
  fr: {
    title: "Copilote", sub: "{d} derniers jours · {n} actions faites à la main",
    loading: "Lecture de l'historique…", loading2: "Recherche des habitudes ({n} entités)…", error: "Historique illisible : {e}", retry: "Réessayer", rescan: "Analyser à nouveau",
    empty: "Aucune habitude assez régulière pour être automatisée.", emptyLoose: "Même en élargissant, aucune habitude ne ressort.", loose: "Montrer aussi les habitudes moins nettes", strict: "Seulement les habitudes nettes", emptyWhy: "Seulement {n} actions faites à la main en {d} jours : la maison est déjà très automatisée.", emptyFew: "Il faut au moins {m} jours d'historique.",
    on: "Allumer", off: "Éteindre", open: "Ouvrir", closed: "Fermer", locked: "Verrouiller", unlocked: "Déverrouiller", ib_on: "Activer", ib_off: "Désactiver", mode: "Mettre en « {m} »",
    all: "tous les jours", weekdays: "en semaine", weekend: "le week-end",
    at: "{a} {name} à {h}, {scope}", sun_before: "{a} {name} {n} min avant le {ev}, {scope}", sun_after: "{a} {name} {n} min après le {ev}, {scope}", sun_at: "{a} {name} au {ev}, {scope}",
    sunset: "coucher du soleil", sunrise: "lever du soleil",
    follow: "{a} {name} quand {tname} passe à « {ts} »", band: " (entre {f} et {t})", duration: "Éteindre {name} {n} min après l'avoir allumé",
    ev_time: "Fait à la main {h} jours sur {t} · écart ±{s} min", ev_follow: "{h} fois sur {t}, en général {d} s après", ev_duration: "Éteint à la main {h} fois, en général après {lo} à {hi} min",
    conf: "fiabilité", trial: "Essayer à blanc", create: "Créer l'automatisation", confirm: "Confirmer ?", ignore: "Ignorer", yaml: "Voir l'automatisation",
    trying: "À l'essai depuis {a}", wouldHave: "aurait agi {a}", neverYet: "n'a pas encore agi", promote: "Créer pour de vrai", stop: "Arrêter l'essai",
    created: "Automatisation créée", open: "Ouvrir", noAdmin: "Seul un administrateur peut créer les automatisations.",
    ignored: "{n} ignorée(s)", showAll: "Tout réafficher", failed: "Échec : {e}",
    alias: "SF Copilot · {s}", desc: "Créée avec SF Copilot à partir d'une habitude : {e}.", trialMsg: "Aurait fait : {s}",
    ago_now: "à l'instant", ago_min: "il y a {n} min", ago_h: "il y a {n} h", ago_d: "il y a {n} j",
  },
  en: {
    title: "Copilot", sub: "last {d} days · {n} actions done by hand",
    loading: "Reading the history…", loading2: "Looking for habits ({n} entities)…", error: "Could not read the history: {e}", retry: "Retry", rescan: "Analyse again",
    empty: "No habit regular enough to be automated.", emptyLoose: "Even with looser rules, no habit stands out.", loose: "Also show less clear habits", strict: "Only clear habits", emptyWhy: "Only {n} actions done by hand in {d} days: the house is already well automated.", emptyFew: "At least {m} days of history are needed.",
    on: "Turn on", off: "Turn off", open: "Open", closed: "Close", locked: "Lock", unlocked: "Unlock", ib_on: "Enable", ib_off: "Disable", mode: "Set to “{m}”",
    all: "every day", weekdays: "on weekdays", weekend: "at weekends",
    at: "{a} {name} at {h}, {scope}", sun_before: "{a} {name} {n} min before {ev}, {scope}", sun_after: "{a} {name} {n} min after {ev}, {scope}", sun_at: "{a} {name} at {ev}, {scope}",
    sunset: "sunset", sunrise: "sunrise",
    follow: "{a} {name} when {tname} becomes “{ts}”", band: " (between {f} and {t})", duration: "Turn off {name} {n} min after it was turned on",
    ev_time: "Done by hand on {h} of {t} days · ±{s} min", ev_follow: "{h} times out of {t}, usually {d} s later", ev_duration: "Turned off by hand {h} times, usually after {lo} to {hi} min",
    conf: "reliability", trial: "Dry run", create: "Create the automation", confirm: "Confirm?", ignore: "Ignore", yaml: "Show the automation",
    trying: "On trial since {a}", wouldHave: "would have acted {a}", neverYet: "has not acted yet", promote: "Create it for real", stop: "Stop the trial",
    created: "Automation created", open: "Open", noAdmin: "Only an administrator can create automations.",
    ignored: "{n} ignored", showAll: "Show them again", failed: "Failed: {e}",
    alias: "SF Copilot · {s}", desc: "Created with SF Copilot from a habit: {e}.", trialMsg: "Would have done: {s}",
    ago_now: "just now", ago_min: "{n} min ago", ago_h: "{n} h ago", ago_d: "{n} d ago",
  },
};
function sfcpTr(lang, key, vars) {
  const L = SFCP_T[lang] || SFCP_T.en, s = key in L ? L[key] : key in SFCP_T.en ? SFCP_T.en[key] : key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k]))) : s;
}
