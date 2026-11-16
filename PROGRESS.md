# SF-Copilot — progress (2026-11-16)

A local copilot for Home Assistant: reads the logbook, finds the people's manual habits and proposes the automation with its evidence,
a dry run (logbook only) and two-press creation. Frontend only, no cloud, no AI model.

## State
- v0.1.1, committed locally.
- Tests: `./test/run.sh` green — 68 engine checks in 5 time zones, 53 card checks in headless Chrome, lint (incl. "only writes its own
  automations"). Mutation checks done: creation without confirmation, scripts counted as human, writing another automation → all caught.
- Real-world run (21 days of history): the house was already well automated, so the card reported no clear habit instead of inventing
  proposals. No automation was created.

## Next ideas (not started)
1. Remove a habit that an automation now covers (compare with the automations' triggers), and show "covered" proposals.
2. Learn from "dry run" results: compare what the trial would have done with what the person really did afterwards (hit / false alarm).
3. More habit types: presence-based ("when the last person leaves"), scene-like groups ("these 3 lights together"), climate setpoints.
4. Visual editor, more languages, HACS.
