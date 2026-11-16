# SF Copilot

**Your home already knows what you want automated: you do it by hand every day.** SF Copilot reads Home Assistant's own history, finds the
things you keep doing yourself — the same light at the same time, the same switch after the same door, the same appliance turned off after
the same delay — and proposes the automation, with the evidence, a dry run and one-press creation.

No cloud, no AI model, no data leaving the house: plain statistics in your browser, on the history Home Assistant already keeps.

```yaml
type: custom:sf-copilot-card
```

## Why

Home Assistant is getting easier every month (automatic dashboards, the Marketplace, "Triggered by", AI tasks), but writing an automation
still starts from a blank page: you have to know what to automate, and how. Most homes are full of small routines nobody ever turns into
automations, because nobody notices them any more.

SF Copilot starts from the other end: **from what the people in the house actually do**, and only that.

## What it finds

| Habit | Example | The automation it proposes |
|---|---|---|
| Same time of day | "Desk lamp on around 19:25, on 17 of the last 20 weekdays" | time trigger, weekdays / weekends / every day |
| Follows the sun | "Porch light on 15 min before sunset, every day for 4 weeks" (the clock time drifts, the sun offset does not) | sun trigger with offset |
| After an event | "Hall light on within a minute after the front door opens, 9 times out of 10" (optionally only at certain hours) | state trigger, time window |
| Turned off after a while | "Towel heater turned off by hand 17 times, usually 40 to 50 min after it came on" | state-for trigger |

Every proposal shows **why**: how many times, out of how many occasions, a strip of the days it happened, and a reliability score.

## What it ignores, on purpose

- What is **already automated**: changes made by automations, scripts (even one a person started) and service accounts (Node-RED,
  AppDaemon… run as system users) are not habits.
- Changes with **no context at all** (a wall switch, but just as often an integration syncing or a device coming back online) — unless you
  set `physical: true`.
- Things too regular to be a person (to the minute, every day): that is a timer somewhere.
- Things done together in the same second (a group, a scene): one action, not a habit.
- Entities that change all the time (screensavers, chargers polling): left out before the full history is read.

If the house is already well automated, the card says so, with the numbers, instead of inventing proposals.

## Dry run, then for real

1. **Dry run** creates an automation that only writes in the logbook what it would have done. The card shows since when it has been on
   trial and when it last "would have acted".
2. **Create it for real** (two presses) creates the real automation and removes the trial.
3. **Ignore** hides a proposal for you (saved in your Home Assistant user data, so it follows you on every device).

Created automations are ordinary ones: they are in Settings → Automations, editable like any other, named `SF Copilot · …`. The card only
ever creates or deletes **its own** automations (ids `sf_copilot_…`; a test fails if the code tries to write anything else). Only
administrators see the create buttons.

## Options

```yaml
type: custom:sf-copilot-card
days: 21            # history analysed, 7 to 60
max: 8              # proposals shown
exclude:            # never proposed
  - light.night_light
physical: false     # true: changes with no context count as manual actions
theme: auto         # dark | light | auto
```

## Installation

Manual for now: copy `dist/sf-copilot.js` to `/config/www/sf-copilot/`, add the resource `/local/sf-copilot/sf-copilot.js` (JavaScript
module) in Settings → Dashboards → Resources, then add the card.

Requires Home Assistant with the recorder and logbook (on by default). French and English.

## Development

```bash
./test/run.sh    # build check, reliability rules, engine tests in 5 time zones, card tests in headless Chrome
```

`src/10-engine.js` (habit detection) and `src/20-automation.js` (automation builder) are pure functions with no DOM: they are tested in
node on synthetic histories where the right answer is known, including the cases that must give nothing.

## License

MIT. Part of the SF family ([SF Cards](https://github.com/khrom06/SF-Cards)).
