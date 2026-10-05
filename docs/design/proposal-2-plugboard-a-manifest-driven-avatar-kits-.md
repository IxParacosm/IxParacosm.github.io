# Proposal 2: Plugboard: a manifest-driven Avatar Kits control plane

_Angle: Flexibility-first: a small registry/plugin architecture where kit families (policy blocks), providers, process pages, data adapters and export templates are declared as data, so new ways of making avatars and videos are added without rewrites; later slices (metadata changer, video creator, posting) plug into the same ledger, registry and router._

Produced 2026-10-05 by the cloud session's design panel (one of three independent proposals; the judging and synthesis phases did not run because the work moved to the Mac session). Treat as input, not as the decision.


## Elevator pitch

One ledger, one write path, five registries. The HQ site becomes the single source of truth for kit state, claims, VA ownership and the accounts registry: every change is an append-only event in Cloudflare D1, and status/owner/claimability are projections rebuilt from those events, so the Sheet-era failure classes (phantom-available kits, unlogged owner stamps, two spellings of one flag, claimed-but-looks-free) cannot be expressed in the data model at all. Everything that varies between ways of making avatars or videos (kit families with their policy block and image slots, providers with their recorded constraints and prices, numbered process pages, export/handoff templates, data adapters) is a JSON manifest in registry/, validated against a meta-schema and rendered by generic code, so adding the HeyGen family or, later, a Kling clip step is a new file, not a rewrite. The Mac build scripts and the two VA bots stay exactly what they are and become thin HTTP clients of one API; kitctl keeps its command names.


## Is the Google Sheet still necessary?

## Verdict: the Google Sheet is no longer necessary, and as a writable store it is the problem

Honest answer: retire the "Avatar Tracker" tab as a source of truth on cutover day. Keep a frozen copy for the record. Do not build the new system to write to it.

### Why (each measured failure maps to a property of spreadsheets)

| Measured failure (from the bot's audit) | Spreadsheet property that caused it |
|---|---|
| 45 kits read as free while "Created OK" says the account exists | A cell is a free-text projection with no referential link to the thing it describes. Nothing stops a blank "VA Owner" next to a created account. |
| 53 rows say `Y`, 37 say `created`, plus `burned`/`N`/`failed`/`''` in one column; the gate only knew `created`/`burned` | No enum, no validation, two writers (kitctl and character_tracker.js) spelling the same flag differently. |
| 85 of 90 created accounts have no CLAIM_LOG row; 37 owner stamps unlogged | No transactions: a raw upsert can write the projection without writing the log. The sheet cannot refuse a write that skips the log. |
| 7 kits claimed in the log but owner cell wiped ("free forever") | The cell can be edited by hand or by a later sync; the log cannot reach back and correct it. |
| `pipeline_stage` stale vs `Lifestyle Ready` (Elaine Whitmore) | Two human-maintained strings describing one state; nothing derives one from the other. |
| Two bots could take the same kit via Door B | No row locking, no unique constraint. flock on one Mac only protects one door. |

A second, structural point: the Sheets API has no row identity (rows shift on sort/insert), needs a GCP service account to read privately (one more credential on the Mac), and the research's own scoring put "Sheet as DB" at 20/35 vs 31/35 for Cloudflare D1/R2. The research suggested keeping the sheet short-term "because the VAs already edit it"; per your bot's description that premise is false: the VAs never touch the sheet, the bots write it via `sync-sheet`. So the only remaining writer would be our own code, which is pointless once D1 holds the truth.

### What replaces the sheet's remaining value

| Value the sheet gave you | Replacement in Plugboard |
|---|---|
| Glance at all rows on one screen | Kits board has a **Table** mode (dense, every column, sortable, filterable, works on the phone behind Access) and **Export CSV** using the `legacy_sheet_csv` export template, which emits the exact old column headers so your eyes already know the layout. |
| VA familiarity | VAs never read the sheet; they talk to their bot. The bot's `kitctl list` now prints the **honest list** (kit + block reason) from the same predicate the UI shows. |
| Manual edits | Kit detail -> "Edit persona / Hold / Retire" writes events (with your email as actor). Bulk edits: drop a CSV on the Reconciliation page; it becomes proposed events you apply per class. Nothing edits a projection directly. |
| Backup / "I can always open it" | D1 Time Travel (7 days free) + nightly `wrangler d1 export` to R2 (`backups/hq-YYYY-MM-DD.sql`) via cron + the frozen archive tab. |
| A Google-side mirror for habit | Optional Phase 3 only if you ask after two weeks on the board: a Worker cron writes a read-only tab "Avatar Tracker (MIRROR, edits do nothing)". Default: not built, because it adds a GCP service account for no decision-making value. |

### Cutover-day checklist (Reconciliation page, step 6)
1. Duplicate the tab -> rename `Avatar Tracker ARCHIVE 2026-10-xx`, protect the range (view only).
2. Remove `SHEET_*` credentials from `~/AgentHome/.../.env.local` and from `character_tracker.js` config, so Door B physically cannot write anywhere.
3. `kitctl sync-sheet` becomes a no-op that prints `sheet retired 2026-10-xx; HQ is the source of truth` (so old skill text does not break).
4. Delete the `upsert --field va_owner=` code path from character_tracker.js (or the whole file if nothing else uses it). KIT-GET-OR-BUILD.md step 4 is rewritten to `kitctl claim`.


## Architecture

## Shape

```
 Mac + mini (builder)             HQ site (browser)                  VA bots (Hermes x2, Pixel x2)
 cast_from_bank.py / build_kit.py #biz/kits  modules/kits/           kitctl v2 (same command names)
 hq_client.py  (HTTP, outbox)     adapters/http.js                   HQ_TOKEN=hqk_mark_... / hqk_joanna_...
         |                                |                                   |
         v                                v                                   v
 +-----------------------------------------------------------------------------------------+
 |  Cloudflare Worker `hq-kits`   route: hq.jwcoconsulting.com/api/kits/*  (same origin)   |
 |  auth: Access JWT (humans)  |  bearer tokens hashed in D1 (machines)  |  roles.json     |
 |  core/  registry.js  gates.js  reduce.js  exports.js   <- the SAME files the UI runs    |
 |  ledger: D1 `events` (append-only)  ->  projections: kits, kit_assets, claims, accounts |
 |  assets: R2 `hq-kits-assets`   cron: oneup sync, stale-claim flags, nightly d1 export   |
 +-----------------------------------------------------------------------------------------+
                                   ^
            registry/*.json  (committed in the repo; bundled into the Worker; served to the UI)
```

Backend: Cloudflare Workers + D1 + R2 + Access (OTP email), as the research scored best (31/35, $0/month at this scale; $5/month Workers Paid only if a cron ever needs more than 10 ms CPU). I keep that choice because the site is already behind Cloudflare, one `wrangler deploy` ships API + cron + static module together, D1 is SQLite that Claude Code can migrate with plain `.sql` files, and no service pauses when you do not log in for a week (Supabase Free does).

## The five registries (everything that varies is data)

```
registry/
  index.json                     # versions + the list of everything below
  modules.json                   # avatar_kits now; metadata, video, posting later
  families/transformation.json   # policy block + slots + fields + build steps + exports
  families/heygen.json
  families/couple_transformation.json   # third example: extends transformation
  providers/atlas_gpt_image2.json       # image gen; constraints recorded
  providers/grok_imagine.json           # qc_only: true
  providers/mini_ssh.json               # transport: tar-over-ssh, never rsync
  providers/heygen.json                 # avatar provider (v3 first, v2 fallback)
  providers/telegram_bot.json           # the two VA bots
  providers/oneup.json                  # accounts registry + (later) posting
  processes/handoff.json                # numbered page: hand-off & account creation
  processes/reconcile.json              # numbered page: import + reconciliation
  exports/telegram_handoff.json         # caption + control text the bot sends
  exports/signup_txt.json               # the signup .txt layout
  exports/va_brief.json
  exports/legacy_sheet_csv.json         # old column headers, for glancing + rollback
  reconcile/classes.json                # discrepancy classes -> allowed resolutions -> events
  clients/roles.json                    # role -> allowed endpoints/event types
  vocab/kit_states.json  vocab/block_reasons.json  vocab/event_types.json  vocab/tags.json
  schema/*.schema.json                  # meta-schemas; scripts/validate-registry.mjs checks every file
```

| Registry kind | Consumed by | Adding one means |
|---|---|---|
| **family** (policy block, image slots, metadata fields, build steps, exports) | `gates.js` (claimability), UI (slot grid, forms, Build page), uploader (slot mapping), exports | drop `families/<id>.json`, run `validate-registry`, deploy |
| **provider** (kind, capabilities, constraints[], price{mode,usd,as_of}, secrets[]) | Build page (constraint callouts), later video/posting price cards | drop a file |
| **process** (numbered steps, microcopy, kind, done_when, adjust) | generic `ProcessPage` renderer | drop a file, link it from `modules.json` nav or a family |
| **export** (channel, template, include/redact lists) | `GET /api/kits/:id/export/:export_id`, bots, Build page | drop a file |
| **adapter** (`adapters/static.js`, `adapters/http.js`) | UI bootstrap | implement the 14-method `KitsAPI` interface |

The one non-data piece per family is the **gate predicate library** (`core/gates.js`): ten named predicates (`status_in`, `no_open_claim`, `no_account`, `not_held`, `slots_filled`, `pfp_mode_satisfied`, `event_present`, `field_present`, `va_allowed`, `claim_not_stale`). A family's policy block *composes* them; it never edits them. A genuinely new predicate is a code change with a unit test, which should be rare.

## Isomorphic core
`core/reduce.js` (events -> kit flags -> status), `core/gates.js` (policy + flags -> block reasons), `core/registry.js` (load + validate), `core/exports.js` (render templates) are plain ES modules with no I/O. The Worker imports them; the browser imports the same files. In the prototype the static adapter runs them over `data/sample/events.json` plus whatever you append in localStorage, so the prototype exercises the real state machine, not a mock.

## Clients (all through the one API)
1. HQ UI (role `operator`, via Access).
2. `hq_client.py` imported by cast_from_bank.py / build_kit.py (role `builder`): register, upload assets, step events, packet_synced. Keeps an outbox `scripts/hq_outbox.jsonl` and replays with the same idempotency keys if HQ was unreachable.
3. `kitctl` v2 (role `va_bot`, one token per VA, token pinned to `va_id`).
4. `hq_upload_packets.py` one-off uploader (role `importer`).
5. Worker cron (role `sync`): OneUp pull, stale-claim flags, nightly export.

## How later slices plug in
`registry/modules.json` is the only list the host router reads:
```json
[
 {"id":"avatar_kits","route":"#biz/kits","entry":"modules/kits/kits.module.js","events":["kit.*","asset.*","build.*","qc.*","claim.*","account.*","import.*"],"nav":[...]},
 {"id":"metadata","route":"#biz/meta","entry":"modules/meta/meta.module.js","events":["meta.*"],"consumes":["kit_assets"],"registries":["metadata_profiles"]},
 {"id":"video","route":"#biz/video","entry":"modules/video/video.module.js","events":["video.*"],"consumes":["kit_assets","providers"],"registries":["video_recipes","providers"]},
 {"id":"posting","route":"#biz/post","entry":"modules/post/post.module.js","events":["post.*"],"consumes":["accounts","clips"],"registries":["providers"]}
]
```
- **Metadata changer**: `registry/metadata_profiles/*.json` (device model, EXIF fields, timestamp jitter, GPS policy; the iPhone-EXIF spoof you already do becomes `iphone_15_default.json`). Process page "Change metadata" renders from it; events `meta.profile_applied{asset_id, profile_id, output_asset_id}`; output is a new `kit_assets` row with `derived_from`.
- **Video creator**: provider cards `providers/kling30_poyo.json`, `providers/genjutsu_higgsfield.json`, `providers/heygen_av4.json` (same provider schema, `kind: video_gen`, `price`, `keeps_place`, `inputs`), `registry/video_recipes/transformation_reel.json` (hook -> build -> reveal, framing-match rule) and `heygen_talking_head.json`; a `clips` table tagged with `vocab/tags.json`; the friend's "Make new clips" page is a `process` manifest whose step 3 is `kind: provider_pick`. A family declares `compatible_recipes` so the video page knows which kits can drive which recipe.
- **Posting**: `providers/oneup.json` gains `capabilities: ["accounts","post"]`; `posts` table; events `post.scheduled|published|failed`; cron polls `getscheduledposts/getpublishedposts/getfailedposts`. The accounts registry built in this slice already carries `oneup_account_id`, so posting needs no new join.
All modules share the ledger, `kits`, `kit_assets`, `accounts`, the provider registry, the tag vocabulary, the adapter interface and the Adjust mechanics.


## Data model

## D1 schema (`migrations/0001_init.sql`)

```sql
-- THE LEDGER. Append-only. Never UPDATE/DELETE (a trigger raises on both).
CREATE TABLE events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT NOT NULL UNIQUE,          -- ULID, generated by the Worker
  ts             TEXT NOT NULL,                 -- ISO-8601 UTC, Worker clock
  client_ts      TEXT,                          -- what the client thought the time was (outbox replays)
  type           TEXT NOT NULL,                 -- vocab/event_types.json, e.g. 'claim.opened'
  kit_id         TEXT,                          -- NULL for non-kit events (sync.*, va.*, import.batch_received)
  subject_type   TEXT NOT NULL,                 -- 'kit' | 'claim' | 'account' | 'va' | 'import_batch' | 'sync'
  subject_id     TEXT NOT NULL,
  actor_kind     TEXT NOT NULL,                 -- 'operator' | 'builder' | 'va_bot' | 'importer' | 'sync'
  actor_id       TEXT NOT NULL,                 -- email, token label, 'mark', 'cron'
  source         TEXT NOT NULL,                 -- 'ui/0.3' | 'kitctl/2.0' | 'hq_client/1.0' | 'import:sheet' ...
  idempotency_key TEXT UNIQUE,                  -- from the Idempotency-Key header
  batch_id       TEXT,                          -- import batch or claim-next attempt id
  payload        TEXT NOT NULL                  -- JSON
);
CREATE INDEX events_kit ON events(kit_id, seq);
CREATE INDEX events_type ON events(type, seq);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;

-- Idempotent replay: same key -> same response, no second event.
CREATE TABLE idempotency (key TEXT PRIMARY KEY, status INTEGER, response TEXT, created_at TEXT);

-- PROJECTIONS. Derived from events by core/reduce.js. Rebuildable: POST /api/kits/admin/rebuild.
CREATE TABLE kits (
  kit_id         TEXT PRIMARY KEY,              -- 'kit_' + ULID
  slug           TEXT NOT NULL UNIQUE,          -- 'elaine-whitmore', 'elaine-joel-brooks'
  display_name   TEXT NOT NULL,                 -- 'Elaine Whitmore' (packet folder name on the mini)
  family_id      TEXT NOT NULL,                 -- registry/families/<id>.json
  family_version INTEGER NOT NULL,
  status         TEXT NOT NULL,                 -- vocab/kit_states.json (one vocabulary)
  hold_reason    TEXT,                          -- NULL = not held
  pfp_mode       TEXT,                          -- 'real_face' | 'solid_color' | NULL (family decides)
  persona        TEXT NOT NULL,                 -- JSON of family.metadata_fields values
  flags          TEXT NOT NULL,                 -- JSON: {qc, packet_synced, slots_ok, rework_requested, ...}
  ready_since    TEXT,                          -- for oldest-first claim ordering
  version        INTEGER NOT NULL DEFAULT 0,    -- optimistic concurrency
  last_event_seq INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX kits_status ON kits(status, ready_since);

CREATE TABLE kit_assets (
  asset_id   TEXT PRIMARY KEY,                  -- 'ast_' + ULID
  kit_id     TEXT NOT NULL REFERENCES kits(kit_id),
  slot_id    TEXT NOT NULL,                     -- from family.image_slots, e.g. 'before','after','reference_sheet','pfp','postable','signup_txt','reference'
  slot_index INTEGER NOT NULL DEFAULT 0,
  r2_key     TEXT NOT NULL,                     -- kits/<kit_id>/<slot>/<index>-<sha8>.<ext>
  thumb_key  TEXT,                              -- kits/<kit_id>/<slot>/<index>-<sha8>.thumb.jpg (uploaded by the client)
  sha256     TEXT NOT NULL,
  bytes INTEGER, width INTEGER, height INTEGER, mime TEXT,
  tags       TEXT,                              -- JSON, vocab/tags.json (phase, framing, place...)
  derived_from TEXT,                            -- asset_id (pfp from after_2, metadata-changed copies later)
  telegram_file_id TEXT,                        -- cache; per-bot, so JSON {mark:..., joanna:...}
  created_at TEXT NOT NULL,
  UNIQUE(kit_id, slot_id, slot_index)
);

CREATE TABLE claims (
  claim_id   TEXT PRIMARY KEY,                  -- 'clm_' + ULID
  kit_id     TEXT NOT NULL REFERENCES kits(kit_id),
  va_id      TEXT NOT NULL,
  opened_at  TEXT NOT NULL,
  opened_event_id TEXT NOT NULL,
  released_at TEXT,                             -- NULL = open
  release_reason TEXT,                          -- 'fulfilled' | 'released_by_va' | 'needs_images' | 'burned' | 'operator' | 'expired' | 'backfill_closed'
  backfilled INTEGER NOT NULL DEFAULT 0         -- 1 when created by reconciliation
);
-- THE atomicity guarantee: at most one open claim per kit, enforced by SQLite, not by code.
CREATE UNIQUE INDEX claims_one_open_per_kit ON claims(kit_id) WHERE released_at IS NULL;
CREATE INDEX claims_va_open ON claims(va_id) WHERE released_at IS NULL;

CREATE TABLE accounts (
  account_id   TEXT PRIMARY KEY,                -- 'acc_' + ULID
  kit_id       TEXT REFERENCES kits(kit_id),    -- NULL for accounts with no kit (CSV/OneUp-only rows)
  platform     TEXT NOT NULL,                   -- 'instagram' | 'tiktok' | 'youtube' | ...
  handle       TEXT NOT NULL,                   -- as typed, '@' stripped
  handle_norm  TEXT NOT NULL,                   -- lowercase, no '@'
  display_name TEXT,
  status       TEXT NOT NULL,                   -- 'reported' | 'verified' | 'live' | 'burned' | 'failed' | 'unknown'
  va_id        TEXT,                            -- 'mark' | 'joanna' | 'unknown'
  created_at   TEXT,                            -- when the VA created it (may be backfilled/approximate)
  oneup_account_id TEXT,                        -- OneUp social_account_id (TEXT, 15+ digits)
  oneup_category_id INTEGER,
  source       TEXT NOT NULL,                   -- 'kitctl' | 'ui' | 'import:sheet' | 'import:csv' | 'oneup'
  notes        TEXT,
  UNIQUE(platform, handle_norm)                 -- "that account already exists" is a 409, not a surprise
);
CREATE INDEX accounts_kit ON accounts(kit_id);

CREATE TABLE oneup_accounts (                   -- raw mirror of GET /api/listsocialaccounts
  oneup_account_id TEXT PRIMARY KEY, username TEXT, full_name TEXT, platform TEXT, is_expired INTEGER,
  category_ids TEXT, raw TEXT, synced_at TEXT
);

CREATE TABLE vas (
  va_id TEXT PRIMARY KEY,                       -- 'mark' | 'joanna'
  name TEXT, bot_username TEXT, hermes_profile TEXT, device_id TEXT,
  telegram_user_id TEXT, status TEXT NOT NULL,  -- 'active' | 'paused'
  allowed_families TEXT NOT NULL                -- JSON ["transformation","couple_transformation"]
);

CREATE TABLE client_tokens (
  token_id TEXT PRIMARY KEY, label TEXT NOT NULL, role TEXT NOT NULL,   -- 'builder' | 'va_bot' | 'importer' | 'sync'
  va_id TEXT,                                   -- set for role va_bot; the token can only act as this VA
  token_hash TEXT NOT NULL,                     -- SHA-256 of the bearer; the plaintext is shown once
  created_at TEXT, last_used_at TEXT, revoked_at TEXT
);

CREATE TABLE build_steps (                      -- projection of build.step_* events
  kit_id TEXT, step_id TEXT, attempt INTEGER, status TEXT, started_at TEXT, done_at TEXT, log_ref TEXT, error TEXT,
  PRIMARY KEY (kit_id, step_id, attempt)
);

CREATE TABLE import_batches (batch_id TEXT PRIMARY KEY, source TEXT, filename TEXT, row_count INTEGER, received_at TEXT, mapping_id TEXT);
CREATE TABLE import_rows (
  row_id TEXT PRIMARY KEY, batch_id TEXT, row_no INTEGER, raw TEXT, normalized TEXT,
  slug_guess TEXT, kit_id TEXT, discrepancy_class TEXT,   -- registry/reconcile/classes.json
  proposed_events TEXT,                                   -- JSON array shown in the UI before Apply
  resolution TEXT, resolved_at TEXT, resolved_event_ids TEXT
);
```

## Event payload shapes (vocab/event_types.json documents every one)

```json
{"event_id":"01J9ZK7...","ts":"2026-10-05T18:02:11Z","type":"claim.opened","kit_id":"kit_01J9...","subject_type":"claim","subject_id":"clm_01J9...",
 "actor_kind":"va_bot","actor_id":"mark","source":"kitctl/2.0","idempotency_key":"01J9ZK6...","payload":{"va_id":"mark","picked_by":"claim-next","candidates_skipped":1}}

{"type":"kit.registered","payload":{"slug":"elaine-whitmore","display_name":"Elaine Whitmore","family_id":"transformation","family_version":2,"pfp_mode":"solid_color","persona":{"first_name":"Elaine","last_name":"Whitmore","age_band":"older","handle":"elaine.whitmore57","dob":"1969-03-02","bio":"...","email":{"secret_ref":"hme:elaine-whitmore"}}}}
{"type":"asset.uploaded","payload":{"asset_id":"ast_...","slot_id":"reference_sheet","slot_index":0,"sha256":"...","bytes":2411233,"width":3072,"height":2048,"r2_key":"kits/kit_.../reference_sheet/0-9f3a2c1d.png"}}
{"type":"build.step_done","payload":{"step_id":"kit_reference","attempt":1,"log_ref":"scripts/logs/elaine-whitmore.kit_reference.log","duration_s":412}}
{"type":"build.packet_synced","payload":{"host":"mini","path":"/Users/mini/packets/Elaine Whitmore","method":"tar-over-ssh","bytes":18233411}}
{"type":"qc.approved","payload":{"note":"before clearly heavier, same face"}}
{"type":"qc.rerolled","payload":{"frames":["after_2"],"note":"after_2 looks like a different person"}}
{"type":"account.created","payload":{"account_id":"acc_...","platform":"instagram","handle":"elaine.whitmore57","claim_id":"clm_...","va_id":"mark"}}
{"type":"kit.images_rejected","payload":{"note":"VA says pfp has artifact","by_claim":"clm_..."}}
{"type":"kit.held","payload":{"reason":"legacy_skip_list"}}
{"type":"import.row_resolved","payload":{"batch_id":"imp_...","row_id":"...","class":"CREATED_LOOKS_FREE","resolution":"record_account_unknown_va"}}
```

## Kit record as the API returns it (`GET /api/kits/:id`)
```json
{"kit_id":"kit_01J9...","slug":"elaine-whitmore","display_name":"Elaine Whitmore","family_id":"transformation","family_version":2,
 "status":"packaging","hold":null,"pfp_mode":"solid_color","persona":{...},
 "slots":{"before":[{"asset_id":"ast_1","url":"/api/kits/kit_01J9/assets/ast_1","thumb":"...?v=thumb"}],"after":[...],"reference_sheet":[...],"pfp":[...],"postable":[...],"signup_txt":[...]},
 "flags":{"qc":"approved","packet_synced":false,"slots_ok":true,"rework_requested":false},
 "claim":null,"account":null,
 "claimable":false,
 "block_reasons":[{"code":"NOT_READY","detail":"status=packaging; waiting for build.packet_synced","since":"2026-09-28T10:11:00Z","fix":"Run mini-sync for elaine-whitmore"}],
 "build_steps":[{"step_id":"kit_reference","status":"done"},...],
 "timeline":[{"seq":1203,"ts":"...","type":"qc.approved","actor":"william@jwcoconsulting.com"}, ...],
 "version":14}
```

R2 layout: `kits/<kit_id>/<slot>/<index>-<sha8>.<ext>` plus `.thumb.jpg` variants uploaded by the client (the Worker never resizes; 10 ms CPU). `backups/hq-YYYY-MM-DD.sql` nightly.


## Kit state machine and claimability

## One vocabulary: `vocab/kit_states.json`

| status | plain English (shown in UI and by kitctl) | entered when |
|---|---|---|
| `spec` | Cast, no images yet | `kit.registered` |
| `building` | The Mac is making images | first `build.step_started` |
| `qc_pending` | Sheet is up, William has not looked yet | `asset.uploaded{slot:reference_sheet}` |
| `rework` | A frame was rerolled or a VA said the images are bad | `qc.rerolled` or `kit.images_rejected` |
| `packaging` | QC passed, packet not complete/synced yet | `qc.approved` |
| `ready` | Complete, synced, nobody holds it | flags: qc=approved AND packet_synced AND slots_ok |
| `claimed` | A VA holds it | `claim.opened` (open claim row exists) |
| `account_created` | VA reported the handle | `account.created` |
| `live` | Linked to a OneUp account (posting slice uses this) | `account.linked_oneup` |
| `burned` | Account dead; kit retired | `account.burned` |
| `retired` | Shelved by you | `kit.retired` |

`hold` is an orthogonal flag (`kit.held{reason}` / `kit.unheld`), not a status: it replaces the skip list and composes with any status. There are no other flags, no `Y`, no `created`, no `Lifestyle Ready`.

## The reducer is a pure function (`core/reduce.js`)
Fold a kit's events into flags, then compute status from flags, in this priority order:
```
retired                                   -> retired
account.state == burned                   -> burned
account.state == live                     -> live
account.state in (reported, verified)     -> account_created
open_claim                                -> claimed
rework_requested (newer than last qc.approved / asset.uploaded for the rerolled slot)  -> rework
qc == approved && packet_synced && slots_ok(family)   -> ready
qc == approved                            -> packaging
has(reference_sheet) && qc != approved    -> qc_pending
any build.step_started                    -> building
else                                      -> spec
```
Because it is order-independent on the flags, a backfilled `claim.opened` from the import or an out-of-order outbox replay produces the same status as live traffic. `POST /api/kits/admin/rebuild` re-runs it over every kit and overwrites `kits`, `claims`, `accounts`, `build_steps`.

Transitions that must emit a second event do so in the same D1 batch and say so in the payload (nothing implicit): `account.created` closes the claim with `claim.released{reason:'fulfilled'}`; `kit.images_rejected` while claimed emits `claim.released{reason:'needs_images'}`; `account.burned` while claimed emits `claim.released{reason:'burned'}`.

## Claimability is a derived, inspectable predicate per family
The family's policy block composes named predicates from the gate library. `transformation`:
```json
"policy": {
  "claimable_when": [
    {"gate":"status_in","args":["ready"]},
    {"gate":"not_held"},
    {"gate":"no_open_claim"},
    {"gate":"no_account","args":{"ignore_states":["failed"]}},
    {"gate":"slots_filled","args":["before","after","reference_sheet","pfp","postable","signup_txt"]},
    {"gate":"pfp_mode_satisfied"},
    {"gate":"event_present","args":["build.packet_synced"]},
    {"gate":"va_allowed"}
  ],
  "pfp_modes":{"real_face":{"requires_slot":"pfp","derived_from":"after"},"solid_color":{"requires_slot":"pfp"}},
  "default_pfp_mode":"real_face",
  "postables":{"min":1,"max":3,"default":1},
  "claim_order":"ready_since asc",
  "claim_ttl_days":null,
  "stale_claim_warn_days":7
}
```
`heygen` differs only in data: `slots_filled: ["reference","pfp","signup_txt"]`, `postables.min: 0`, `pfp_modes: {real_face:{derived_from:"reference"}}`. `couple_transformation` has `"extends":"transformation"` and overrides `persona_count: 2`, `reference_sheet.composite: true`, slot help text. No gate code changes for any of the three.

`GET /api/kits/:id/gates` returns the evaluation row by row so you can see it in Kit detail ("Simulate" on the Families page does the same for any kit):
```json
[{"gate":"status_in","pass":false,"detail":"status=packaging"},{"gate":"not_held","pass":true},{"gate":"no_open_claim","pass":true},...]
```

## Block reasons: `vocab/block_reasons.json` (machine-readable, shown inline everywhere)
| code | detail template | fix hint |
|---|---|---|
| `NOT_READY` | `status={status}; waiting for {next_expected_event}` | per status |
| `HELD` | `{reason} since {since}` | "Unhold on the kit page" |
| `CLAIMED_BY` | `{va_id} ({age} ago)` | "Release on the VAs page if stale" |
| `ACCOUNT_EXISTS` | `@{handle} on {platform}, created {date} by {va_id}` | none; kit is used |
| `MISSING_SLOT` | `{slot_id} ({have}/{min})` | "Run the build step that makes {slot_id}" |
| `PFP_INCOMPLETE` | `pfp_mode={pfp_mode}, pfp slot empty` | "Run repair_pfp / pfp step" |
| `PACKET_NOT_SYNCED` | `no build.packet_synced event` | "Run mini-sync" |
| `VA_NOT_ALLOWED` | `family {family_id} not in {va_id}.allowed_families` | VAs page |
| `BURNED` / `RETIRED` | terminal | none |

The same array is returned by `GET /api/claims/pool`, printed by `kitctl list`, and rendered as chips on the Kits board and the Claim pool page. The bots and the UI cannot disagree because they read the same evaluation.

## Atomic claim (`POST /api/claims/next`)
```
candidates = SELECT kit_id FROM kits WHERE status='ready' AND hold_reason IS NULL ORDER BY ready_since LIMIT 5
for kit in candidates:
  reasons = gates.evaluate(kit, family.policy, {va})      # reads claims/accounts projections
  if reasons: continue
  try DB.batch([ INSERT events(claim.opened), INSERT claims(...), UPDATE kits SET status='claimed', version=version+1 WHERE kit_id=? AND version=? ])
     -> on success return 200 {kit, packet, handoff}
     -> on UNIQUE(claims_one_open_per_kit) or 0 rows updated: continue   # the other bot got it 50 ms earlier
return 409 {code:'NO_CLAIMABLE_KIT', honest_list:[top 10 ready/near-ready kits with block_reasons]}
```
D1 batches are transactions; the partial unique index makes a double claim impossible even if the Worker code were wrong. A `claim.attempted{result}` event (no kit_id) is logged for every call so the VAs page can show "Mark asked 3 times today, got nothing".


## API contract and kitctl mapping

## Base, auth, conventions
- Base URL `https://hq.jwcoconsulting.com/api/kits` (Worker route on the same origin; fallback `https://kits-api.jwcoconsulting.com` with CORS pinned to the HQ origin).
- **Humans**: Cloudflare Access OTP on the hostname; the Worker verifies the Access JWT (header `Cf-Access-Jwt-Assertion`, or the `CF_Authorization` cookie on the bypassed `/api/kits/*` path) with `jose` against `<team>.cloudflareaccess.com/cdn-cgi/access/certs`, pinned `iss` + `aud`; `email` -> role `operator`.
- **Machines**: `Authorization: Bearer hqk_<label>_<40 random chars>`; SHA-256 compared against `client_tokens.token_hash`; role from the row; `va_bot` tokens carry `va_id` and any request naming another VA is a 403 `TOKEN_VA_MISMATCH`.
- **Roles** (`registry/clients/roles.json`): `operator: ["*"]`; `builder: [kits.register, kits.get, assets.put, build.*, exports.get, registry.get]`; `va_bot: [claims.pool, claims.next, claims.create, claims.release, claims.account_created, kits.burned, kits.needs_images, kits.get, assets.get, exports.get, registry.get]`; `importer: [import.*, kits.register, assets.put, build.packet_synced]`; `sync: [sync.*]`.
- **Idempotency**: every POST/PUT takes `Idempotency-Key: <ULID>`; the key is stored on the event; a replay returns the stored status+body and writes nothing. Clients generate the key once per logical action and reuse it on retry (kitctl, hq_client outbox).
- **Concurrency**: mutating kit calls accept `If-Match: <kit.version>`; mismatch = 409 `VERSION_CONFLICT` with the current record.
- Errors: `{error:{code, message, details}}`; codes are in `vocab/block_reasons.json` + `vocab/api_errors.json`.

## Endpoints
| Method, path | Role | Emits | Notes |
|---|---|---|---|
| `GET /registry` | any | - | whole registry, `ETag` = content hash |
| `GET /kits?status=&family=&claimable=1&va=&q=` | any | - | list rows incl. `block_reasons[]` |
| `GET /kits/:id` | any | - | full record (above); `:id` accepts kit_id or slug |
| `GET /kits/:id/events`, `GET /events?type=&since=&kit_id=` | operator, builder | - | timeline / audit |
| `GET /kits/:id/gates` | any | - | gate-by-gate evaluation |
| `POST /kits` | builder, operator, importer | `kit.registered` | body = persona + family + pfp_mode; 409 if slug exists (returns existing) |
| `POST /kits/:id/persona` | operator, builder | `kit.metadata_changed` | partial persona patch |
| `PUT /kits/:id/assets/:slot/:index` | builder, importer, operator | `asset.uploaded` | raw bytes, headers `X-Sha256`, `X-Width`, `X-Height`, `X-Tags`; `?variant=thumb` for the thumbnail; replaces an existing asset in that slot (old one kept in R2, event records `replaced_asset_id`) |
| `GET /kits/:id/assets/:asset_id?variant=original|thumb` | any | - | streams from R2 |
| `POST /kits/:id/build/:step/start|done|fail` | builder | `build.step_started|done|failed` | body `{attempt, log_ref, error?}` |
| `POST /kits/:id/build/packet-synced` | builder, importer | `build.packet_synced` | `{host, path, method, bytes}` |
| `POST /kits/:id/qc` | operator | `qc.approved` or `qc.rerolled` | `{verdict, frames?, note}` |
| `POST /kits/:id/hold` / `DELETE /kits/:id/hold` | operator | `kit.held` / `kit.unheld` | `{reason}` |
| `POST /kits/:id/retire` | operator | `kit.retired` | |
| `POST /kits/:id/needs-images` | va_bot, operator | `kit.images_rejected` (+`claim.released`) | `{note}` |
| `POST /kits/:id/burned` | va_bot, operator | `account.burned` (+`claim.released`) | `{note}` |
| `GET /kits/:id/export/:export_id` | any | - | renders `registry/exports/<id>.json` (telegram_handoff -> JSON {caption, control_text, assets[]}; signup_txt -> text; va_brief -> text) |
| `GET /claims/pool?va=mark` | va_bot, operator | - | `{next: kit|null, honest_list:[{kit, block_reasons}], counts}` |
| `POST /claims/next` | va_bot, operator | `claim.opened`, `claim.attempted` | `{va_id}` -> 200 `{claim, kit, packet:{path_on_mini, assets[]}, handoff}` or 409 `NO_CLAIMABLE_KIT` with the honest list |
| `POST /claims` | va_bot, operator | `claim.opened` | explicit `{kit_id, va_id}`; same gates; 409 with reasons |
| `POST /claims/:claim_id/release` | va_bot, operator | `claim.released` | `{reason}` |
| `POST /claims/:claim_id/account-created` | va_bot, operator | `account.created` (+`claim.released{fulfilled}`) | `{platform, handle, display_name?}`; 409 `ACCOUNT_EXISTS` names the other kit and VA |
| `GET /accounts?platform=&status=&va=&unlinked=1` | operator | - | registry merge view |
| `POST /accounts` | operator | `account.created{source:'ui'}` | manual add |
| `POST /accounts/:id/verify|link-oneup|burned` | operator | `account.verified|linked_oneup|burned` | |
| `POST /accounts/import` | operator | `import.batch_received` | CSV + mapping id; rows go to Reconciliation |
| `POST /sync/oneup` | operator, sync | `sync.oneup_pulled`, `account.linked_oneup` for exact (platform, handle) matches | also cron `0 */6 * * *` |
| `GET /vas`, `POST /vas/:id/pause|resume`, `POST /vas/:id/token` | operator | `va.paused|resumed|token_issued|token_revoked` | token plaintext returned once |
| `POST /import/batches` | operator, importer | `import.batch_received` | `{source: 'sheet'|'claim_log'|'tracker'|'packets', mapping_id, file}` -> classified rows |
| `GET /import/batches/:id/rows?class=` | operator | - | rows + `proposed_events` |
| `POST /import/batches/:id/resolve` | operator | `import.row_resolved` + the proposed events | `{class, resolution_id, row_ids:[...]|"all"}`; never runs without this call |
| `POST /admin/rebuild` | operator | `admin.rebuilt` | replay reducer over all events |
| `GET /health` | any | - | registry version, D1 ok, last cron |

## `kitctl` v2: command -> endpoint (names unchanged so the VA skill text barely changes)
| kitctl command | HTTP | Exit code |
|---|---|---|
| `kitctl list [--va mark] [--all]` | `GET /claims/pool?va=mark` (prints the honest list; `--all` adds every kit with status) | 0 |
| `kitctl claim-next --va mark` | `POST /claims/next {va_id}` | 0 claimed / 2 nothing claimable (prints honest list) |
| `kitctl claim <slug> --va mark` | `POST /claims {kit_id, va_id}` | 0 / 4 blocked (prints reasons) |
| `kitctl release <slug> [--reason ...]` | `POST /claims/:id/release` | 0 |
| `kitctl created <slug> --platform instagram --handle @x` | `POST /claims/:id/account-created` | 0 / 4 `ACCOUNT_EXISTS` |
| `kitctl burned <slug> [--note]` | `POST /kits/:id/burned` | 0 |
| `kitctl needs-images <slug> --note "..."` | `POST /kits/:id/needs-images` | 0 |
| `kitctl status <slug>` | `GET /kits/:id` | 0 |
| `kitctl packet <slug>` | `GET /kits/:id/export/telegram_handoff` + asset download to a temp dir | 0 |
| `kitctl sync-sheet` | none; prints `sheet retired <date>; HQ is the source of truth` | 0 |
| `kitctl whoami` | `GET /vas/me` | 0 / 3 auth |

Config: env `HQ_API` (default the production URL) and `HQ_TOKEN`; Python 3.11 stdlib only (urllib), retries 3x with the same `Idempotency-Key` on network errors, 10 s timeout. Unknown subcommands print the table above instead of a traceback (Hermes agents read stdout).

## `hq_client.py` calls inside the build chain (builder token)
`cast_from_bank.py --write` -> `POST /kits`; `build_kit.py` wraps each chained step with `start/done/fail`; after `kit_reference`: upload before x3, after x3, reference_sheet; after the PFP step: upload pfp; after `pack_lifestyle`: upload postables; after `write_signup_txt`: upload signup_txt; after mini-sync: `packet-synced`. All go through the outbox (`scripts/hq_outbox.jsonl`) and `hq_client.py flush` replays; the build never blocks on HQ being up.


## VA bot sync

## The sync model for Account_Creation_VA_1_Bot (mark) and Account_Creation_VA_2_Bot (joanna)

**There is no sync, because the bots hold no state.** Today each bot runs `kitctl.py claim-next --va <name>` and then `sync-sheet`; the local tracker and the sheet are what they "sync". In Plugboard every kitctl command is a live HTTP call to HQ and returns the answer; nothing is cached on the bot side except a retry outbox. A change you make in HQ (release a stale claim, hold a kit, approve QC) is visible to the bot on its next command, with no job to run.

### Exactly what changes for each bot
1. Install `kitctl` v2 (one file, Python 3.11 stdlib) at the same path the skill already references (`~/AgentHome/PROJECTS/farm-kits/scripts/kitctl.py`), so the skill's absolute path keeps working.
2. Add to the Hermes profile env (`ac-va-2` for mark, `ac-va-1` for joanna, per your mapping): `HQ_API=https://hq.jwcoconsulting.com/api/kits` and `HQ_TOKEN=hqk_mark_...` / `hqk_joanna_...` (issued on the VAs page, shown once). The token is pinned to the VA: `--va joanna` with mark's token is a 403, so the wrong-VA stamp is impossible.
3. Patch the skill text (diff is small):
```
- 1. python3 .../kitctl.py claim-next --va mark
- 2. python3 .../kitctl.py sync-sheet
+ 1. python3 .../kitctl.py claim-next --va mark
+    (prints: kit slug, packet path on the mini, the caption to send; or "nothing claimable" + the honest list)
+ 2. (sync-sheet is retired; running it is harmless and prints a notice)
  3. Send the packet to the VA ... (unchanged)
+ 4. When the VA reports the handle: python3 .../kitctl.py created <slug> --platform instagram --handle @handle
+ 5. If the VA says the images are bad: kitctl needs-images <slug> --note "..." ; if the account got banned: kitctl burned <slug>
+ Never edit character_tracker.js, the sheet, or any file to claim a kit. HQ is the only truth.
```
4. Delete `KIT-GET-OR-BUILD.md` step 4 (the `upsert --field va_owner=` instruction) and the older prose in the VA skill. Door B is gone from the docs and from the code.

### What the bot sees
`kitctl claim-next --va mark` (200):
```
CLAIMED  Elaine Whitmore  (elaine-whitmore, transformation, solid_color PFP)
packet:  mini:/Users/mini/packets/Elaine Whitmore   (6 masters, pfp, 3 postables, signup.txt)
caption: Kit Elaine Whitmore - transformation (3 before / 3 after). Handle: @elaine.whitmore57 ...
next:    when the account exists -> kitctl created elaine-whitmore --platform instagram --handle @...
```
`kitctl claim-next --va joanna` when nothing is claimable (exit 2):
```
NOTHING CLAIMABLE for joanna (0 of 61 ready-ish kits)
  Elaine Whitmore     NOT_READY        status=packaging; waiting for mini-sync
  Cheryl Drummond     HELD             legacy_skip_list since 2026-10-07
  Eden Crowe          ACCOUNT_EXISTS   @eden.crowe on instagram, created 2026-08-02 by unknown
  Anita Walsh         CLAIMED_BY       mark (12 days ago)
  ... 6 more; kitctl list --all for everything
```
The VA can no longer be shown "dozens of plausible kits" that the tool then refuses: the list and the claim read the same predicate.

### Delivery to the VA
Unchanged: the bot sends the packet over Telegram itself, as today (it is a Telegram bot). Two upgrades are data-only: the caption/control text comes from `registry/exports/telegram_handoff.json` (so you can change wording without touching the bot), and `packet.assets[]` in the claim response gives HQ URLs (bearer-auth, originals from R2) as a fallback if the bot ever runs somewhere without the mini mounted. If you later want HQ itself to push messages (nudges, "stale claim" reminders), `providers/telegram_bot.json` already has the slot for per-bot tokens as Worker secrets and the research's grammY-on-Workers pattern; that is Phase 4, not required for correctness.

### Guard rails that make the old failure classes impossible from the bot side
- A kit with any `accounts` row is never offered (`no_account` gate), so "VA created an account that already existed" cannot start from claim-next.
- `created` with a handle that already exists is a 409 naming the other kit and VA, before any status changes.
- Two bots racing: the partial unique index on `claims` decides; the loser gets the next kit, not the same one.
- Pre-stamping an owner at build time cannot happen: `kit.registered` has no owner field; only `claim.opened` creates ownership, and only `va_bot`/`operator` roles may emit it.
- Stale claims are visible, not silent: `stale_claim_warn_days: 7` flags them on the VAs page and in the honest list; auto-expiry (`claim_ttl_days`) is off by default and, if you turn it on per family, writes a `claim.expired` event you can see.


## Migration and reconciliation

## Sources and mappings (all mappings are data: `import/mappings/*.json`)
1. **Sheet**: File > Download > CSV of the "Avatar Tracker" tab (gid 1888102614). Mapping `sheet_avatar_tracker.json`: column -> field, plus a value-normalization table: `Created OK/created_successfully`: `Y|created -> created`, `burned -> burned`, `failed -> failed`, `N|'' -> none`; `Lifestyle Ready`: `yes|Y -> true`; `pipeline_stage` kept verbatim as `legacy_stage`; `VA Owner` -> `legacy_owner`; skip column -> `legacy_skip`; `pfp_mode` -> `pfp_mode`; handle/bio/DOB/email columns -> persona (email stored as a `secret_ref`, never the raw address in the event payload if it is a login).
2. **CLAIM_LOG**: the append-only file as-is (`claim_log.json` mapping handles CSV or JSONL; expected fields ts, action claim|release, slug/name, va). An open claim = claim row with no later release row.
3. **Local tracker** `characters.json` (`tracker_characters.json` mapping: va_owner, created_successfully, pipeline_stage, pfp_mode, slug).
4. **Packets on disk**: the uploader script produces a manifest (which folders exist on the Mac and on the mini, which files are present).

Row identity: `display_name` -> slug (`elaine-whitmore`; couples `elaine-joel-brooks`); collisions and unmatched names are shown, never guessed silently. Each source row is stored raw in `import_rows.raw` so you can always see what the sheet said.

## Discrepancy classes (`registry/reconcile/classes.json`), with the counts your bot measured
| class | rule (on normalized fields) | expected | resolutions offered (each lists the exact events it will write) |
|---|---|---|---|
| `CREATED_LOOKS_FREE` | created == created AND legacy_owner blank AND legacy stage claimable | 45 | **Record the account, VA unknown** -> `account.created{va_id:'unknown', source:'import:sheet', handle from sheet or null}` (status -> account_created). Alt: **Treat as not created** -> `kit.held{reason:'verify_created_flag'}` |
| `UNLOGGED_OWNER_STAMP` | legacy_owner set AND no CLAIM_LOG row | 37 | **Backfill the claim** -> `claim.opened{va_id, backfilled:true, opened_at: import time}`; if also created -> plus `account.created` and `claim.released{fulfilled}` |
| `CLAIMED_OWNER_WIPED` | CLAIM_LOG has open claim AND legacy_owner blank | 7 | **Trust the log** -> `claim.opened{va_id from log, backfilled:true}`. Alt: **Log was stale, release** -> `claim.opened` + `claim.released{reason:'backfill_closed'}` |
| `STAGE_FLAG_DISAGREE` | legacy_stage claimable XOR lifestyle_ready | ~1 (Elaine Whitmore) | **Treat as ready** -> `qc.approved{note:'import'}` (+ packet events from the uploader); **Treat as still building** -> nothing beyond `kit.registered` |
| `SKIP_LISTED` | legacy_skip set | ? (Cheryl Drummond +) | **Hold** -> `kit.held{reason:'legacy_skip_list'}`; **Retire** -> `kit.retired` |
| `PACKET_MISSING` | uploader found no folder on the mini (or no reference-sheet.png) | ? | **Mark for rebuild** -> status stays `building`/`packaging` with `MISSING_SLOT`; **Retire** |
| `BURNED` | created == burned | 6 | **Record burned** -> `account.created` + `account.burned` |
| `CREATION_FAILED` | created == failed | 1 | **Release and make claimable again** -> `claim.released{reason:'failed'}` if claim; or **Hold** |
| `VOCAB_DRIFT_ONLY` | row consistent after normalization (e.g. `Y` vs `created` with matching claim) | many of the 85 | **Import as consistent** -> the implied events (`claim.opened` backfill + `account.created`) |
| `LOG_ONLY` / `TRACKER_ONLY` | slug in one source only | ? | **Register kit from this source** / **Ignore row** |
| `CLEAN` | all three agree and no flag | rest | **Import** -> `kit.registered` + state events |

Every class card shows: count, 5 sample names, the proposed events for one sample row in full JSON, and buttons "Apply to all N" / "Apply to selected" / "Skip for now". Nothing is written until you click; applied rows get `import.row_resolved` and the resulting events carry `batch_id`, so a wrong bulk decision is one filter away in the timeline (and `admin/rebuild` after a corrective batch fixes projections).

Order of operations matters and the page enforces it: `CLEAN`/`VOCAB_DRIFT_ONLY` first (creates kits), then owner/claim classes, then account classes, then holds. The page refuses to apply a class whose prerequisites are unresolved and says which.

## Asset import: `scripts/hq_upload_packets.py` (run on the Mac; mini via ssh)
1. `--scan`: walks `~/AgentHome/.../packets/*/` and `heygen-kits/*/` (and `ssh mini ls` for the synced set); for each folder maps files to family slots by rule in the family manifest (`import.file_rules`: `assets/reference-sheet.png -> reference_sheet`, `pfp*.{png,jpg} -> pfp`, `lifestyle/*.jpg -> postable[i]`, `signup*.txt -> signup_txt`, masters by filename `before_1..3`, `after_1..3`; heygen: `ref_*.png -> reference[i]`). Prints a manifest and the `PACKET_MISSING` list. Writes `import/packets_manifest.json`.
2. `--apply`: for each folder, `POST /kits` if the slug is unknown (family from folder root), `PUT` each asset with `Idempotency-Key = sha256` (re-running is free), uploads a 512 px thumbnail made locally with PIL, and `POST build/packet-synced` when the folder exists on the mini. Rate-limited to 4 concurrent uploads; resumable.
3. The manifest is also posted as an import batch (`source: packets`) so `PACKET_MISSING` shows up in Reconciliation like every other class.

## Verification before cutover (Reconciliation step 7)
`GET /claims/pool?va=mark` must equal what you expect by hand (the bot found 0 claimable today; after honest classification expect roughly 55 ready minus claimed minus created minus held). The page shows the before/after counts per class and "kits a bot would offer now", and you run `kitctl list --va mark` from a bot machine to confirm it prints the same list.


## UI and process pages

## Frame (friend's reel-studio style, dark, plain English)
Left sidebar inside the HQ module: **Overview** (Kits board, Accounts, VAs) · **Do** (Build a kit, Claim pool, Hand-off) · **Set up** (Kit families, Registry, Reconcile). Footer status line: `Truth: HQ ledger · Sheet: frozen 2026-10-xx · Mark: asked 14m ago · Joanna: asked 2h ago`. Right rail on process pages ("THIS KIT" / "THIS RUN"). Every process page has a top-right **Adjust this process** button and a smaller **Ask about this page**.

Routes (hash, under the host's `#biz`): `#biz/kits` · `#biz/kits/k/:slug` · `#biz/kits/build[/:slug]` · `#biz/kits/pool` · `#biz/kits/handoff[/:slug]` · `#biz/kits/accounts` · `#biz/kits/vas` · `#biz/kits/families[/:id]` · `#biz/kits/registry` · `#biz/kits/reconcile[/:batch]`.

### 1. Kits board `#biz/kits`
Cards or Table toggle. Columns: thumbnail (reference sheet), name, family chip, status chip (one vocabulary), hold, claim (VA + age), account (@handle), block reasons as chips, last event. Filters: status, family, VA, claimable only, has block reason X. Counters across the top: `Ready 9 · Claimed 51 · Account created 90 · Rework 2 · Held 3`. Buttons: Export CSV (legacy columns), New kit (goes to Build). Microcopy under the counters: "A kit is claimable only when every light is green. If one is red, the reason is written on the card, and the bots see the same reason."

### 2. Kit detail `#biz/kits/k/:slug`
Header: name, family, status, pfp_mode, hold. Left: reference sheet large; slot grid rendered from the family manifest (before x3, after x3, pfp, postables, signup txt; heygen: reference x1-3, pfp, signup). Middle: **Claimability** panel = gate table from `/gates` (green/red per gate, plain-English detail, fix hint). Right rail: persona fields (editable -> `kit.metadata_changed`), Hold/Unhold, Retire, Needs new images, Open in Build, Open hand-off. Bottom: **Timeline** of events (actor, source, payload summary; filter by type). Packet contents: path on the mini, bytes, synced at.

### 3. Build a kit `#biz/kits/build` (rendered from `family.build_steps`; transformation shown)
1. **Pick the family and cast.** Choose Transformation / HeyGen / Couple. Pick age band. Copy and run on the Mac: `cd ~/AgentHome/CLAUDE/AI-Characters && source .env.local && python3 scripts/cast_from_bank.py --age-band young --write`. Done when the kit appears here (`kit.registered`). "Casting is the glow-up mill, not LLM prose. Handles are randomized and collision-checked at cast time."
2. **Make the masters and the sheet.** Run: `python3 scripts/build_kit.py <slug>`. Progress rows fill from `build.step_*` events: kit_reference -> stage_farm_kit -> pfp -> profile patch -> gen_lifestyle -> pack_lifestyle -> write_signup_txt -> mini-sync. Constraint callouts from `providers/atlas_gpt_image2.json`: "Atlas GPT Image 2 only. 2 input images a minute, one request at a time. Never Grok for masters. Don't pipe through tail; poll scripts/logs/<slug>.<step>.log." (The `--va` flag is gone: ownership is decided by claim-next, never at build.)
3. **Look at the sheet (QC gate).** Reference sheet full-width. Buttons: **Ship it** (`qc.approved`) / **Reroll a frame** (pick `before_1..after_3`, note -> `qc.rerolled`; shows `python3 scripts/build_kit.py <slug> --reroll after_2`). Your rule as the microcopy: "Ship if Before is obviously heavier and After is the same person at a glance. Don't gate on identity loops, hue, or heaviness scripts. Couples: one composite sheet."
4. **Packet.** PFP (mode shown; real-face derived from after-close, iPhone-EXIF spoof), handle/bio/email patch, lifestyle postables (count from policy), signup txt. Precondition callout: "HME must resolve before stage_farm_kit; that step wipes profile.email." Each item turns green when its `asset.uploaded` arrives.
5. **Sync to the mini.** Waits for `build.packet_synced`. "Tar over ssh. Never rsync; names with spaces break it."
6. **Done.** Status flips to Ready and the kit shows in the Claim pool. "Nothing was posted, nothing went to Drive, no video was made. The next step belongs to a VA."
HeyGen variant (from `families/heygen.json`): step 2 is "Make 1-3 reference stills" (same Atlas constraints), step 4 adds an optional external step "Register with HeyGen (v3 POST /v3/avatars type=prompt with up to 3 reference images; store group_id + voice_id; look ids are a cache)" marked *not required to be claimable*, step 5/6 identical.

### 4. Claim pool `#biz/kits/pool`
Two columns, one per VA: **Next for Mark** (the exact kit `claim-next` would return, with its gate table) and **Next for Joanna**. Below: **Everything else and why not**: every kit not claimable, block reason chips, sorted by "closest to claimable". Buttons per row: Hold, Release stale claim, Open. Banner: "This is what each bot will say. If it looks wrong here, it is wrong in Telegram too; fix the kit, not the list."

### 5. Hand-off and account creation `#biz/kits/handoff` (from `processes/handoff.json`)
1. **The VA asks the bot for a kit.** Bot runs `kitctl claim-next --va mark`. HQ picks the oldest Ready kit for that VA and writes the claim. Ack shown here: `claim.opened` with time.
2. **The bot sends the packet.** 6 masters as photos, originals as documents, PFP, signup text, caption from the `telegram_handoff` template (preview rendered here; "Edit template" opens the export manifest).
3. **The VA creates the account on the Pixel** from the signup text (handle, bio, DOB, email alias). Checklist mirrors the signup txt fields.
4. **The VA tells the bot the handle.** Bot runs `kitctl created <slug> --platform instagram --handle @x`. HQ checks the handle is new on that platform, records the account, closes the claim. Ack: `account.created`. Handle capture field also available here for you to type it if the VA messaged you directly.
5. **If something is wrong.** "Need new images" -> `kitctl needs-images` (kit -> Rework, claim released, build page shows the reroll). "Got banned" -> `kitctl burned`.
6. **You verify.** Accounts page -> Verify; when OneUp is connected the sync links it (`account.linked_oneup`) and the kit becomes Live.
Right rail: this kit's claim (VA, age, stale warning at 7 days), buttons Release / Reassign.

### 6. Accounts registry `#biz/kits/accounts`
One table merging `accounts` <- `kits` <- `oneup_accounts`: platform, @handle, display name, kit (link), VA, status, created, OneUp id/category/health (`is_expired` -> "Reconnect in OneUp" badge), source. Tabs: All · Unlinked to OneUp · OneUp-only (accounts in OneUp with no kit) · Burned. Buttons: **Sync OneUp now**, **Import CSV** (mapping UI; rows go to Reconciliation), **Link** (pick OneUp account for a row), Verify, Burned. Microcopy: "Handles are unique per platform here. If a VA reports one that exists, the bot is told who already has it."

### 7. VAs `#biz/kits/vas`
Card per VA: name, bot username, Hermes profile, Pixel device id, token (issued, last used, **Rotate**), allowed families, **Pause** (claim-next refuses while paused), current claims with age and stale flag (Release button), accounts created (count, last), last 10 `claim.attempted` results. "Tokens are shown once. Put them in the bot's Hermes profile env as HQ_TOKEN."

### 8. Kit families `#biz/kits/families`
List of family manifests with version. Detail: image slots grid, metadata fields, **policy block rendered as English** ("Claimable when: status is Ready; not held; no open claim; no account; slots before x3, after x3, sheet, PFP (real-face or solid), 1-3 postables, signup txt; synced to the mini"), build steps, exports used, `extends`. Buttons: **Validate** (meta-schema), **Simulate** (pick any kit -> gate table), **Adjust this family** (opens Claude Code with the manifest), **Duplicate as new family** (copies the JSON into the Adjust brief).

### 9. Registry `#biz/kits/registry`
Tabs: Providers (constraints, prices with as_of, secrets needed), Exports (template preview against a sample kit), Vocab (states, block reasons, event types, tags), Modules (what is mounted; later slices appear here), Clients/roles. Each item has Adjust.

### 10. Reconciliation / import `#biz/kits/reconcile` (from `processes/reconcile.json`)
1. **Get the files.** Download the Avatar Tracker tab as CSV; copy CLAIM_LOG and characters.json. Drop all three here (or run `hq_upload_packets.py --scan` for the packets manifest).
2. **We match names to kits.** Unmatched names and collisions listed; fix by hand or ignore.
3. **Read each class.** Cards per discrepancy class with counts, samples and the exact events one click will write.
4. **Apply, class by class.** Order enforced. Nothing happens until you click. Undo = filter the timeline by batch and apply a corrective batch.
5. **Bring the images in.** Run on the Mac: `python3 scripts/hq_upload_packets.py --apply` (command shown with your paths). Progress appears as `asset.uploaded` events.
6. **Freeze the sheet.** Checklist: archive tab, protect, remove SHEET_* creds, delete the upsert path, kitctl sync-sheet prints the notice.
7. **Check the pool.** Claimable per VA before/after; run `kitctl list --va mark` on a bot machine; the two lists must match.


## The "Adjust this process" button

## "Adjust this process" (every process page, every registry item)
Mechanics from the research, zero backend and no secrets in the page: the button builds a brief and opens `https://claude.ai/code?prompt=<urlencoded brief>&repositories=IxParacosm/IxParacosm.github.io&environment=Default` (repo switches to the HQ repo once we know it). The operator reviews the prefilled prompt, presses Enter, the cloud session pushes a `claude/...` branch, "Create PR", merge = deploy.

Because every page and manifest carries an `adjust` block, the brief is generated, not hand-written:
```json
"adjust": {"page_id":"kits.build.transformation","source_path":"registry/families/transformation.json","also":["modules/kits/pages/process.js"],"validate":"node scripts/validate-registry.mjs"}
```
Brief template (`modules/kits/adjust.js`):
```
## Page
kits.build.transformation — route #biz/kits/build — site commit <SHA baked at publish> — registry v<N>
## Files
registry/families/transformation.json (primary); modules/kits/pages/process.js (renderer; only if the manifest cannot express the change)
## Current config
```json
<the manifest JSON, pretty-printed>
```
## Request
<operator's text from the modal, e.g. "add a step after QC: run batch_guard.py and show its log">
## Rules
Static module, no build step. Prefer editing the manifest; keep data/sample valid; run `node scripts/validate-registry.mjs`; bump the manifest version; update CHANGELOG.md; open a PR; do not touch other modules or the Worker unless the change needs an API field (then add a migration and the event type to vocab/event_types.json).
```
Size guard: if the encoded prompt exceeds ~3,500 chars, the page passes `prompt_url=` pointing at the raw manifest on GitHub (public repo, CORS ok) and a short prompt; in production the Worker route `GET /api/kits/adjust-brief/:page_id` serves the brief with `Access-Control-Allow-Origin: https://claude.ai`.

Fallback (same modal, second button): `https://github.com/<owner>/<repo>/issues/new?title=<page_id>: <request>&body=<short brief + @claude>&labels=claude`; with the Claude GitHub App + `anthropics/claude-code-action@v1` (`on: issues: [opened]`, `claude_code_oauth_token`), Claude opens the PR unattended. Body kept under ~6 KB.

Phase 3 (optional): fire-and-forget via a Routine with an API trigger: Worker `POST /api/kits/adjust` (operator only) posts `{text: brief}` to `https://api.anthropic.com/v1/claude_code/routines/{trig_...}/fire`; token lives in a Worker secret; the routine prompt explicitly acts on the `routine-fire-payload` block; the page shows the returned session URL. Limits 30/h per routine; no idempotency, so the button disables for 10 s after a click.

## "Ask about this page" (phase 3, operator only)
Worker `POST /api/kits/ask` (behind Access) streams `claude-opus-5-5` with `output_config.effort:'low'`, system prompt = the page's manifest + the current kit/pool JSON placed first under `cache_control:{type:'ephemeral'}` (>= 512 tokens), SSE `text_delta` relayed to the page; ~$0.015 per question after cache. `ANTHROPIC_API_KEY` is a Worker secret; the browser never sees it. Optional read-only tools `find_kit`, `list_pool` reuse the same gate code. A `.mcp.json` entry for a remote MCP on the same Worker (`list_kits`, `get_kit`, `claims_pool`) gives Claude Code in the terminal the same view; that is a data surface, not a write path (writes stay on the HTTP API with roles).

`CLAUDE.md` at the repo root documents the registry kinds, the no-build rule, the validate script and "manifests over code", so web sessions, the Action and Routines all behave the same.


## Integration into hq.jwcoconsulting.com

## Self-contained module, mounted at a hash route
```
modules/kits/
  kits.module.js        # export mount(el, opts) / unmount(); internal hash sub-router under opts.basePath
  kits.css              # all rules scoped under .hq-kits; dark by default; reads host CSS vars if present
  core/                 # registry.js gates.js reduce.js exports.js  (shared with the Worker)
  adapters/static.js    # prototype: data/sample/*.json + localStorage event log
  adapters/http.js      # production: fetch /api/kits/*, credentials:'include'
  pages/                # board.js kit.js process.js pool.js accounts.js vas.js families.js registry.js reconcile.js
  adjust.js
  registry/ -> ../../registry   (served statically in the prototype)
  data/sample/events.json       # sample data IS an event log (projections derived on load)
```
Mount contract: `HQKits.mount(document.querySelector('[data-hq-module="kits"]'), {basePath:'#biz/kits', adapter:'auto'})`. `adapter:'auto'` probes `GET /api/kits/health`; if it answers, `http`, else `static`. The module never touches DOM outside its container, never defines global CSS, and exposes `HQKits.version` and `HQKits.registryVersion` for the host footer.

## What is needed from the host site (hq.jwcoconsulting.com), nothing more
1. **A container and two tags** on the page that owns `#biz`: `<div data-hq-module="kits"></div>`, `<link rel="stylesheet" href="/modules/kits/kits.css">`, `<script type="module" src="/modules/kits/kits.module.js"></script>`. If the host has a router API, call `mount/unmount` when `#biz/kits*` enters/leaves; if not, the module self-mounts on `hashchange` when the hash starts with its basePath and hides itself otherwise (zero host code).
2. **Serve the module files** at `/modules/kits/` on the same origin (copy the folder into the site's static output; in the prototype they are served from the IxParacosm.github.io origin, which sends `Access-Control-Allow-Origin: *`, so cross-origin ES-module loading works for a demo).
3. **A Worker route** `hq.jwcoconsulting.com/api/kits/*` -> Worker `hq-kits` (requires the zone on Cloudflare DNS; works whether the site is Pages, a Worker with static assets, or another origin proxied by Cloudflare, because routes intercept by path before the origin). If that is impossible, deploy at `kits-api.jwcoconsulting.com` and set `adapters/http.js` base URL + CORS pinned to the HQ origin.
4. **Cloudflare Access**: one self-hosted app on `hq.jwcoconsulting.com` (or at least the `#biz` page path and `/modules/kits/*`), One-time PIN IdP, Allow policy = your email (VAs later if they ever get UI access; 50 free seats). A **Bypass** policy on `hq.jwcoconsulting.com/api/kits/*` so bearer-token machines can reach the API; the Worker verifies the Access JWT itself for browser calls (cookie or header) and bearer tokens for machines. Hardening option later: replace Bypass with a Service Auth policy and Access service tokens per machine.
5. **Theme hooks (optional)**: if the host defines `--hq-bg`, `--hq-fg`, `--hq-accent`, `--hq-card`, the module uses them; otherwise it ships its own dark palette matching the friend's app.
6. **Nav entry**: one link to `#biz/kits` in the host's Biz menu. Later modules add `#biz/meta`, `#biz/video`, `#biz/post` from `registry/modules.json`.

Unknowns about the host that change only the deploy step, not the module: whether it is a Pages project (then the Worker can also be `functions/api/kits/[[route]].js` with identical bindings) or a Worker (then merge the route into its fetch handler or keep a separate Worker on the route); whether it already has a login (if yes, Access can be limited to `/api/kits/*` + UI path).

## Repo layout (prototype now, production later, same repo)
```
IxParacosm.github.io/
  index.html                 # prototype shell that mounts the module at #biz/kits
  modules/kits/...           # the module
  registry/...               # the five registries + schemas
  worker/                    # src/index.js (router, auth, handlers), migrations/0001_init.sql, wrangler.toml
  scripts/                   # kitctl.py, hq_client.py, hq_upload_packets.py, validate-registry.mjs, seed-d1.mjs
  import/mappings/*.json
  CLAUDE.md  CHANGELOG.md
```
`wrangler.toml`: `name="hq-kits"`, `routes=[{pattern="hq.jwcoconsulting.com/api/kits/*", zone_name="jwcoconsulting.com"}]`, `[[d1_databases]] binding="DB" database_name="hq"`, `[[r2_buckets]] binding="ASSETS" bucket_name="hq-kits-assets"`, `[vars] TEAM_DOMAIN, POLICY_AUD, REGISTRY_VERSION`, `[triggers] crons=["0 */6 * * *","15 3 * * *"]`; secrets via `wrangler secret put ONEUP_API_KEY ANTHROPIC_API_KEY`. Nothing secret ever reaches the browser; bot tokens exist only as hashes in D1 and in the Hermes profile env.


## Phased delivery

## Phase 0 — Clickable prototype (this session, in IxParacosm.github.io)
- `registry/` with transformation, heygen, couple_transformation; providers (atlas_gpt_image2, grok_imagine, mini_ssh, heygen, telegram_bot, oneup); processes (handoff, reconcile); exports (telegram_handoff, signup_txt, va_brief, legacy_sheet_csv); vocab; reconcile/classes.json; clients/roles.json; schemas + `validate-registry.mjs`.
- `core/` reducer + gates + exports, with node tests over sample events (including a two-bot race simulated against the static adapter's in-memory unique index).
- `modules/kits/` with all ten pages on the static adapter; `data/sample/events.json` seeded to reproduce the audit: 45 created-looks-free, 37 unlogged stamps, 7 claimed-owner-wiped, Elaine Whitmore stage/flag disagreement, Cheryl Drummond skip-listed, couples.
- Adjust buttons live (prefilled claude.ai/code links), CLAUDE.md, CHANGELOG.md. Exit: you can click through Build, QC, claim-next per VA, hand-off, reconciliation, and see the honest list.

## Phase 1 — Truth online (about a week of sessions)
- Worker + D1 migration 0001 + R2 bucket + Access app/policies + Worker route. `seed-d1.mjs` loads the sample registry only (no sample kits in prod).
- Importers + mappings; Reconciliation page against real CSV/CLAIM_LOG/characters.json; `hq_upload_packets.py --scan/--apply`; nightly export cron.
- Cutover: apply classes, upload packets, freeze the sheet, remove SHEET_* creds, delete the upsert path. Exit criterion: `GET /claims/pool` per VA equals your hand count; zero kits are both `account` and claimable; `kitctl list` from a bot machine prints the same list as the Pool page.

## Phase 2 — Bots and builder on the API (days)
- `kitctl` v2 installed at the old path; VA tokens issued on the VAs page; Hermes profile env; skill text patched (the five-line diff). `sync-sheet` no-op.
- `hq_client.py` wired into cast_from_bank.py / build_kit.py (register, step events, asset uploads, packet-synced) with outbox. First new kit built end-to-end with the Build page lighting up.
- OneUp sync cron + Accounts registry; CSV import for any other account lists.

## Phase 3 — Second family, registry pages, assistant
- HeyGen kits: import `heygen-kits/` specs with the uploader (family rules), optional provider step to register with HeyGen v3 and store `group_id`/`voice_id`; `couple_transformation` used for the existing couples.
- Registry page, Simulate, Validate; Ask-about-this-page Worker proxy; optional Routine-fired Adjust; optional read-only sheet mirror if you still want it; stale-claim nudges via the bots' tokens if wanted.

## Phase 4+ — Next slices, each a module + registries, no rewrites
- **Metadata changer** `#biz/meta`: `registry/metadata_profiles/*.json`, process page "Change metadata", events `meta.*`, output assets as `kit_assets` rows with `derived_from`.
- **Video creator** `#biz/video`: provider cards (kling30_poyo, genjutsu_higgsfield, heygen_av4) with live/estimated prices and badges, `video_recipes/*.json`, `clips` table + tag vocab, friend's "Make new clips" and "Make the video" pages as process manifests, "YOUR RUN" rail with spend cap; events `video.*`.
- **Posting** `#biz/post`: OneUp provider gains `post` capability; `posts` table; schedule via `scheduleimagepost/schedulevideopost` with `uploadmedia`; cron polls post status; events `post.*`; the accounts registry from this slice is the join.
Upgrade to Workers Paid ($5/mo) only when a cron or the video module's polling needs more than 10 ms CPU or 5 cron triggers.


## Risks

| Risk | Why it matters | Mitigation built in |
|---|---|---|
| Door B survives somewhere (an old skill prose, a cron, a habit) and writes the sheet/tracker | Reintroduces the split truth | Sheet creds removed from `.env.local`; tab protected; `character_tracker.js` upsert path deleted; kitctl refuses unknown commands with the table; the only owner-creating event type is `claim.opened` and only `va_bot`/`operator` may emit it |
| Bots cannot reach HQ (network, token typo) | VA work stops | `kitctl whoami` in the skill's first step; clear exit codes and messages; outbox only for builder (bots must not queue claims); VAs page shows last `claim.attempted` per VA so you see silence |
| Registry drift between UI and Worker | Gate evaluated differently in two places | Same files bundled into both; `GET /registry` ETag + `REGISTRY_VERSION`; UI shows a "reload" banner on mismatch; `validate-registry` runs in CI (GitHub Action) before merge |
| Projection bug | Wrong status shown | Ledger is the truth; `admin/rebuild` replays; reducer is pure and unit-tested with the audit's cases |
| Two writers on the same kit (you in the UI, a bot) | Lost update | `kits.version` optimistic check inside the batch; 409 with current record |
| Bulk reconciliation decision was wrong | 45 rows mis-stated | Every applied event carries `batch_id`; corrective batch + rebuild; raw rows kept forever in `import_rows.raw` |
| Handle unknown for the 45 created-looks-free kits | Account rows without handles weaken the uniqueness guard | Resolution writes `handle: null` with `status: unknown` and the Accounts page lists them under "needs handle"; OneUp sync fills many by name match; bots are still blocked by `no_account` regardless |
| D1 free limits (50 queries/invocation, 5M reads/day) | Import or pool queries fail | Batched inserts; indexes from migration 0001; pool query reads `kits` by status index, not full scans; nightly export + Time Travel |
| Access + bearer split auth | Mistake could expose the API | Bypass is only on `/api/kits/*`; Worker verifies JWT (iss, aud, exp) or token hash on every request; tokens are 40 random chars, hashed, revocable, pinned to a VA; option to move to Access service tokens |
| HQ host site shape unknown | Integration step stalls | Module needs only a div + two tags; Worker route works regardless of origin type; fallback separate hostname with CORS |
| Wrangler/Workers CPU 10 ms on Free | Thumbnails/zip in-Worker would fail | Clients upload thumbnails; no zip endpoint; bots fetch assets individually or use the mini |
| Hermes agents are non-deterministic readers of stdout | Could misparse kitctl output | kitctl prints a fixed first line (`CLAIMED ...` / `NOTHING CLAIMABLE ...` / `ERROR <code>`) and `--json` for structured output |
| Scope creep into image generation | Would break the hard constraints | The control plane only records constraints from `providers/*.json`; build steps show commands to run on the Mac, never run them |
| Prices/limits for HeyGen, OneUp from blocked docs | Wrong UI hints | Provider manifests carry `as_of` and `confidence`; shown as "from docs snapshot" until you paste live values |
| Operator stops looking at the ledger and the sheet habit returns | Truth erodes socially | Board Table view + legacy CSV export make the old glance one click; footer always states where truth lives |


## Questions for the operator

- How is hq.jwcoconsulting.com deployed (Cloudflare Pages project, Worker with static assets, or another origin proxied by Cloudflare), is the jwcoconsulting.com zone on Cloudflare DNS, and does the site already have a login? This decides Worker route vs separate hostname, and whether Cloudflare Access goes on the whole hostname or only on the kits paths.
- Where do the two VA bots (Hermes profiles ac-va-1 / ac-va-2) actually run (the Mac, the mini, a VPS, a phone), can they reach HTTPS and hold an env var, and do they have the mini's packet folders mounted locally? This decides whether kitctl returns a mini path, HQ asset URLs, or both.
- Please paste the exact header row of the Avatar Tracker tab (columns A..AJ) plus three raw lines each of CLAIM_LOG and characters.json, so the import mappings are written against real formats instead of the bot's description.
- For the 45 kits marked created with no owner: is the created handle stored in the sheet (which column), and does anyone know which VA created them, or should they be recorded with va = unknown and a 'needs handle' flag for the OneUp sync to fill?
- What does the skip list mean today (never claim, temporary hold, or a different reason per kit), and what are the stage strings 'scheduled', 'spec', 'adopted', 'produced' meant to signify? I mapped skip to a hold flag and the rest to the new status vocabulary; confirm or correct.
- What is actually inside heygen-kits/ (folder layout, how many stills per kit, any spec file), and do HeyGen kits go to Mark and Joanna for account creation with the same signup txt, or are they only for video?
- Packet locations and naming on the Mac and the mini (full paths, the 'First Last' folder convention, which files sit in assets/, typical size per kit), so the uploader's file-to-slot rules and the packet-missing check are right the first time.
- OneUp: which plan are you on, how do you use categories (per persona, per VA, per platform), and can you paste a redacted listsocialaccounts response? This fixes the join to the accounts registry and whether category_id can link kits to accounts.
- Sheet retirement: are you OK freezing the Avatar Tracker tab on cutover day (archive copy, protected, credentials removed from the Mac) with the board's Table view and legacy-column CSV export as the replacement, or do you want a read-only mirror tab written by the Worker (adds a Google service account)?
- Do you use Claude through a claude.ai subscription (enables the zero-backend 'Adjust this process' link and Routines) or an API key, and should the button open a reviewed prefilled session by default or fire-and-forget? Also: is an 'Ask about this page' proxy at roughly $0.015 per question worth having in Phase 3?
