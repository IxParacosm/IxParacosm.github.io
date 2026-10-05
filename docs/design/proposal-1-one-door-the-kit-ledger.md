# Proposal 1: One Door: the Kit Ledger

_Angle: Correctness-first: make the measured failure classes structurally impossible. One append-only ledger, one write door (an HTTP API), claims that are atomic in the database, a single kit vocabulary with a derived and inspectable claimability predicate, reconciliation that never auto-resolves, and bots that fail closed when HQ is unreachable. Every other part of the module (pages, families, OneUp, HeyGen) is designed to serve those invariants._

Produced 2026-10-05 by the cloud session's design panel (one of three independent proposals; the judging and synthesis phases did not run because the work moved to the Mac session). Treat as input, not as the decision.


## Elevator pitch

Every fact about a kit (built, QC'd, synced, claimed, account created, burned) becomes an event appended to one ledger through one HTTP API; the Google Sheet, CLAIM_LOG and characters.json stop being writable truths. A kit's state and owner are projections rebuilt from the ledger, claimability is a pure function of a per-family policy block that the UI and the VA bots render identically (with the block reason inline), and a claim is a single conditional D1 batch guarded by a unique partial index, so two bots racing cannot take the same kit even if the Worker code is wrong. The existing Mac pipeline is untouched; `kitctl.py` becomes a thin client with the same command names, and the 106 existing rows enter through a reconciliation screen where the operator resolves each discrepancy class with one click while the claim pool stays at zero until he does.


## Is the Google Sheet still necessary?

## Verdict: the 'Avatar Tracker' tab is no longer necessary, and keeping it writable is the root cause of the corruption

**Why it must stop being a source of truth**

- Every one of the measured failure classes is a two-writers problem. 'Y' vs 'created' exists because `character_tracker.js` and the sheet/kitctl path spell the same flag differently. 37 unlogged owner stamps and 7 claimed-but-blank rows exist because `VA Owner` is a cell anyone (any script) can overwrite independently of CLAIM_LOG. 45 phantom-available kits exist because the gate reads column AI with one spelling and nobody owns the vocabulary. A spreadsheet cannot enforce a vocabulary, a transition, a unique constraint or a transaction; it will keep producing these classes no matter how carefully the scripts are patched.
- Rows have no identity (sorting/inserting shifts positions), so any "sync" to or from it is a heuristic, and the research confirms the only safe ingestion path needs a service account plus a hidden UUID column just to key rows. That is a lot of machinery to keep a mirror alive.
- The VAs never touch this tab: they talk to their Telegram bots, which run `kitctl`. So "VA familiarity" is not at stake for this tab.

**What replaces its remaining value**

| Value today | Replacement |
|---|---|
| Glance at all 106 rows in one grid | Kits board has a dense **Table view** (every kit, every column, sortable, filterable) and `GET /api/v1/export/kits.csv` for a spreadsheet when he wants one. |
| Manual edits (fix a handle, mark burned) | Edits in the Kit detail page are events (`kit.fields_updated`, `account.burned`) with actor + timestamp; nothing silent, nothing lost. |
| Audit of who did what | The timeline on each kit and the global event log, both rebuildable. |
| Bots' `sync-sheet` | Removed; the API is the truth the bots already read. `kitctl sync-sheet` stays as a no-op so the skill text does not break. |

**Recommended handling (phased, reversible)**

1. Phase 1 cut-over: export the tab to CSV (that export is the import source), then **freeze** it: rename to `Avatar Tracker (FROZEN 2026-10-xx, see HQ)` and protect the range. Do not delete; it is the audit trail of the old world.
2. Phase 2 (optional, only if he finds himself missing it): the Worker writes a **read-only mirror tab** nightly via the Sheets API with a service account (`HQ mirror (read-only)`), one row per kit, derived from projections. One direction only, never read back.
3. After 60 days of not opening the mirror, drop the cron. The rest of the Brain Sheet (other tabs) is out of scope and untouched.

**Honest caveat**: the only thing we lose is the ability to type into a cell. That is precisely the ability that produced 45 phantom-available kits.


## Architecture

## Architecture: one ledger, one door, three kinds of client

### Components

```
                         +------------------------------------------+
  HQ UI (hash route      |  Cloudflare Worker (or Pages Functions)  |
  #biz/kits, static JS) ->  /api/v1/*   single write path           |
                         |  - auth: Access JWT (UI) / bearer (bots) |
  kitctl.py (VA bots,    |  - idempotency table                     |
  Mark + Joanna)      -->|  - core/claimability.js (shared)         |
                         |  - core/state_machine.js (shared)        |
  hqctl.py (build chain  |  - claims.js: conditional D1 batch       |
  on the Mac, uploader) >|  - cron: invariants + stale-claim sweep  |
                         +----------+------------------+------------+
                                    |                  |
                              D1 (SQLite)         R2 (kit assets)
                       events (append-only) + projections
```

- **D1** holds the ledger (`events`) and the projections (`kits`, `claims`, `accounts`, `kit_assets`, `kit_steps`, ...). It is the only source of truth. Chosen because the research scored Cloudflare all-in 31/35 and the HQ host is already behind Cloudflare; $0 at this volume (106 kits, two bots, a few hundred writes a day against 100k/day free). Supabase Free pauses after 7 idle days (fatal for a tool used in bursts), Git-as-DB is public and has no server, Apps Script cannot set CORS and makes the URL the credential.
- **R2** holds every kit asset (reference sheet, masters, PFP, postables, signup txt) under `kits/<kit_id>/<slot>/<n>.<ext>`, served only through the Worker so Access and roles apply. The Mac/mini packet folders remain the pipeline's working copy; R2 is the control plane's copy.
- **Worker** is the one door. No other process has D1 credentials. The operator never runs `wrangler d1 execute` against production except through `hqctl event` (which goes through the API). Nightly cron rebuilds projections from events into temp tables and diffs; any mismatch is an alert on the Kits board.
- **Cloudflare Access** (One-time PIN) in front of `hq.jwcoconsulting.com`; the Worker verifies `Cf-Access-Jwt-Assertion` (jose, JWKS at `<team>.cloudflareaccess.com/cdn-cgi/access/certs`, pinned issuer and AUD) and maps `payload.email` to the operator role. A second Access application on `/api/v1/*` carries a Bypass policy; the Worker enforces hashed bearer tokens there itself (constant-time compare).

### The three client kinds and what each may write

| Client | Role | May emit |
|---|---|---|
| HQ UI (operator, via Access) | `operator` | everything, including reconciliation resolutions, QC decisions, holds, family policy edits |
| `hqctl.py` on the Mac (build chain, asset uploader) | `build` | `kit.registered`, `build.step_*`, `asset.uploaded`, `packet.synced`, `kit.fields_updated` (build-time fields only) |
| `kitctl.py` in each VA bot's Hermes profile | `va_bot` (bound to one `va_id`) | `claim.opened` (via claim-next), `claim.released`, `account.created`, `kit.rework_requested`, `account.burned`, only on claims that VA holds |

There is no fourth client. `character_tracker.js upsert --field va_owner=` is replaced by a stub that exits 2 with "Door B is closed: use kitctl claim". The Hermes profiles get `HQ_API_URL` and `HQ_API_TOKEN` and lose any sheet credentials they may hold (question 8).

### Shared core modules (same code in browser prototype and Worker)

`kits/core/` is plain ES modules with zero dependencies, imported by both the static adapter (prototype) and the Worker, so what the UI shows is exactly what the server computes:

- `core/vocab.js`: the single enums (kit states, event types, block reason codes, created_ok legacy mapping).
- `core/state_machine.js`: `apply(kit, event) -> kit'` (pure) and `transitionAllowed(state, eventType)`.
- `core/claimability.js`: `evaluate({kit, family, assets, steps, openClaims, reconcileOpen, va, vaOpenClaims}) -> {claimable, blocks:[{code, detail}]}`.
- `core/reconcile.js`: `classify({sheetRows, claimLog, tracker, fsWalk, skipList}) -> items[]`.
- `core/projection.js`: `rebuild(events) -> {kits, claims, accounts, ...}` used by the nightly check and by the admin rebuild.

### Repository layout (prototype now, production later, same repo)

```
kits/                      self-contained module (mount at #biz/kits)
  kits.js  kits.css        router + pages, scoped under .hqkits
  core/                    vocab, state_machine, claimability, reconcile, projection
  adapter/static.js        JSON + localStorage, simulates the atomic claim
  adapter/http.js          fetch('/api/v1/...') with Idempotency-Key
  data/families/           transformation.json heygen.json transformation_couple.json
  data/process/            build.json handoff.json (numbered steps + microcopy)
  data/sample/             kits.json claims.json accounts.json vas.json events.json import_*.json
worker/                    phase 1
  src/index.js  src/claims.js  src/auth.js  src/reconcile.js  src/cron.js
  migrations/0001_init.sql
  wrangler.toml
scripts/
  kitctl.py                v2 drop-in (same commands) for the VA bots
  hqctl.py                 build-side client (register, step, upload, synced, flush)
  hq_import_assets.py      one-off uploader (walks packet folders, PUTs to R2 via API)
  hq_export_sources.sh     collects sheet CSV, CLAIM_LOG, characters.json, fs walk, skip list
CLAUDE.md                  conventions the Adjust button relies on
```

### What the control plane deliberately does not do

It does not generate images, does not touch Atlas, Grok, OpenAI, Drive or video, does not rsync anything, does not send Telegram messages in phase 1 (the Hermes bots keep doing that). It records the pipeline's hard constraints in each family policy (`constraints_recorded`) and shows them on the Build page; it never changes them.


## Data model

## Data model (D1 / SQLite), `migrations/0001_init.sql`

### Ledger (append-only)

```sql
CREATE TABLE events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,   -- global total order
  event_id       TEXT NOT NULL UNIQUE,                -- uuid v4
  ts             TEXT NOT NULL,                       -- server time, ISO-8601 UTC; clients never supply it
  type           TEXT NOT NULL,                       -- see vocab below
  kit_id         TEXT,                                -- NULL for va/family/import events
  claim_id       TEXT,
  account_id     TEXT,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('operator','va_bot','build','system','import')),
  actor_id       TEXT NOT NULL,                       -- api_clients.client_id | access email | 'cron'
  source         TEXT NOT NULL,                       -- 'api' | 'reconcile' | 'import:sheet' | 'import:claim_log' | 'import:tracker' | 'import:fs'
  idempotency_key TEXT,
  prev_version   INTEGER,                             -- kit version before/after, NULL for non-kit events
  new_version    INTEGER,
  payload_json   TEXT NOT NULL
);
CREATE INDEX events_kit ON events(kit_id, seq);
CREATE INDEX events_type ON events(type, seq);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
```

Event type vocabulary (`core/vocab.js`, the only place it is defined):
`kit.registered, kit.fields_updated, build.step_completed, build.step_failed, asset.uploaded, asset.retired, packet.synced, qc.approved, qc.rejected, kit.held, kit.unheld, kit.retired, kit.recycled, kit.rework_requested, claim.opened, claim.released, claim.expired, claim.extended, claim.backfilled, account.created, account.status_changed, account.burned, account.linked_oneup, account.imported, va.created, va.paused, va.resumed, va.token_rotated, family.updated, import.run_completed, reconcile.resolved, projection.rebuilt`.

### Projections (derived; rebuildable from `events` by `core/projection.js`)

```sql
CREATE TABLE kit_families (
  family_id TEXT PRIMARY KEY, version INTEGER NOT NULL, label TEXT NOT NULL,
  policy_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by_event TEXT NOT NULL);

CREATE TABLE kits (
  kit_id        TEXT PRIMARY KEY,                     -- slug, e.g. 'eden-crowe', 'camila-ruiz-ig2'
  display_name  TEXT NOT NULL,                        -- 'Eden Crowe'
  family_id     TEXT NOT NULL REFERENCES kit_families(family_id),
  family_version INTEGER NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('spec','building','qc','needs_rework','ready','claimed','account_created','burned','retired')),
  hold_reason   TEXT,                                 -- NULL = not on hold (orthogonal flag, replaces skip list)
  version       INTEGER NOT NULL DEFAULT 0,           -- = number of events for this kit
  current_claim_id TEXT,                              -- NULL unless state='claimed'
  built_for_va  TEXT REFERENCES vas(va_id),           -- routing preference from `build_kit.py --va`, NOT ownership
  fields_json   TEXT NOT NULL,                        -- family-validated; secrets stored as refs (see secrets)
  handle        TEXT, persona_name TEXT, pfp_mode TEXT, age_band TEXT,   -- extracted for indexing/filtering
  packet_dir    TEXT,                                 -- 'First Last' dir name on the mini
  packet_synced_at TEXT,
  qc_approved_at TEXT, qc_approved_event TEXT,
  masters_changed_at TEXT,                            -- latest master asset upload; QC older than this is QC_STALE
  ready_at      TEXT,                                 -- FIFO key for claim-next
  claimable     INTEGER NOT NULL DEFAULT 0,           -- cached result of core/claimability (va-independent part)
  block_reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX kits_pool ON kits(state, hold_reason, claimable, ready_at);
CREATE INDEX kits_family ON kits(family_id);

CREATE TABLE kit_steps (                              -- one row per family build step
  kit_id TEXT NOT NULL REFERENCES kits(kit_id), step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','done','failed')),
  finished_at TEXT, log_excerpt TEXT, event_id TEXT, PRIMARY KEY (kit_id, step));

CREATE TABLE kit_assets (
  asset_id TEXT PRIMARY KEY, kit_id TEXT NOT NULL REFERENCES kits(kit_id),
  slot TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1,   -- ('before',2), ('postable',1), ('reference_sheet',1)
  r2_key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL,
  width INTEGER, height INTEGER,
  sensitive INTEGER NOT NULL DEFAULT 0,               -- signup_txt = 1: served only to operator and the claim holder's bot
  status TEXT NOT NULL CHECK (status IN ('active','retired')),
  uploaded_at TEXT NOT NULL, event_id TEXT NOT NULL);
CREATE UNIQUE INDEX kit_assets_slot_active ON kit_assets(kit_id, slot, n) WHERE status='active';

CREATE TABLE vas (
  va_id TEXT PRIMARY KEY,                             -- 'mark' | 'joanna'
  display_name TEXT NOT NULL, telegram_bot_username TEXT, hermes_profile TEXT, device_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused')), created_at TEXT NOT NULL);

CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY, kit_id TEXT NOT NULL REFERENCES kits(kit_id),
  va_id TEXT NOT NULL REFERENCES vas(va_id),
  opened_at TEXT NOT NULL, opened_by_event TEXT NOT NULL, expires_at TEXT,
  stale INTEGER NOT NULL DEFAULT 0,                   -- set by the sweep when past expires_at and policy.auto_release_stale=false
  closed_at TEXT, close_reason TEXT CHECK (close_reason IN ('released','expired','account_created','rework','retired','superseded')),
  closed_by_event TEXT, platforms_reported_json TEXT NOT NULL DEFAULT '[]');
-- THE invariant: at most one open claim per kit, enforced by the database, not by code
CREATE UNIQUE INDEX claims_one_open_per_kit ON claims(kit_id) WHERE closed_at IS NULL;
CREATE INDEX claims_open_by_va ON claims(va_id) WHERE closed_at IS NULL;

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY, kit_id TEXT REFERENCES kits(kit_id), claim_id TEXT REFERENCES claims(claim_id),
  va_id TEXT REFERENCES vas(va_id),                   -- NULL = 'VA unknown' (legacy rows), shown as such
  platform TEXT NOT NULL CHECK (platform IN ('instagram','tiktok','youtube','facebook','x','threads','other')),
  handle TEXT NOT NULL, handle_norm TEXT NOT NULL,    -- lowercase, no '@'
  display_name TEXT, status TEXT NOT NULL CHECK (status IN ('reported','verified','active','suspended','burned','lost')),
  created_at TEXT, reported_at TEXT NOT NULL, origin TEXT NOT NULL,   -- 'va_report' | 'import:sheet' | 'import:csv' | 'oneup'
  oneup_social_account_id TEXT, oneup_linked_at TEXT, sheet_row_hash TEXT, notes TEXT);
CREATE UNIQUE INDEX accounts_handle_unique ON accounts(platform, handle_norm);   -- 'VA created an account that already exists' is caught here
CREATE UNIQUE INDEX accounts_kit_platform ON accounts(kit_id, platform) WHERE kit_id IS NOT NULL;

CREATE TABLE oneup_accounts (                         -- raw mirror of GET /api/listsocialaccounts; never a truth, only a match source
  social_account_id TEXT PRIMARY KEY, username TEXT, full_name TEXT, platform TEXT, is_expired INTEGER,
  raw_json TEXT NOT NULL, synced_at TEXT NOT NULL);

CREATE TABLE api_clients (
  client_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator','build','va_bot','readonly')),
  va_id TEXT REFERENCES vas(va_id),                   -- required when role='va_bot'
  token_hash TEXT NOT NULL,                           -- sha256 of the bearer token; token shown once
  created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT);

CREATE TABLE idempotency_keys (
  client_id TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL,
  status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (client_id, key));

CREATE TABLE secrets (                                -- field values marked secret in the family policy (email, phone)
  kit_id TEXT NOT NULL, field_id TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL,   -- AES-GCM, key = Worker secret KIT_SECRETS_KEY
  updated_at TEXT NOT NULL, PRIMARY KEY (kit_id, field_id));

CREATE TABLE import_runs (run_id TEXT PRIMARY KEY, source TEXT NOT NULL, file_name TEXT, file_sha256 TEXT,
  row_count INTEGER, started_at TEXT, finished_at TEXT, summary_json TEXT);
CREATE TABLE import_rows (row_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES import_runs(run_id),
  source TEXT NOT NULL, kit_id TEXT, row_hash TEXT NOT NULL, raw_json TEXT NOT NULL, mapped_json TEXT NOT NULL);
CREATE TABLE reconcile_items (
  item_id TEXT PRIMARY KEY, kit_id TEXT NOT NULL, class TEXT NOT NULL,
  evidence_json TEXT NOT NULL, proposed_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','dismissed')),
  resolved_at TEXT, resolved_by_event TEXT, resolution_json TEXT);
CREATE INDEX reconcile_open ON reconcile_items(kit_id) WHERE status='open';

CREATE TABLE projection_checks (checked_at TEXT PRIMARY KEY, ok INTEGER NOT NULL, diff_json TEXT);
```

### JSON shapes

Kit `fields_json` (transformation example):
```json
{"persona_name":"Eden Crowe","age_band":"midlife","pfp_mode":"real_face",
 "handle":"eden.crowe27","bio":"started lifting at 52 ...","dob":"1973-04-11",
 "email":{"secret_ref":"email"},"built_for_va":"mark","niche":"glow_up"}
```

Block reason (always `{code, detail}`), e.g. `{"code":"MISSING_ASSET","detail":"pfp (pfp_mode=real_face expects pfp/1)"}`.

Event payload examples:
```json
{"type":"claim.opened","payload":{"va_id":"mark","expires_at":"2026-10-08T14:02:00Z","candidate_rank":1,"evaluated_blocks":[]}}
{"type":"account.created","payload":{"platform":"instagram","handle":"eden.crowe27","display_name":"Eden Crowe","reported_by":"bot-mark","note":""}}
{"type":"claim.backfilled","payload":{"va_id":null,"reason":"reconcile:CREATED_LOOKS_FREE","sheet_row_hash":"..."}}
{"type":"qc.rejected","payload":{"frames":["before_2"],"note":"before not obviously heavier"}}
```

### Invariants (checked by `GET /api/v1/admin/invariants` and the nightly cron; any failure shows a red banner on the board)

1. No kit has more than one open claim (the unique partial index makes violation impossible; the check exists to prove it).
2. `kits.state='claimed'` iff an open claim exists for it, and `current_claim_id` equals that claim.
3. `kits.state='account_created'` implies at least one `accounts` row with that `kit_id`; conversely a non-burned account implies `kit.state in ('account_created','burned')`. A kit with an account can never be `ready`.
4. `kits.claimable=1` implies `core/claimability.evaluate` returns zero blocks right now (recomputed, va-independent part).
5. `kits.version = count(events where kit_id = kit)`.
6. Every open claim's `opened_by_event` exists; every closed claim's `closed_by_event` exists.
7. `rebuild(events)` equals the live projections table-for-table (nightly; diff stored in `projection_checks`).
8. No `kits.state='ready'` kit has an open `reconcile_items` row (imported kits cannot reach the pool unresolved).

### Secrets

`email`/`phone` fields and the `signup_txt` asset are the only sensitive data. They are returned by the API only to the operator and to the `va_bot` that holds the kit's open claim (so a bot cannot read signup details for a kit it does not hold). The Worker holds `KIT_SECRETS_KEY`, `ONEUP_API_KEY`, `GOOGLE_SA_KEY` via `wrangler secret put`; nothing secret is ever in the browser or the repo.


## Kit state machine and claimability

## One kit state machine, one vocabulary

### States (nine; `kits.state`)

| State | Meaning | Replaces (old) |
|---|---|---|
| `spec` | registered from casting; no assets | `spec`, `adopted` |
| `building` | at least one build step done, not all | `produced` (partial) |
| `qc` | all required build steps done, QC decision pending or stale | (implicit) |
| `needs_rework` | QC rejected a named frame, or a VA asked for new images | (none; was a prose note) |
| `ready` | everything the family policy requires is present and approved; **the only state a claim can start from** | `lifestyle_ready` + `Lifestyle Ready=yes` + packet present + owner blank |
| `claimed` | exactly one open claim exists | `VA Owner` cell + CLAIM_LOG row |
| `account_created` | VA reported the platform account(s); kit has left the pool for good | `Created OK` = `Y` / `created` / `created_successfully=Y` |
| `burned` | the account was banned/lost; persona retired | `burned` |
| `retired` | operator took the kit out permanently | permanent skip-list entries, `failed` |

Orthogonal flag: `hold_reason` (text or NULL). A hold blocks claiming and build advancement in any state, is visible as a block reason, and replaces the skip list for temporary skips.

### Transition table (anything not listed is rejected with `409 TRANSITION_NOT_ALLOWED`)

| From | Event | Guard | To |
|---|---|---|---|
| (none) | `kit.registered` | slug unique; family exists; required build-time fields valid | `spec` |
| `spec`, `building`, `needs_rework` | `build.step_completed` | step in family `build_steps`; when the step is a master-producing step set `masters_changed_at` | `building`, or `qc` when every required step is `done`, or `ready` when also QC approved and fresh and assets complete |
| any build state | `build.step_failed` | | unchanged (step row `failed`, shown inline) |
| `spec`..`qc`, `needs_rework`, `ready` | `asset.uploaded` | sha256 matches body; slot in family | unchanged, then re-evaluate (a master upload after QC makes QC stale and moves `ready` back to `qc`) |
| `qc` | `qc.approved` | all required assets present; `masters_changed_at <= now` | `ready` (sets `ready_at`) |
| `qc` | `qc.rejected {frames}` | | `needs_rework` |
| `ready` | `claim.opened` | **conditional batch** (see API); no hold; no open reconcile item; VA under limit | `claimed` |
| `claimed` | `claim.released`, `claim.expired` | actor is claim holder, operator, or sweep | `ready` |
| `claimed` | `account.created` | actor is claim holder or operator; `(platform, handle)` not already in `accounts`; closes the claim when all `policy.platforms` reported | `account_created` |
| `claimed` | `kit.rework_requested {note}` | actor is claim holder or operator; closes the claim with reason `rework` | `needs_rework` |
| `account_created` | `account.burned` | | `burned` when every account of the kit is burned |
| `burned`, `retired` | `kit.recycled` | operator only | `needs_rework` (new handle required) |
| any except `claimed` | `kit.retired` | operator | `retired` |
| `claimed` | `kit.retired` | operator; closes claim with reason `retired` | `retired` |
| any | `kit.held {reason}` / `kit.unheld` | operator | unchanged (flag) |
| (import) | `claim.backfilled`, `account.imported` | reconcile resolution only | as the resolution says |

The build chain's old final step "tracker ownerless" has no equivalent: ownerless is the default; nothing stamps an owner at build. `--va mark|joanna` becomes `built_for_va`, a routing preference.

### Claimability: a derived, inspectable predicate

`core/claimability.evaluate(ctx)` returns `{claimable, blocks[]}`; the va-independent part is cached on `kits.claimable/block_reasons_json` after every event, and recomputed live inside claim-next. It never reads a stage string or a flag; it reads state, steps, assets, fields, claims and reconciliation rows:

```
blocks = []
if reconcile_items open for kit        -> RECONCILIATION_PENDING:<class>
if state == 'retired'                   -> RETIRED
if state == 'burned'                    -> BURNED
if state == 'account_created'           -> ACCOUNT_EXISTS:<platform>@<handle>
if state == 'claimed'                   -> CLAIMED_BY:<va> (since <opened_at>, expires <expires_at>)
if state in (spec, building)            -> NOT_READY:<state> (+ list of pending steps)
if state == 'qc'                        -> QC_PENDING or QC_STALE (masters changed after approval)
if state == 'needs_rework'              -> NEEDS_REWORK:<note>
if hold_reason                          -> ON_HOLD:<reason>
for slot in policy.claim_gate.requires_assets: if active count < slot.min   -> MISSING_ASSET:<slot> (pfp resolved via pfp_mode variant)
for f in policy.claim_gate.requires_fields: if missing                      -> MISSING_FIELD:<f>
if policy.claim_gate.requires_packet_synced and not packet_synced_at        -> PACKET_NOT_SYNCED
-- VA-dependent part (only when a va is given):
if va.status == 'paused'                                                    -> VA_PAUSED
if open claims of va >= policy.claim_gate.max_open_claims_per_va           -> VA_AT_CLAIM_LIMIT
if built_for_va and built_for_va != va and policy.claim_gate.strict_va_routing -> BUILT_FOR_OTHER_VA
claimable = blocks.length == 0
```

Every list the bots and the UI show is this function's output for every kit: the "honest list". `GET /kits/{kit}/claimability?va=mark` returns it for inspection, with the policy version it was evaluated against.

### Family policy block (data, not code): `kit_families.policy_json`

```json
{
  "family": "transformation", "version": 3, "label": "Transformation (3 before / 3 after)",
  "image_slots": [
    {"id":"before","kind":"master","min":3,"max":3},
    {"id":"after","kind":"master","min":3,"max":3},
    {"id":"reference_sheet","kind":"composite","min":1,"max":1},
    {"id":"pfp","kind":"derived","min":1,"max":1,"variants_by":"pfp_mode",
      "variants":{"real_face":{"source":"after","how":"image_edit after-close, iPhone-EXIF spoof"},"solid_color":{"how":"solid colour tile"}}},
    {"id":"postable","kind":"lifestyle","min":1,"max":6,"default_count":1},
    {"id":"signup_txt","kind":"doc","min":1,"max":1,"sensitive":true}
  ],
  "fields": [
    {"id":"persona_name","required":true},
    {"id":"age_band","enum":["young","midlife","older"],"required":true},
    {"id":"pfp_mode","enum":["real_face","solid_color"],"required":true},
    {"id":"handle","required":true,"pattern":"^[A-Za-z0-9._]{2,30}$"},
    {"id":"bio","required":true,"max_len":150},
    {"id":"dob","required":true,"type":"date","min_age_years":18},
    {"id":"email","required":true,"secret":true},
    {"id":"built_for_va","required":false}
  ],
  "build_steps": ["cast","masters","packet_shell","pfp","profile_patch","lifestyle","pack_lifestyle","signup_txt","mini_sync"],
  "master_steps": ["masters"],
  "qc": {"required":true,"artifact_slot":"reference_sheet",
         "rule":"Viewer-grade: ship if Before is obviously heavier and After is the same person at a glance. Reroll only a named frame. No identity loops, no hue gates."},
  "claim_gate": {
    "requires_assets":["before","after","reference_sheet","pfp","postable","signup_txt"],
    "requires_fields":["handle","bio","dob","email","pfp_mode"],
    "requires_packet_synced":true,
    "max_open_claims_per_va":2, "claim_ttl_hours":72, "auto_release_stale":false,
    "strict_va_routing":false, "platforms":["instagram"]
  },
  "constraints_recorded": [
    "Masters: Atlas GPT Image 2 / 2.5-sunburst only. Grok is image-QC only. Never api.openai.com.",
    "2 input images per minute, one HTTP call at a time (imagegen.py).",
    "Mini sync is tar-over-ssh, never rsync (spaced packet names).",
    "HME must resolve before stage_farm_kit (it wipes profile.email).",
    "Never pipe build_kit.py through | tail; poll scripts/logs/<slug>.<step>.log.",
    "Fictional only, no real-person likeness, no Indian/Pakistani look; never post, never Drive, never video at kit stage."
  ],
  "handoff_template": "Kit {display_name} ({family}). Handle @{handle}. Bio: {bio}. DOB {dob}. PFP mode {pfp_mode}. Packet: {packet_dir} on mini. Images attached: 3 before, 3 after, PFP, {postable_count} postable(s).",
  "process_page": "data/process/build.json#transformation"
}
```

`heygen` policy differs only in data: slots `reference` (min 1, max 3, kind master), `pfp` (derived from `reference/1`, variants real_face only), `postable` (min 0), `signup_txt`; fields add `appearance_prompt` (max 1000), `voice_brief`, and optional provider refs `heygen_group_id`, `heygen_voice_id` that are **not** in the claim gate (ids are a cache; the reference files are the truth, per HeyGen's own skill guidance); `build_steps: ["cast","references","pfp","signup_txt","mini_sync"]`; `qc.artifact_slot: "reference"`; `constraints_recorded` adds "specs under heygen-kits/; batch_guard.py and repair_pfp.py do not cover this family".

Third shipped example, `transformation_couple` (the data already has Elaine & Joel Brooks, Natalie & Thomas Whitaker): slots `before_a`, `after_a`, `before_b`, `after_b` (3 each), one composite `reference_sheet` ("Couples: one composite sheet"), one `pfp`, `platforms:["instagram"]`, same gate otherwise. Adding a family = adding a JSON file (prototype) or `PUT /families/{id}` (production); the gate evaluator does not change. A meta-schema (`data/families/_schema.json`) validates every policy on save, and the Families page previews the pool impact of a policy change ("this makes 12 kits claimable and blocks 3") before it is applied as a `family.updated` event.


## API contract and kitctl mapping

## API contract: `https://hq.jwcoconsulting.com/api/v1`

### Conventions

- JSON envelope: `{"ok":true,"data":...}` or `{"ok":false,"error":{"code":"...","message":"...","details":...}}`. Codes are the same strings as block reasons where applicable.
- Auth: UI calls carry the Cloudflare Access cookie/JWT (role `operator` by email); scripts and bots send `Authorization: Bearer <token>`; the Worker looks up `sha256(token)` in `api_clients`. A `va_bot` token is bound to one `va_id`; any request naming a different VA is `403 VA_MISMATCH`.
- Idempotency: every POST/PUT that can emit an event requires `Idempotency-Key: <uuid>`. Same client + same key + same request hash → the stored response is replayed (status included); same key + different body → `422 IDEMPOTENCY_MISMATCH`; keys kept 7 days. This is what makes bot retries safe.
- Optimistic concurrency for UI edits: `If-Match: <kit.version>`; mismatch → `409 VERSION_CONFLICT` with the current kit.
- Timestamps are always server-assigned.

### Kits

| Method, path | Role | Effect |
|---|---|---|
| `GET /kits?state=&family=&q=&view=board|table|pool&va=` | any | list with `claimable` + `blocks[]` per kit (view=pool: states ready/claimed/qc/needs_rework/building, evaluated for `va`) |
| `POST /kits` `{kit_id, display_name, family_id, fields, built_for_va}` | build, operator | `kit.registered` |
| `GET /kits/{kit}` | any | kit + steps + assets + claims + accounts + blocks + last 50 events |
| `GET /kits/{kit}/claimability?va=` | any | `{claimable, blocks[], policy_version}` |
| `PATCH /kits/{kit}/fields` `{fields}` + If-Match | build (build-time fields), operator | `kit.fields_updated` |
| `POST /kits/{kit}/steps/{step}` `{ok, started_at, finished_at, log_excerpt}` | build, operator | `build.step_completed` or `build.step_failed` |
| `PUT /kits/{kit}/assets/{slot}/{n}` body=bytes, `X-Sha256`, `Content-Type`, optional `If-None-Match: <sha256>` | build, operator | R2 put then `asset.uploaded`; sha mismatch → 400; existing identical sha → 200 no event |
| `GET /kits/{kit}/assets/{slot}/{n}` | operator, build, claim-holding va_bot (sensitive slots: operator + holder only) | streams from R2 |
| `POST /kits/{kit}/assets/{slot}/{n}/retire` | build, operator | `asset.retired` (object kept) |
| `POST /kits/{kit}/packet-synced` `{host, path, file_count, bytes}` | build | `packet.synced` |
| `POST /kits/{kit}/qc` `{decision:"approve"|"reject", frames[], note}` | operator | `qc.approved` / `qc.rejected` |
| `POST /kits/{kit}/hold` `{reason}` / `POST /kits/{kit}/unhold` | operator | `kit.held` / `kit.unheld` |
| `POST /kits/{kit}/retire` `{reason}` / `POST /kits/{kit}/recycle` | operator | `kit.retired` / `kit.recycled` |
| `GET /kits/{kit}/events` | any | timeline |

### Claims

| Method, path | Role | Effect |
|---|---|---|
| `GET /claims?va=&open=1` | any (va_bot: own only) | open claims with `expires_at`, `stale` |
| `POST /claims/next` `{va_id}` | va_bot (own va), operator | claim-next (below). 201 `{claim, kit, packet, expires_at}`; 409 `NO_CLAIMABLE_KIT` with `nearest[]` and `counts_by_block`; 409 `VA_AT_CLAIM_LIMIT`; 409 `OUTBOX_PENDING` never (client-side) |
| `POST /kits/{kit}/claims` `{va_id}` | va_bot, operator | explicit claim, same guards |
| `POST /claims/{claim}/release` `{reason}` | holder, operator | `claim.released` → kit `ready` |
| `POST /claims/{claim}/account-created` `{platform, handle, display_name, created_at, note}` | holder, operator | `account.created`; closes claim when all policy platforms reported; `409 HANDLE_TAKEN {account_id, kit_id, va_id}` if `(platform, handle_norm)` exists |
| `POST /claims/{claim}/done` | holder, operator | closes a partially reported claim explicitly |
| `POST /claims/{claim}/rework` `{note, frames[]}` | holder, operator | `kit.rework_requested` → kit `needs_rework`, claim closed |
| `POST /claims/{claim}/extend` `{hours}` | holder, operator | `claim.extended` |

### Accounts, VAs, families, import, admin

| Method, path | Role | Effect |
|---|---|---|
| `GET /accounts?platform=&va=&status=&kit=&unlinked=1` | any | registry rows joined to kits and `oneup_accounts` |
| `POST /accounts/{id}/burned` `{reason}` | holder-of-kit bot, operator | `account.burned` |
| `POST /accounts/{id}/status` `{status}` | operator | `account.status_changed` |
| `POST /accounts/{id}/link-oneup` `{social_account_id}` | operator | `account.linked_oneup` |
| `POST /accounts/import-csv` (multipart, column map) | operator | staged → reconcile items (`ACCOUNT_CSV_NEW`, `ACCOUNT_CSV_CONFLICT`) |
| `POST /integrations/oneup/sync` | operator, cron | pulls `listsocialaccounts` (+`listcategory`, `listcategoryaccount`) into `oneup_accounts`; proposes matches by (platform, handle_norm) as reconcile items `ONEUP_MATCH_PROPOSED` / `ONEUP_UNMATCHED`; never links silently |
| `GET /vas`, `POST /vas`, `POST /vas/{id}/pause`, `POST /vas/{id}/resume`, `POST /vas/{id}/tokens` (returns token once; `va.token_rotated`) | operator | |
| `GET /families`, `GET /families/{id}`, `PUT /families/{id}` `{policy}` → `{impact:{becomes_claimable[], becomes_blocked[]}}` with `?dry_run=1` | operator | `family.updated`; re-evaluates every kit of the family |
| `POST /import/runs` (multipart: `source` = sheet_csv \| claim_log \| tracker \| fs_walk \| skip_list, file) | operator | `import.run_completed`; classification into `reconcile_items` |
| `GET /reconcile/summary`, `GET /reconcile/items?class=&status=` | operator | |
| `POST /reconcile/resolve` `{class, resolution, item_ids[] | all:true}` | operator | one `reconcile.resolved` + the resolution's events per item |
| `POST /admin/rebuild-projections` `{apply:false}` | operator | replay events → diff; `apply:true` swaps tables and emits `projection.rebuilt` |
| `GET /admin/invariants` | operator | the 8 invariants with counts |
| `GET /export/kits.csv`, `GET /export/accounts.csv` | operator | read-only exports (what replaces the sheet) |
| `GET /health` | none | |

### claim-next, exactly

D1 has no interactive transactions; a `db.batch([...])` is one transaction that rolls back entirely if any statement errors. So every guard lives in SQL, and later statements are made conditional on the first one having won; the unique partial index on `claims` is the backstop that holds even if the Worker code is wrong.

```
1. auth → va_id; idempotency lookup → replay if seen.
2. candidates = SELECT kit_id, version FROM kits
     WHERE state='ready' AND hold_reason IS NULL AND claimable=1
       AND NOT EXISTS (SELECT 1 FROM reconcile_items r WHERE r.kit_id=kits.kit_id AND r.status='open')
       AND (built_for_va IS NULL OR built_for_va=:va OR :strict=0)
     ORDER BY (built_for_va=:va) DESC, ready_at ASC LIMIT 5
3. for each candidate: re-run core/claimability.evaluate (live, with va) → skip if blocks;
   claim_id, event_id, now, expires = policy.claim_ttl_hours; then
   db.batch([
     UPDATE kits SET state='claimed', current_claim_id=:claim_id, version=version+1, claimable=0,
            block_reasons_json=json_array(json_object('code','CLAIMED_BY','detail',:va)), updated_at=:now
      WHERE kit_id=:kit AND state='ready' AND hold_reason IS NULL AND current_claim_id IS NULL AND version=:ver
        AND (SELECT COUNT(*) FROM claims WHERE va_id=:va AND closed_at IS NULL) < :limit
        AND NOT EXISTS (SELECT 1 FROM reconcile_items WHERE kit_id=:kit AND status='open');
     INSERT INTO claims(claim_id,kit_id,va_id,opened_at,expires_at,opened_by_event)
       SELECT :claim_id,kit_id,:va,:now,:expires,:event_id FROM kits WHERE kit_id=:kit AND current_claim_id=:claim_id;
     INSERT INTO events(event_id,ts,type,kit_id,claim_id,actor_type,actor_id,source,idempotency_key,prev_version,new_version,payload_json)
       SELECT :event_id,:now,'claim.opened',kit_id,:claim_id,'va_bot',:client,'api',:idem,:ver,version,:payload FROM kits WHERE kit_id=:kit AND current_claim_id=:claim_id;
     INSERT INTO idempotency_keys(client_id,key,request_hash,status,response_json,created_at)
       SELECT :client,:idem,:rh,201,:response,:now FROM kits WHERE kit_id=:kit AND current_claim_id=:claim_id;
   ])
   if results[0].meta.changes == 1 → won; return 201 with the stored response.
   if changes == 0 → lost a race or state changed; nothing was written; next candidate.
   if the batch throws UNIQUE constraint (claims_one_open_per_kit) → rolled back; next candidate.
4. none won → 409 NO_CLAIMABLE_KIT with nearest[] (top 10 blocked kits and their blocks) and counts_by_block; store under the idempotency key for 1 hour (so a retry gets the same honest answer, not a kit that appeared a second later; the bot runs claim-next again with a fresh key to retry on purpose).
```

Every other mutating endpoint follows the same shape: one batch, first statement guarded by `state` and `version`, subsequent inserts conditional on the first having changed exactly one row.

### Response example, `POST /claims/next` 201

```json
{"ok":true,"data":{
  "claim":{"claim_id":"clm_8f2","kit_id":"eden-crowe","va_id":"mark","opened_at":"2026-10-05T14:02:11Z","expires_at":"2026-10-08T14:02:11Z"},
  "kit":{"kit_id":"eden-crowe","display_name":"Eden Crowe","family_id":"transformation","state":"claimed","version":19,
         "fields":{"handle":"eden.crowe27","bio":"...","dob":"1973-04-11","pfp_mode":"real_face","email":"<decrypted only for holder>"},
         "packet_dir":"Eden Crowe","packet_synced_at":"2026-09-30T02:11:00Z"},
  "packet":{"assets":[{"slot":"before","n":1,"url":"/api/v1/kits/eden-crowe/assets/before/1","sha256":"..."}, "...",
            {"slot":"signup_txt","n":1,"url":"/api/v1/kits/eden-crowe/assets/signup_txt/1","sensitive":true}],
            "handoff_text":"Kit Eden Crowe (transformation). Handle @eden.crowe27 ..."}}}
```


## VA bot sync

## How Mark's and Joanna's bots sync with the new truth

Principle: the VA-facing behaviour does not change; `kitctl.py` keeps its command names and output shape but becomes a thin HTTP client of the one door. Each Hermes profile (`ac-va-1` for joanna → `Account_Creation_VA_2_Bot`, `ac-va-2` for mark → `Account_Creation_VA_1_Bot`) gets two env vars: `HQ_API_URL=https://hq.jwcoconsulting.com/api/v1` and `HQ_API_TOKEN=<its own va_bot token>`. The token is bound to that VA server-side, so `--va` is validated against it (a bot cannot claim for the other VA).

### Command → endpoint mapping (`scripts/kitctl.py` v2)

| Today | v2 behaviour | Endpoint |
|---|---|---|
| `kitctl list [--va X]` | prints every pool kit with ✓/✗ and the block reason inline (the honest list) | `GET /kits?view=pool&va=X` |
| `kitctl claim-next --va X` | claims one kit; prints the same `OK <slug>` / `FAIL: no claimable kit` lines it prints today, plus the nearest blocked kits and why | `POST /claims/next` |
| `kitctl claim <slug> --va X` | explicit claim | `POST /kits/{slug}/claims` |
| `kitctl mine --va X` (new, tiny) | lists this VA's open claims with expiry | `GET /claims?va=X&open=1` |
| `kitctl show <slug>` | kit summary + packet asset list | `GET /kits/{slug}` |
| `kitctl get <slug>` (new) | downloads the packet assets to `~/kits/<slug>/` for the bot to send on Telegram (or prints the mini path from `packet.synced`); signup txt included only for the holder | `GET /kits/{slug}/assets/...` |
| `kitctl created <slug> --platform instagram --handle @x [--display "..."]` | reports the account; on `HANDLE_TAKEN` prints who already has it | `POST /claims/{id}/account-created` |
| `kitctl release <slug> --reason "..."` | returns the kit to the pool | `POST /claims/{id}/release` |
| `kitctl needs-images <slug> --note "..."` | sends the kit to rework, releases the claim | `POST /claims/{id}/rework` |
| `kitctl burned <slug> [--reason]` | marks the kit's account burned | `POST /accounts/{id}/burned` |
| `kitctl sync-sheet` | **no-op**, prints `Nothing to sync: HQ is the source of truth.`, exit 0 (keeps old skill text working) | none |
| `kitctl flush` (new) | resends queued reports from the outbox | as queued |
| `node library/character_tracker.js upsert --field va_owner=...` | **stub that exits 2**: `Door B is closed. Use: kitctl claim-next --va <name>` | none |
| `kitctl pull` (new, for tools that still read characters.json) | writes `characters.json` from the API as a read-only cache with a `_generated_from_hq_at` stamp | `GET /kits?view=table` |

`claim-next` resolves `<slug>` → `claim_id` locally from `kitctl mine` so the VA never sees claim ids.

### Idempotency on the bot side

Before any POST, kitctl writes `~/.kitctl/outbox/<uuid>.json` (`{key, method, path, body, created_at, kind}`) and sends it with `Idempotency-Key: <uuid>`; on 2xx/4xx it deletes the file. A retry after a timeout reuses the same key, so a claim-next whose response was lost returns the same claim, never a second kit. If the process dies between the server commit and the file deletion, the next `kitctl mine` (the skill's first step each session) shows the claim.

### Exactly what happens when HQ is unreachable (timeouts, 5xx, DNS)

Retries: connect 5 s, read 15 s, 3 attempts with 1 s / 3 s / 9 s backoff, only for GETs and for POSTs that carry an idempotency key (all of them). After that:

| Operation | Behaviour | Why |
|---|---|---|
| `claim-next`, `claim` (acquire) | **fail closed**: prints `HQ unreachable: no kit claimed. Wait a few minutes and ask again.` exit 75. Never claims locally, never offers a cached candidate. | Claiming without the ledger is exactly Door B. |
| `created`, `release`, `needs-images`, `burned` (report) | **queued**: the outbox entry stays; prints `Recorded locally, will reach HQ when it is back (kitctl flush).` exit 0. The server still shows the kit as claimed by this VA meanwhile, so nobody else can take it. | The account already exists in the world; losing the report is the worse failure. |
| `claim-next` while the outbox is non-empty | refused locally with `OUTBOX_PENDING: 1 report not yet delivered; run kitctl flush` (`--force` overrides) | The server's count of this VA's open claims is stale; prevents double work. |
| `list`, `show`, `mine` | prints the last cached answer with a banner `CACHED 12 min ago. HQ unreachable. Claims are not possible right now.` | Reading is harmless if clearly stale; the banner stops the VA acting on it. |
| 401/403 (token revoked, VA mismatch) | `HQ token rejected: tell William.` exit 77; never falls back | |
| 409 `NO_CLAIMABLE_KIT` | prints the honest reasons (`No claimable kit. 12 blocked: 7 QC pending, 3 on hold, 2 claimed by Joanna. Nearest: Elaine Whitmore (QC_PENDING)`) | Replaces today's silent FAIL. |

`kitctl flush` runs at the start of every kitctl invocation and from a 5-minute cron in the Hermes profile. Queued reports replay in FIFO order; the server validates transitions, so an out-of-order or duplicate report is rejected, not applied wrongly; rejections are printed and kept in `~/.kitctl/rejected/` for the operator.

Stale claims: the Worker's hourly sweep marks claims past `expires_at` as `stale` (block reason shows `CLAIMED_BY:mark (STALE, 4d)` on the board and in `kitctl list`). Auto-release only if the family policy says `auto_release_stale:true` (default false; the operator or the holder releases). Nothing moves silently.

### The VA skill text changes (minimal)

1. Replace the sheet/CLAIM_LOG sentence in section 6 with: "Truth = HQ (`kitctl`). The sheet is frozen."
2. Delete the paragraph that mentions `character_tracker.js upsert --field va_owner=` (also in KIT-GET-OR-BUILD.md step 4).
3. Add one line at session start: "Run `kitctl mine --va <name>` first; continue any open claim before asking for a new one."
4. Add one line: "If kitctl says HQ unreachable, tell the VA to wait; never create an account for a kit that is not shown as claimed by you."
5. Keep `claim-next` → send packet → `created` flow verbatim; `sync-sheet` may stay in the text (it is a no-op).

### The build side (`scripts/hqctl.py`, role `build`)

`build_kit.py` gains six one-line calls (or a wrapper script runs them from the step logs, so build_kit.py itself can stay unmodified):

| Pipeline moment | Call | Event |
|---|---|---|
| after `cast_from_bank.py --write` | `hqctl register <slug> --family transformation --fields <slug>/profile.json --built-for mark` | `kit.registered` |
| after each chain step finishes (reads `scripts/logs/<slug>.<step>.log` exit) | `hqctl step <slug> <step> --ok --log scripts/logs/<slug>.<step>.log` | `build.step_completed` |
| after `kit_reference` writes `assets/reference-sheet.png` and masters | `hqctl upload <slug> reference_sheet assets/reference-sheet.png` and `hqctl upload <slug> before 1 before_1.png` ... | `asset.uploaded` |
| after PFP, lifestyle, signup txt | `hqctl upload <slug> pfp 1 ...`, `postable 1 ...`, `signup_txt 1 ...` | `asset.uploaded` |
| after mini-sync | `hqctl synced <slug> --host mini --path "/.../First Last" --files N` | `packet.synced` |
| never | there is no "set owner" command | |

Offline behaviour for the build side is the mirror image of the bots: the build must never block on HQ, so every call is written to `scripts/outbox/` first and `hqctl flush` runs at the end of the chain and on cron. The kit simply cannot become `ready` until the events land, which is the safe direction. The uploader sends `X-Sha256`; the server refuses a body whose hash differs, and `If-None-Match` skips files already present, so re-running the chain or the uploader is idempotent.


## Migration and reconciliation

## Migration and reconciliation: nothing enters the pool until the operator says so

### Step 0: collect the five sources (`scripts/hq_export_sources.sh`, run on the Mac)

1. Sheet: File → Download → CSV of the `Avatar Tracker` tab (gid 1888102614). Columns we know: slug/name, `pipeline_stage`, `Lifestyle Ready`, `VA Owner`, `Created OK` (column AI), `created_successfully`, skip marker, `pfp_mode`, handle, bio, DOB, email. The importer has a column-mapping screen so unknown headers are mapped by hand once and saved.
2. `CLAIM_LOG` (farm-kits), parsed as ordered rows `{ts, kit, va, action: claim|release}`.
3. `characters.json` from the reel-pipeline tracker.
4. Filesystem walk of the packet folders on the Mac and (over ssh) on the mini: per slug, which files exist (reference-sheet.png, masters, PFP files, lifestyle count, signup txt, profile.json), sizes, sha256.
5. The skip list (wherever kitctl reads it; question 7).

Each file is uploaded with `POST /import/runs`; rows land in `import_rows` with a `row_hash`, so re-importing a newer export only re-flags rows whose source changed.

### Step 1: classification (`core/reconcile.classify`, pure, shown before anything is written)

Legacy vocabulary map (displayed as a table the operator confirms): `Created OK` ∈ {`Y`,`created`,`yes`,`true`} → created; `burned` → burned; {`N`,``,`no`} → not created; `failed` → hold; anything else → class `UNKNOWN_VOCAB`. `pipeline_stage` ∈ {`lifestyle_ready`,`produced`} → candidate ready; `spec`/`adopted` → spec; `scheduled` or unknown → `STAGE_FLAG_DISAGREE`.

| Class | Definition (from the four sources) | Expected count | Proposed one-click resolution | Alternative |
|---|---|---|---|---|
| `CREATED_LOOKS_FREE` | created per vocab map, gate fields look claimable, no open claim in CLAIM_LOG | ~45 (plus the rest of the 85 unlogged created) | `claim.backfilled` (va = VA Owner if present, else null) + `account.imported` (handle from sheet) → `account_created` | retire kit |
| `UNLOGGED_OWNER_STAMP` | VA Owner non-empty, no CLAIM_LOG claim, not created | ~37 | `claim.backfilled` as an **open** claim for that VA (expires per policy) | release to pool / retire |
| `CLAIMED_OWNER_WIPED` | CLAIM_LOG has an open claim, VA Owner empty | 7 | honour the log: open claim for the logged VA | release to pool |
| `STAGE_FLAG_DISAGREE` | stage and Lifestyle Ready disagree, or stage not in vocabulary (`scheduled`, etc.) | Elaine Whitmore + others | derive state from the filesystem: packet complete → `qc` (needs the viewer-grade look), else `building` | hold |
| `SKIP_LISTED` | on the skip list | Cheryl Drummond + others | `kit.held {reason:'legacy skip list'}` | retire |
| `PACKET_MISSING` | sheet says ready but fs walk finds no packet or an incomplete PFP set for the declared pfp_mode | unknown until walked | state `building` with `MISSING_ASSET` blocks | retire |
| `BURNED` | Created OK = burned | 6 | `account.imported` + `account.burned` → `burned` | |
| `FAILED_FLAG` | Created OK = failed | 1 | hold with reason `legacy failed` | retire |
| `UNKNOWN_VOCAB` | any value outside the map | 0 expected | hold | |
| `LOG_KIT_UNKNOWN` | CLAIM_LOG names a kit not in the sheet | ? | create as `retired` placeholder | ignore |
| `ORPHAN_PACKET` | packet on disk, no sheet row | ? | register as `qc` | ignore |
| `DUP_SLUG` | same slug twice in a source | ? | manual | |
| `CLEAN` | no discrepancy (e.g. camila-ruiz-ig2 at spec, nina-prod-dryrun at adopted) | remainder | accept at derived state | |

Every imported kit gets an open `reconcile_items` row, including `CLEAN` ones, and therefore the block reason `RECONCILIATION_PENDING:<class>`. The pool is 0 after import, which is exactly the live situation today, so cut-over cannot make anything worse. Note the double-check the classifier performs: a row counted in `CREATED_LOOKS_FREE` and also in `UNLOGGED_OWNER_STAMP` (e.g. Anita Walsh, also in CLAIM_LOG) is assigned the created class first, because an existing account is the stronger fact.

### Step 2: the Reconciliation page (`#biz/kits/reconcile`)

One card per class: count, two sample rows, the proposed resolution in plain English ("These 45 kits already have an account. Mark them Account created and give each a backfilled claim so the ledger explains the account. VA will be 'unknown' on 59 of them; you can fix that later per kit."), buttons **Apply to all 45** / **Pick rows** / **Use alternative**, and a VA picker where the proposal needs one. Applying emits `reconcile.resolved` plus the per-kit events with `source='reconcile'` and `actor=operator`; the card turns green with the event count. Nothing is applied by the import itself. A **Re-run classification** button re-classifies from the stored sources after an operator edits the column map or the vocabulary map.

### Step 3: assets (`scripts/hq_import_assets.py`, run on the Mac, which has ssh to the mini)

For every kit in HQ: locate the packet (`~/AgentHome/CLAUDE/AI-Characters/kits/<slug>/` and/or the mini dir named `First Last`), map files to slots by the family's slot list (`assets/reference-sheet.png` → `reference_sheet/1`; `before_1..3`, `after_1..3`; PFP file(s) per `pfp_mode`; lifestyle postables → `postable/n`; signup txt → `signup_txt/1`), compute sha256, `PUT /kits/{id}/assets/{slot}/{n}` with `If-None-Match` so re-runs upload nothing twice. It emits `packet.synced` for kits whose mini dir exists. Kits that fail the slot minimums are not rejected; their `MISSING_ASSET` blocks appear on the board. ~106 kits × ~12 files fits comfortably in R2's free tier (10 GB, 1M Class A ops/month).

### Step 4: cut-over checklist (ordered, each step reversible until step 6)

1. Deploy Worker + D1 + R2 + Access; `GET /admin/invariants` green on an empty ledger.
2. Run `hq_export_sources.sh`; import the five sources; read the class counts and compare with the bot's numbers (45 / 85 / 37 / 7 / 59). If they differ materially, stop and look before resolving.
3. Resolve classes in the UI (expected order: BURNED, CREATED_LOOKS_FREE, CLAIMED_OWNER_WIPED, UNLOGGED_OWNER_STAMP, SKIP_LISTED, STAGE_FLAG_DISAGREE, PACKET_MISSING, CLEAN).
4. Run the asset uploader; verify a few kits on the Kit detail page (reference sheet renders, PFP present).
5. `GET /admin/invariants` green; `POST /admin/rebuild-projections {apply:false}` shows an empty diff.
6. Freeze the sheet tab; replace `kitctl.py` in both Hermes profiles; stub `character_tracker.js upsert --field va_owner`; remove sheet credentials from the profiles.
7. Dry-run: `kitctl claim-next --va mark` on a test kit (`nina-prod-dryrun`, held for everything else), then `kitctl created`, then check the board and the account row; then `kitctl release` on a second test. Only then unhold real kits.
8. Keep the old CLAIM_LOG and CSV in the repo's `docs/migration/2026-10/` as the audit trail.


## UI and process pages

## Pages (all under `#biz/kits`, dark theme, plain-English microcopy, each process page has "Adjust this process")

### `#biz/kits` Kits board
Columns by state: Spec · Building · QC · Needs rework · Ready · Claimed · Account created · Burned/Retired. Each card: display name, family chip, built-for VA, age, and the first block reason in red (`QC pending`, `Claimed by Mark, 2d`, `Missing: pfp`). Header counters: "Ready and claimable: 4 · Blocked: 12 · Invariants: OK (checked 02:10)". Toggle to **Table view** (every kit, every column, CSV export). Filters: family, VA, block code. Red banner if any invariant failed or a projection diff exists.

### `#biz/kits/k/<slug>` Kit detail
Top: reference sheet (large), PFP, postables, with slot labels and "missing" placeholders drawn from the family policy. Right rail: state, hold, version, built-for, claim (VA, since, expires, Release/Extend), accounts (platform @handle, status, OneUp link), **Why it is / is not claimable** (the evaluator's blocks, each with a sentence and a link to the thing that fixes it). Below: packet contents (slot, n, bytes, sha, uploaded by, when, mini path), build steps checklist, fields (edit with If-Match; secrets masked, "reveal" logged), and the **timeline** of events newest first ("Oct 5 14:02 · Mark's bot claimed · expires Oct 8"). Operator actions: QC approve/reroll, Hold, Retire, Recycle, Release claim.

### `#biz/kits/build` Build a kit (process page, per family tab; steps from `data/process/build.json`)
1. **Cast the persona.** "Run this on the Mac: `cd ~/AgentHome/CLAUDE/AI-Characters && source .env.local && python3 scripts/cast_from_bank.py --age-band young|midlife|older --write`, then `hqctl register <slug> --family transformation --built-for mark|joanna`. The kit now exists in HQ as Spec. Nothing else has happened."
2. **Build the masters and the packet.** "`python3 scripts/build_kit.py <slug> --va mark|joanna`. Don't pipe it through `| tail`; watch `scripts/logs/<slug>.<step>.log`. The steps tick here as they report in: masters → packet shell → PFP → profile patch → lifestyle → pack → signup txt → mini sync." Live checklist with log excerpts; constraints box (Atlas only, 2 images/min, HME before stage_farm_kit, tar-over-ssh).
3. **Look at the sheet (QC gate).** Shows `reference-sheet.png`. "Ship if Before is obviously heavier and After is the same person at a glance. Don't run identity loops or hue checks. If one frame looks wrong, name it." Buttons **Approve** / **Reroll frame…** (pick before_1..after_3 → `qc.rejected{frames}` → Needs rework with the exact reroll command shown). If masters changed after an approval the page says "QC is stale: the masters changed on Oct 4. Look again."
4. **Confirm the packet.** Asset checklist resolved for the kit's `pfp_mode`; "Mini sync recorded Oct 4 02:11 from `/…/Eden Crowe`" or "Not synced yet: run the chain's mini-sync step".
5. **Done.** "This kit is Ready. It will be offered by the bots in order of readiness. Nobody owns it; ownership only starts when a VA's bot claims it."
HeyGen tab: 1 Cast + persona prompt, 2 Make 1–3 reference stills (specs under `heygen-kits/`, manual until scripted), 3 QC the stills, 4 PFP + signup txt + sync, 5 Done. Couple tab mirrors transformation with two people and one composite sheet.

### `#biz/kits/pool` Claim pool
Two columns, **Mark** and **Joanna**: "Next kit each bot will get" (the exact candidate claim-next would return, computed by the same function), then the full honest list for that VA: every pool kit with ✓ or the block reason. Below: open claims per VA with expiry and stale flags; "Why zero?" summary (`counts_by_block`). Policy knobs shown read-only with a link to Families.

### `#biz/kits/handoff` Hand-off and account creation (process page, `data/process/handoff.json`)
1. **The VA asks the bot for a kit.** "The bot runs `kitctl claim-next`. HQ writes the claim first, then answers. Oldest ready kit built for that VA first, then any ready kit."
2. **The bot sends the packet.** "Images, PFP and signup txt go to the VA on Telegram (the bot does this as today). The claim appears here as Claimed by Mark with a 72-hour timer."
3. **The VA creates the account** from the signup txt (handle, bio, email, DOB). "The email lives only in HQ and the packet, never in a chat caption."
4. **The VA tells the bot 'created @handle'.** "The bot runs `kitctl created`. The kit becomes Account created and a row appears in Accounts. If that handle already exists in the registry, HQ refuses and says whose it is. That is the overlap check that was missing."
5. **Bad images?** "The VA says 'need new images'. The kit goes to Needs rework with the note, the claim is released, and the Build page shows the reroll."
6. **Gave up or ran out of time?** "Release returns it to the pool with the reason in the timeline. Stale claims are flagged after 72 h, never silently released."
7. **Burned later?** "`kitctl burned` marks the account and retires the persona."
Panel on the right: acknowledgement log per claim (claimed, packet fetched, created/released/rework, with actor and time).

### `#biz/kits/accounts` Accounts registry
Table: platform, @handle, persona/kit (link), VA (or "unknown", click to attribute), status, created/reported, origin, OneUp (linked id / "unlinked" / "expired, reconnect"). Toolbar: **Import CSV** (column map, staged into reconcile items), **Sync OneUp now** (last sync time), **Export CSV**. Right panel: OneUp accounts not matched to any kit, and proposed matches by handle with **Link** / **Not this one**.

### `#biz/kits/vas` VAs
Two cards: Mark (`Account_Creation_VA_1_Bot`, Hermes `ac-va-2`, Pixel `1C041FDF600H87`) and Joanna (`Account_Creation_VA_2_Bot`, Hermes `ac-va-1`, Pixel `19241FDF600EJ5`): token status (created, last used), open claims with expiry, accounts created (30 d / total), **Rotate token** (shows once, with the exact env line for the Hermes profile), **Pause** (claim-next answers `VA_PAUSED`).

### `#biz/kits/families` Kit families
List of families with version; editor with the meta-schema validator; **Preview pool impact** before **Save as version N+1**; the claim gate and constraints rendered as readable sentences next to the JSON.

### `#biz/kits/reconcile` Reconciliation / import
Import wizard (five sources, column map, vocabulary map), class cards with counts and one-click bulk resolution, per-row override, and the invariants panel with **Rebuild projections (dry run)**.


## The "Adjust this process" button

## "Adjust this process" (and "Adjust this page")

Mechanics (from the research, zero backend, no secrets in the page): the button builds a prefilled Claude Code on the web link and opens it in a new tab:

`https://claude.ai/code?prompt=<urlencoded brief>&repositories=<owner/repo of the HQ site>&environment=Default`

The brief is assembled client-side from: `page_id` (`kits.build.transformation`, `kits.handoff`, `kits.families.heygen`), the git SHA baked into the page at publish, the page's own config object (the process steps JSON or the family policy JSON, fenced), the implementing file paths (`kits/data/process/build.json`, `kits/data/families/transformation.json`, `kits/kits.js`), the operator's free-text request (a small textarea in the dialog), and standing rules:

```
## Page
id: kits.build.transformation   route: #biz/kits/build   sha: a1b2c3d
files: kits/data/process/build.json, kits/data/families/transformation.json, kits/kits.js
## Current config
```json { ...process steps... } ```
## Request
<operator text>
## Rules
- Static site, no build step. Edit data files before code.
- Never change kits/core/claimability.js or kits/core/state_machine.js from this button; claim-gate changes go through the family policy JSON and must keep data/families/_schema.json valid.
- Keep sample data working; update CHANGELOG.md; open a PR; do not touch other pages.
```

Keep the encoded prompt under ~4,000 characters; when the config is bigger (family policies can be), the page links to the committed raw file instead of inlining it. Fallback link in the same dialog: GitHub `/issues/new?title=&body=&labels=claude` for when he is on a phone; with the Claude GitHub App and `anthropics/claude-code-action@v1` installed, `@claude` in the issue body opens the PR unattended. Deploy = merge the `claude/...` branch PR.

Correctness guard specific to this design: the button never gives Claude a mandate to touch the gate code. Process microcopy, step order, commands shown, family slot counts and claim-gate fields are all data; a policy change made this way still goes through `PUT /families/{id}?dry_run=1` pool-impact preview before it takes effect in production (the prototype shows the impact locally). "Just ask a question" mode (Worker `/api/ask` with a Console API key, cached kits JSON, `claude-opus-5-5` at `effort: low`) is phase 3 and operator-only; the remote MCP server (`list_kits`, `get_kit`, `list_accounts`, `claimability`) from the `cloudflare/ai/demos/remote-mcp-authless` template is the better long-term way to let Claude Code in the terminal read the ledger. A `CLAUDE.md` at the repo root states the page registry, the data-first rule and the "core/ is append-only-ledger code, do not edit from Adjust" rule so every session follows the same conventions.


## Integration into hq.jwcoconsulting.com

## Integration into hq.jwcoconsulting.com

The module is self-contained and mounts under a hash route. What the host must provide, and nothing more:

1. **A mount call.** When `location.hash` starts with `#biz/kits`, the host calls `mountKits(containerEl, {base:'#biz/kits', adapter})` from `kits/kits.js` (ES module, no framework, no build step) and calls `unmount()` when leaving. The module owns everything below `base` (`/k/<slug>`, `/build`, `/pool`, `/handoff`, `/accounts`, `/vas`, `/families`, `/reconcile`). If the host has no router hook, the module can also self-mount on `hashchange` into `#hq-kits-root`.
2. **Theme.** Styles are scoped under `.hqkits` and read CSS variables with fallbacks (`--hq-bg`, `--hq-fg`, `--hq-accent`, `--hq-card`, `--hq-danger`); the host sets them or the module's dark defaults apply. No global CSS is touched.
3. **An adapter.** `adapter/static.js` (prototype: `kits/data/sample/*.json` + localStorage; the atomic claim is simulated with a single synchronous critical section and a "race test" button that fires two claim-next calls and shows one winner) and `adapter/http.js` (production: `fetch('/api/v1/...')`, same-origin, Access cookie). Both expose the same interface: `listKits, getKit, claimability, registerKit, step, uploadAsset, qc, hold, retire, claimNext, release, accountCreated, rework, listClaims, listAccounts, syncOneUp, linkOneUp, listVas, rotateToken, listFamilies, putFamily, importRun, reconcileSummary, resolve, invariants, rebuild`.
4. **The API on the same origin.** If HQ is a Cloudflare Pages project: add `functions/api/v1/[[route]].js` with D1/R2 bindings in the Pages settings. If it is a Worker with static assets: add the `/api/v1/*` routes to its fetch handler. If it is something else proxied by Cloudflare: deploy the API as its own Worker on `api.hq.jwcoconsulting.com` and set CORS to the HQ origin; the adapter takes a base URL. Bindings: `DB` (D1), `KITS` (R2); vars `TEAM_DOMAIN`, `POLICY_AUD`; secrets `KIT_SECRETS_KEY`, `ONEUP_API_KEY`, `GOOGLE_SA_KEY` (phase 2).
5. **Cloudflare Access** on the hostname (One-time PIN, Allow = the operator's email) and a second Access application for `/api/v1/*` with a Bypass policy; the Worker verifies the Access JWT for UI requests and bearer tokens for the rest. The zone must be on Cloudflare DNS (full or CNAME setup) for Access; the research notes hq already resolves to Cloudflare IPs.
6. **Nothing else.** No shared global state, no host build pipeline, no host database tables, no assumptions about other `#biz` pages. The `Adjust` button needs only the repo name and SHA injected as `window.HQ_BUILD = {repo, sha}` (or it reads a `meta` tag).

The prototype in `IxParacosm.github.io` is the same `kits/` folder served by `kits/index.html`, which is a 40-line stand-in for the host that does nothing but call `mountKits` and set the theme variables. Moving to production is: copy `kits/` into the HQ repo, switch the adapter, add the Worker/Functions code and `wrangler.toml`.


## Phased delivery

## Phases

**Phase 0 · Prototype in this repo (now).** `kits/` module with the nine pages, `core/` modules (vocab, state machine, claimability, reconcile, projection), three family policies, two process JSONs, sample data that reproduces the discrepancy classes with realistic counts (45 / 37 / 7 / Elaine Whitmore / Cheryl Drummond / burned 6 / failed 1 / clean rest) and sample events, static adapter with simulated atomic claim and the race-test button, `CLAUDE.md`. Deliverable: clickable, no build step, on GitHub Pages. Exit: the operator can walk Reconcile → Board → Pool → Hand-off and see every block reason.

**Phase 1 · Control plane live (the correctness cut-over).** `worker/` with `migrations/0001_init.sql`, auth, idempotency, claim-next batch, all endpoints, invariants, nightly rebuild diff, hourly stale sweep; Access; `kitctl.py` v2; `hq_export_sources.sh`; import + reconciliation; `hq_import_assets.py`; the cut-over checklist from the migration section; sheet frozen; Door B stubbed. Exit: `GET /admin/invariants` green, both bots claimed and reported one test kit each, zero phantom-available kits by construction.

**Phase 2 · Build-side integration and registry.** `hqctl.py` calls in the chain (or the log-watching wrapper), QC gate used from the UI, OneUp `listsocialaccounts` sync into `oneup_accounts` with proposed matches, accounts CSV import, read-only exports, optional nightly sheet mirror tab via a service account. Exit: a new kit built on the Mac appears in HQ step by step without the operator typing anything.

**Phase 3 · Families beyond transformation and comfort features.** HeyGen family build steps scripted (reference stills, PFP, signup, sync) and provider refs stored as cache; `transformation_couple` used for real; claim-expiry notices (the Worker can message a VA through that VA's own bot token, optional); remote MCP server for Claude Code; "ask a question" Worker route. Later slices (metadata changer, video creator, posting) reuse the ledger, the policy-as-data pattern and the one-door API: each adds its own event types and projections, never a second write path.

Cost at every phase: $0 (Workers/D1/R2/Access free tiers) until a cron or image job needs more than 10 ms CPU, then $5/month Workers Paid.


## Risks

## Risks and what to verify first

1. **D1 transactional semantics (highest).** The whole claim design rests on `db.batch()` rolling back entirely on a statement error and on SQLite `UNIQUE` partial indexes and `RAISE` triggers being honoured by D1. The research did not cover this; verify with a two-line test in migration 0001 before anything else. Fallback if D1 disappoints: route `POST /claims/next` through a single Durable Object (serialised by construction) that performs the same guarded statements.
2. **The pipeline source is invisible.** `kitctl.py` v2 must print exactly what the Hermes skill parses (`OK <slug>` / `FAIL: ...`), and the packet folder layout drives the asset uploader. Without the real `kitctl.py`, skill text and one packet listing, both are best guesses (question 1, 6).
3. **A Door C we cannot see.** If a Hermes profile holds sheet credentials or ssh access that other skills use to write tracker fields, the invariants hold inside HQ but the bots' mental model stays split. Audit both profiles during cut-over and remove any write credential to the sheet or `characters.json`.
4. **Operator bypass.** `wrangler d1 execute --remote` can write projections without events. Policy: never; the nightly rebuild diff catches it and the board turns red, but the discipline is the real guard.
5. **VA claim limit and TTL defaults** (2 open claims, 72 h, no auto-release) are guesses; wrong values either starve VAs or re-create "claimed forever". They are policy data, cheap to change, but must be set with the operator (question 5).
6. **Reconciliation attribution.** 59 created accounts have no VA; backfilling with `va_id=null` is honest but the accounts page will show "VA unknown" until he attributes them (question 9). Backfilling to the wrong VA would be worse, so the default is null.
7. **Access + bots.** The `/api/v1/*` Bypass policy means hashed bearer tokens are the only guard on the API; mitigate with constant-time compare, token rotation from the VAs page, rate limiting in the Worker, and optionally Access Service Tokens per bot later.
8. **R2/D1 consistency on upload.** The Worker writes R2 then the event; a crash between leaves an orphan object (harmless) and an orphan sweep lists them. Never the reverse order, or an `asset.uploaded` could reference a missing object.
9. **Projection drift from policy edits.** A family change re-evaluates `claimable` for every kit of the family in one batch; with the free plan's 50 statements per invocation this must be chunked for large families (106 kits is fine).
10. **Unverified vendor facts.** OneUp field names (`social_account_id`, `is_expired`, integer `social_network_type`) and HeyGen endpoints come from mirrors and snippets; the registry sync stores `raw_json` and logs unknown shapes rather than dropping rows.
11. **Scope creep into Telegram.** It is tempting to move delivery into the Worker now (forum topics, ack buttons). The design deliberately leaves Telegram to the Hermes bots in phases 1–2 so the cut-over changes one thing: where truth lives.
12. **Egress-blocked docs.** Cloudflare, Telegram, OneUp and HeyGen pages were read from mirrors; re-check limits (D1 50 queries/invocation on Free, R2 free ops, Access JWKS rotation) on the official pages before quoting them to the operator.


## Questions for the operator

- Can you paste the current `kitctl.py`, the VA skill text (the section the bots follow for claim-next → send → created), and 10 lines of CLAIM_LOG? The v2 client must print exactly what the bots parse, and the importer must read the log's real format.
- How is hq.jwcoconsulting.com deployed (Cloudflare Pages from a GitHub repo, a Worker with static assets, or another host behind Cloudflare), which repo holds it, and is the jwcoconsulting.com zone on Cloudflare DNS? This decides where the /api/v1 code lives and whether Access can be attached.
- How does a VA physically receive a packet today: does the Hermes bot read the mini (or the Mac) and send the images over Telegram, or do VAs pull from somewhere themselves? And what is the folder/file layout of one packet (names of the PFP files per pfp_mode, postables, signup txt) so the uploader maps files to slots correctly?
- Per kit, which platforms does a VA create (Instagram only, or also TikTok/YouTube), and can one kit ever have more than one account? This sets `policy.platforms` and when a claim closes.
- May a VA hold more than one open claim at a time, and after how many hours should an unreported claim be flagged stale (and should it ever auto-release)? Proposed defaults: 2 open claims, 72 h, flag only.
- Where does the skip list live (a kitctl file, a sheet column, both?), and are any other tools or pipelines (reel pipeline, batch_guard.py, repair_pfp.py) reading the 'Avatar Tracker' tab or characters.json in a way that breaks when we freeze the tab and turn characters.json into a read-only cache?
- Do either of the Hermes bot profiles hold credentials that can write to the Sheet, to characters.json, or to the Mac/mini (ssh), other than through kitctl? Any such path has to be removed at cut-over or the single-door guarantee is only partial.
- For the ~59 created accounts with no VA recorded, do you want them attributed (to whom, by what rule, e.g. the VA that was building that batch), or left as 'VA unknown' and fixed per kit later? The safe default is unknown.
- Is `build_kit.py --va mark|joanna` used for anything other than routing (e.g. a per-VA mini folder or signup text), and should a kit built for Mark be claimable by Joanna when Mark has nothing pending (proposed: yes, with Mark's kits offered to him first)?
- OneUp: do you have an API key, which plan tier, how do you use categories (one per persona, per VA, or one catch-all), and what timezone is the account set to? Also, for the Google Sheet freeze, which Google account owns the Brain Sheet in case you want the optional read-only mirror tab later?
