# Handoff: Avatar Kits control plane (cloud session -> Mac session)

**Status (2026-10-05):** the cloud session `session_01Wk8du8cXbw3LqniRkZGCuW` stopped at the operator's request. All further work
happens in the Mac session ("Mac session inventory and data export"), which can read `~/Desktop/AgentHome`, `hq/` and `life-rpg/`.
Everything the cloud session produced is in this branch (`claude/vibrant-davinci-a8rcxa`). Nothing was built yet: no prototype,
no plan document. The design panel finished 2 of 3 proposals; judging and synthesis did not run.

## What is in this branch

| Path | What it is |
|---|---|
| `docs/HANDOFF.md` | This file. Read first. |
| `docs/design/brief.md` | The complete problem statement: the operator's two messages verbatim, the Telegram bot's breakdown of the existing pipeline and its claim/created data corruption, verified facts, the friend's reference UI, and the operator's later answers with their implications. **This is the spec.** |
| `docs/design/proposal-1-one-door-the-kit-ledger.md` | Correctness-first proposal (event ledger, atomic claims, reconciliation, bot sync). |
| `docs/design/proposal-2-plugboard-a-manifest-driven-avatar-kits-.md` | Flexibility-first proposal (kit families, providers, process pages and adapters as manifests). |
| `docs/design/design-panel.workflow.js` | The Workflow script that produced the proposals (3 designers, 3 judges, 1 synthesizer). Only the two designers above finished. |
| `docs/research/README.md` and `01`..`06` | Sourced research with per-fact confidence: OneUp API fields, HeyGen avatar groups and the HeyGen kit, Telegram delivery limits and handoff state machine, Cloudflare D1/R2/Access limits and the backend comparison, kit-type schema and tag vocabulary, the "Adjust this process" mechanics. |

## Decisions already made with the operator

1. **Scope now:** the Avatar Kits slice only (kit families, tracking, VA handoff, accounts registry). Video creation, metadata changer and posting come later but must plug in naturally.
2. **The Google Sheet is retired as a system of record.** It caused the measured failures (45 phantom-free kits, 85 created accounts with no claim row, 37 unlogged owner stamps, 7 claimed kits that look free forever, `Y` vs `created`). It becomes a read-only export at most; import it once, reconcile, freeze, delete after parity.
3. **One source of truth, one write path:** the existing `jwco-hq` Cloudflare Worker. New tables in `hq/schema.sql`, new `/api/kits...` routes in `hq/src/index.js`, an R2 bucket binding for kit images, the existing Access login for humans, bearer tokens with roles for machine clients (the build scripts on the Mac, the two VA bots on the Mac mini). No second Worker, database, or auth system.
4. **Claims are database transactions** (unique open-claim constraint + append-only event log). Status and owner are derived from events. Every non-claimable kit carries a machine-readable block reason that the UI and the bots show inline.
5. **The VA bots barely change:** `kitctl.py claim-next --va mark` keeps its CLI but becomes a thin HTTPS client of the API. `sync-sheet` goes away. The raw `character_tracker.js upsert --field va_owner=` path is removed from the skill docs.
6. **The kit builder is not rewritten.** `build_kit.py` keeps running on the Mac; it reports steps and uploads assets (reference sheet, PFP, postables) to the API. Hard constraints (Atlas GPT Image 2 only, rate limits, tar-over-ssh, never post/Drive/video) stay as they are.
7. **Kit families are data:** a policy block per family (claim predicate fields, pfp_mode, postable count, image slots, metadata fields, process steps, handoff template). `transformation` and `heygen` ship first.
8. **Front end:** a workspace module inside `life-rpg/` (plain HTML/CSS/JS), mounted from `life-rpg/js/biz.js`, following the existing router and theme; deployed with Wrangler from the Mac. Visual direction: the friend's "reel studio" (dark theme, sidebar groups, numbered steps, cards, right rail, plain-English microcopy).
9. **"Adjust this process"** on each process page composes a brief (page id, current config JSON, file paths, the operator's request) for a Mac-side Claude Code session; the claude.ai/code prefilled link is optional once `hq/` and `life-rpg/` are in a repo.

## Order of work for the Mac session

0. **(Started)** Inventory into `docs/mac-inventory.md` and CSV exports into `docs/data/` (sheet tab "Avatar Tracker" and `CLAIM_LOG`), secrets redacted. Note: the Mac session already has `IxParacosm/agent-home` checked out on branch `reel-produce-speed` (no upstream), so AgentHome may already be a git repo; use it rather than creating another.
1. **Write `docs/avatar-kits-plan.md`** by reading both proposals against the real files and the real sheet columns. Keep what both agree on; where they differ, prefer the simpler mechanism that still makes the five failure classes in `brief.md` section 2 impossible. Sections: Summary; What exists today; Architecture; Data model (tables + JSON shapes); State machine and claimability (states, events, per-family predicate, block reasons); API contract and the kitctl command mapping; VA bot sync (including offline behaviour: fail closed, never double-claim); Build pipeline integration; Process pages as numbered steps with microcopy; "Adjust this process"; Migration and reconciliation (discrepancy classes with bulk resolutions, asset uploader, an afternoon runbook); OneUp and the accounts registry (join keys); Phased delivery; Risks; Open questions.
2. **Phase 0 (foundation):** D1 migration for the new tables; `/api/kits`, `/api/claims`, `/api/events`, `/api/accounts`, `/api/vas`, `/api/families` routes with Access for humans and bearer tokens for machines; `kitctl` HTTP client with the same CLI; the importer (CSV -> D1) and the reconciliation screen in the biz workspace; the asset uploader run once over the packet folders on the Mac/mini.
3. **Phase 1 (daily loop):** kits board with block reasons, kit detail with the reference sheet and the event timeline, claim pool ("what Mark's bot gets next"), VAs page (two bots, devices, current claims), kit families config page, accounts registry with OneUp `listsocialaccounts` sync and manual linking, account-created capture from the bots.
4. **Phase 2:** the `heygen` family end to end, the "Adjust this process" button, read-only sheet export if still wanted, then the next slices (video creator, posting).

## Open questions for the operator (answer whenever convenient)

1. Which OneUp plan, and how are categories used today (per persona, per VA, per platform)?
2. For HeyGen kits: should the site call HeyGen's API (upload, create avatar group, generate looks) or only track ids created in the HeyGen app?
3. Where should original kit images live long term: R2 behind Access (recommended), or stay on the Mac/mini with only thumbnails uploaded?
4. What credentials does a VA need per account (email alias, phone, 2FA), who provisions them, and is a one-time link acceptable instead of plain text in Telegram?
5. Should VAs see each other's kits, or only their own?
6. Which fields in the Avatar Tracker tab are edited by hand today (and by whom), so the importer knows which columns to trust?
7. Keep the Mac mini packet sync as the delivery path, or move delivery to Telegram albums from the API?

## Paste-ready prompt for the Mac session

> Read `docs/HANDOFF.md` on branch `claude/vibrant-davinci-a8rcxa` of IxParacosm/IxParacosm.github.io, then `docs/design/brief.md`,
> both proposals in `docs/design/`, and `docs/research/README.md`. Finish step 0 if not done, then do step 1 (write
> `docs/avatar-kits-plan.md`) and stop for my review before changing `hq/` or `life-rpg/`.
