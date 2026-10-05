# Handoff: Avatar Kits control plane (cloud session -> Mac session)

Written 2026-10-05 by the cloud session `session_01Wk8du8cXbw3LqniRkZGCuW` (branch `claude/vibrant-davinci-a8rcxa`).
A session running on the Mac should read this file first, then `docs/research/README.md`, then `docs/avatar-kits-plan.md` (written when the design panel finishes).

## What the operator asked for

Integrate the avatar workflow into the HQ site (hq.jwcoconsulting.com), starting with the Avatar Creator Kit slice only:
flexible kit families (transformation = 3 before + 3 after masters; heygen = 1 to 3 strong reference stills; more later),
a UI page per process with an "Adjust this process" button that routes changes to Claude, tracking of every kit and which VA
has it, delivery to the two VA Telegram bots, import of all existing kits, and one clear accounts registry merging OneUp and
the Google Sheet. The operator wants simplicity and a bulletproof system.

## What the cloud session established

- The HQ site is a Cloudflare Worker named `jwco-hq` (static assets + `/api` routes), deployed from the Mac with Wrangler.
  Folders on the Mac: `hq/` (wrangler.jsonc with the D1 binding, custom domain and Access; `src/index.js` login check and data API;
  `schema.sql`; `build.mjs`) and `life-rpg/` (plain HTML/CSS/JS; `build.mjs` copies into `hq/public/`; `life-rpg/js/biz.js` is the
  Business workspace placeholder to plug into). Neither folder is in git yet.
- The kit builder already exists as local Python under `~/AgentHome/CLAUDE/AI-Characters` and `~/AgentHome/PROJECTS/farm-kits`
  (`build_kit.py` chain, `kitctl.py`, `character_tracker.js`, `CLAIM_LOG`, `heygen-kits/`). Do not rebuild it. The website is the
  control plane and the single source of truth for kit state, claims, VA ownership, created accounts and the accounts registry.
- The measured failure is state split across the Google Sheet (tab "Avatar Tracker", ~106 rows), `CLAIM_LOG` and the local tracker:
  45 kits looked free while their accounts existed, 85 created accounts had no claim row, 37 owner stamps were never logged,
  7 claimed kits look free forever, and one flag is written as both `Y` and `created`.
- Verdict on the Google Sheet: retire it as a system of record. One database behind one HTTP API (the existing `jwco-hq` Worker:
  new tables in `schema.sql`, new `/api/kits...` routes in `src/index.js`, an R2 bucket for kit images, Access for humans, bearer
  tokens for the build scripts and the two bots). `kitctl` becomes a thin HTTP client so the VA bots barely change; a claim is a
  database transaction; every non-claimable kit carries a block reason the bot shows. The sheet becomes a read-only export at most.
- The two VA bots (Account_Creation_VA_1_Bot = mark, Account_Creation_VA_2_Bot = joanna) are Hermes profiles on the Mac mini
  paired with Pixel phones; they can reach HTTPS.
- Research with sources is in `docs/research/` (OneUp API fields, HeyGen avatar groups, Telegram limits, Cloudflare D1/R2/Access
  limits, kit-type schema and tag vocabulary, the "Adjust this process" mechanics).

## What the cloud session could not do

- Read the Mac (AgentHome, hq/, life-rpg/) or the Google Sheet (proxy blocks docs.google.com; no Google connector).
- `git push`: refused with 403 because the Claude GitHub App is not installed on IxParacosm/IxParacosm.github.io.
  Install it at https://github.com/apps/claude/installations/select_target, or the cloud session pushes through the GitHub connector.

## First tasks for the Mac session (in order)

1. Inventory the real system and write `docs/mac-inventory.md`: full tree of `~/AgentHome` (depth 3), `hq/`, `life-rpg/`;
   the exact contents of `kitctl.py`, `character_tracker.js` (record fields), `TEMPLATE.md`, `KIT-GET-OR-BUILD.md`, the `CLAIM_LOG`
   row format, one complete kit packet folder listing, and `hq/schema.sql`, `hq/wrangler.jsonc`, `hq/src/index.js`,
   `life-rpg/js/biz.js` plus the router. Never copy secrets (`.env*`, bot tokens, service-account JSON, signup credentials).
2. Export the Google Sheet tab "Avatar Tracker" and `CLAIM_LOG` to CSV into `docs/data/` (the sync-sheet code already holds a
   Google credential; reuse it read-only). Redact passwords and emails if any column holds them.
3. Put `hq/`, `life-rpg/` and the kit scripts under private git with a `.gitignore` that excludes secrets and packets.
4. Then implement the plan in `docs/avatar-kits-plan.md`: schema migration, API routes, kitctl HTTP client, the importer and
   reconciliation screen, the life-rpg workspace module.

## Paste-ready prompt for the Mac session

> Read `docs/HANDOFF.md` in the IxParacosm.github.io repo (branch claude/vibrant-davinci-a8rcxa), then `docs/research/README.md`
> and `docs/avatar-kits-plan.md`. Do task 1 and task 2 from the handoff first and stop for my review before changing anything in
> hq/ or life-rpg/.
