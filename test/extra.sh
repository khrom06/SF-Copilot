#!/bin/bash
# Engine tests (pure functions, node only), in several time zones: day boundaries, weekends and sun times depend on the local clock.
set -uo pipefail
cd "$(dirname "$0")/.."
for z in Europe/Paris UTC America/Los_Angeles Asia/Tokyo Pacific/Auckland; do TZ=$z node test/engine.test.mjs | sed "s|^|[$z] |" || exit 1; done
