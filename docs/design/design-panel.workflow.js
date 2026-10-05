export const meta = {
  name: 'avatar-kits-design-v2',
  description: 'Design the Avatar Kits control plane (single source of truth, claim safety, VA bot sync, sheet verdict) from the brief and research files',
  phases: [
    { title: 'Design', detail: 'three independent proposals from different angles' },
    { title: 'Judge', detail: 'three judges with different lenses score every proposal' },
    { title: 'Synthesize', detail: 'merge the winner with the best ideas of the others' },
  ],
}

const BRIEF = args.brief_path
const RESEARCH = args.research_path

const READ_FIRST = `
FIRST, read these two files with the Read tool before doing anything else (they are the whole context; do not web-research again, do not try to fetch blocked hosts):
1. ${BRIEF}  (the operator's two messages verbatim, the Telegram bot's description of the existing local pipeline and its claim/created data corruption, verified session facts, the friend's reference UI)
2. ${RESEARCH}  (six sourced research reports: OneUp API, HeyGen avatars, Telegram bot delivery, backend/storage comparison incl. Cloudflare D1/R2/Access and Google Sheets ingestion, kit-type schema + tag vocabulary, the 'Adjust this page / ask Claude' mechanics). It is ~200 KB; read it in full.
`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    name: { type: 'string' },
    elevator_pitch: { type: 'string' },
    sheet_verdict_md: { type: 'string' },
    architecture_md: { type: 'string' },
    data_model_md: { type: 'string' },
    state_machine_md: { type: 'string' },
    api_contract_md: { type: 'string' },
    bot_sync_md: { type: 'string' },
    migration_md: { type: 'string' },
    ui_md: { type: 'string' },
    adjust_button_md: { type: 'string' },
    integration_md: { type: 'string' },
    phases_md: { type: 'string' },
    risks_md: { type: 'string' },
    questions_for_user: { type: 'array', items: { type: 'string' } },
  },
  required: ['angle', 'name', 'elevator_pitch', 'sheet_verdict_md', 'architecture_md', 'data_model_md', 'state_machine_md', 'api_contract_md', 'bot_sync_md', 'migration_md', 'ui_md', 'adjust_button_md', 'integration_md', 'phases_md', 'risks_md', 'questions_for_user'],
}

const DESIGN_BRIEF = `
YOU ARE DESIGNING: the 'Avatar Kits' module of the operator's HQ site, as the first slice of a flexible workflow system (avatar creator -> metadata changer -> video creator -> posting). Only the Avatar Kit slice is in scope, but the architecture must make the later slices natural to add.

WHAT CHANGED VERSUS A NAIVE READING OF THE FIRST MESSAGE (read section 2 of the brief carefully):
- The kit BUILDER already exists as deterministic local Python scripts on the operator's Mac (cast_from_bank.py, build_kit.py chain, kit_reference, stage_farm_kit, gen_lifestyle, pack_lifestyle, write_signup_txt, mini-sync over ssh). Do NOT redesign image generation or move it into a browser or a Worker. The website is the CONTROL PLANE and the SINGLE SOURCE OF TRUTH for kit state, claims, VA ownership, account creation, and the accounts registry.
- The real, measured failure is STATE: truth is split across the Google Sheet ('Avatar Tracker' tab, 106 rows), an append-only CLAIM_LOG, and a local tracker (character_tracker.js / characters.json). Two write paths (kitctl.py with lock+log vs raw upsert), two spellings of one flag ('Y' vs 'created'), stale pipeline_stage strings, and 'VA Owner' being a lossy projection produced 45 phantom-available kits, 85 created accounts with no claim row, 37 unlogged owner stamps, and 7 claimed kits that look free forever. VAs created accounts that already existed. The design must make these failure classes structurally impossible, not merely patched.
- Two VAs (Mark, Joanna), each with their OWN Telegram bot (Account_Creation_VA_1_Bot / Account_Creation_VA_2_Bot), each a Hermes agent profile paired with a Pixel phone. Today the bots run 'kitctl.py claim-next --va <name>' then 'sync-sheet'. The design must say exactly how these bots sync with the new source of truth (the operator's explicit constraint) with minimal change to the VA-facing behaviour.
- The operator asks, explicitly: is the Google Sheet still necessary? Give an honest verdict with reasons, and what (if anything) replaces its remaining value (a place to glance at all rows, VA familiarity, manual edits).
- Kit families: 'transformation' (6 masters: 3 before + 3 after; pfp_mode real-face or solid-color; N lifestyle postables; farm packet; signup txt) and 'heygen' (1-3 strong reference stills used to derive every later image; specs under heygen-kits/, not covered by existing tooling). New families must be addable as a declarative 'policy block' (which fields gate claimability, which PFP mode, how many postables, image slots, process steps) without editing the claim gate.

HARD REQUIREMENTS:
1. One source of truth with an append-only event log; every state change is an event; projections (status, owner) are derived and can be rebuilt from events. Exactly one write path (an HTTP API). Claims are atomic in the database (transaction + unique constraint), so a double claim cannot happen even if two bots race.
2. A single explicit kit state machine with one vocabulary (no 'Y' vs 'created'); claimability is a derived, inspectable predicate per kit family; every non-claimable kit carries a machine-readable block reason the UI and the bots show inline ('honest list').
3. API clients: (a) the HQ UI, (b) the local build scripts (register a kit, upload the reference sheet/PFP/postables, advance build steps, set QC results), (c) the two VA bots (list claimable, claim-next, report account created with handle, release, mark burned, needs-new-images). Specify endpoints, auth (per-client bearer tokens with roles), idempotency keys, and the exact 'kitctl' command-to-endpoint mapping so the VA skill text barely changes.
4. Migration/reconciliation of the existing data: import the sheet tab (CSV export first), CLAIM_LOG, and the local tracker into the new store; classify every row into the discrepancy classes the bot found (created-but-looks-free, unlogged owner stamp, claimed-but-owner-wiped, stage/flag disagreement, skip-listed, packet-missing); show them in a reconciliation UI where the operator resolves each class in bulk with one click; nothing is auto-resolved silently. Import all existing kit assets (reference-sheet.png, PFP, postables) from the packet folders on the Mac/mini via a one-off uploader script.
5. Kit families as data ('policy block' + image slots + metadata fields + process steps + export/handoff template), with 'transformation' and 'heygen' shipped and a third example.
6. Process pages with numbered steps and plain-English microcopy in the friend's style, each with an 'Adjust this process' affordance that routes a change request to Claude Code (use the researched mechanics). Pages at minimum: Kits board; Kit detail (reference sheet, packet contents, timeline of events, block reasons); Build a kit (tracks the local pipeline's steps; shows the command to run; QC gate approve/reroll); Claim pool (what each bot will offer next, with block reasons); Hand-off and account creation (what the VA bot does, acknowledgements, handle capture); Accounts registry (merge of kits -> created accounts -> OneUp social accounts, with CSV import and OneUp API sync); VAs (two VAs, their bots, devices, current claims); Kit families (config); Reconciliation/import.
7. Integration into hq.jwcoconsulting.com, whose source we cannot see: the module is self-contained (mountable at a hash route such as #biz/kits), with a thin data-adapter layer (static JSON + localStorage in the prototype; the HTTP API in production); state exactly what is needed from the host site.
8. Solo operator maintaining everything with Claude Code: fewer moving parts beat clever ones; prefer the backend the research scored best unless you argue otherwise with evidence from the research; keep secrets out of the browser; no paid services unless justified.
9. Respect the existing hard constraints of the local pipeline (Atlas GPT Image 2 only, rate limits, tar-over-ssh, never post/Drive/video from the kit stage); the control plane records them, it does not change them.

OUTPUT: a complete, opinionated proposal from YOUR assigned angle in the structured fields (Markdown inside strings). Be concrete: table/column names, JSON shapes, endpoint paths, state names, event names, page routes, file names, and the exact numbered steps of each process page. Keep questions_for_user to the 10 that most change the build.
`

const ANGLES = [
  { key: 'bulletproof', angle: 'Correctness-first: design the state model, claim atomicity, event log, reconciliation and bot sync so the measured failure classes cannot recur; everything else serves that. Be rigorous about invariants and about how the bots behave when the API is unreachable.' },
  { key: 'flex', angle: 'Flexibility-first: a small registry/plugin architecture where kit families (policy blocks), providers, process pages, data adapters and export templates are declared as data so new ways of making avatars and videos are added without rewrites; show how the later slices (metadata changer, video creator, posting) plug in.' },
  { key: 'ops', angle: 'Operations-first: optimize for the daily loop as it really runs (build on the Mac -> QC -> packet on the mini -> bot claim -> VA creates the account on the Pixel -> account tracked -> OneUp connected) with the least disruption to Mark and Joanna, honest bot output, and the operator seeing everything in one place within the first week.' },
]

phase('Design')
log('Design: 3 independent proposals (each reads brief.md + research.json first)')
const designs = (await parallel(ANGLES.map((a) => () =>
  agent(`${READ_FIRST}\n${DESIGN_BRIEF}\nYOUR ANGLE: ${a.angle}`, {
    label: `design:${a.key}`,
    phase: 'Design',
    schema: DESIGN_SCHEMA,
    effort: 'xhigh',
  }).then((d) => (d ? { key: a.key, design: d } : null))
))).filter(Boolean)
log(`Design: ${designs.length}/3 proposals returned`)

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          proposal: { type: 'string' },
          claim_safety: { type: 'number' },
          truthful_state: { type: 'number' },
          flexibility: { type: 'number' },
          time_to_value: { type: 'number' },
          va_bot_fit: { type: 'number' },
          maintainability_solo_claude_code: { type: 'number' },
          stack_fit: { type: 'number' },
          risk_inverse: { type: 'number' },
          total: { type: 'number' },
          rationale: { type: 'string' },
          flaws: { type: 'array', items: { type: 'string' } },
        },
        required: ['proposal', 'claim_safety', 'truthful_state', 'flexibility', 'time_to_value', 'va_bot_fit', 'maintainability_solo_claude_code', 'stack_fit', 'risk_inverse', 'total', 'rationale', 'flaws'],
      },
    },
    winner: { type: 'string' },
    best_ideas_to_graft: { type: 'array', items: { type: 'string' } },
    sheet_verdict_consensus: { type: 'string' },
  },
  required: ['lens', 'scores', 'winner', 'best_ideas_to_graft', 'sheet_verdict_consensus'],
}

const LENSES = [
  { key: 'pragmatist', lens: 'Solo-operator pragmatist: will this get built and maintained by one person with Claude Code, and will the operator see all kits, claims and accounts in one place within the first week? Punish moving parts that do not earn their keep.' },
  { key: 'invariants', lens: 'Distributed-systems skeptic: try to break each proposal. Can two bots claim the same kit? Can a created account look free? Can the sheet or a local tracker re-introduce a second writer? What happens when the API is down, a request is retried, or the importer runs twice? Reject hand-waving.' },
  { key: 'vaops', lens: 'VA operations manager for Mark and Joanna: does the bot flow stay simple and honest (what the bot says is claimable is claimable), is the packet complete, are credentials handled safely, does account-created reporting capture the handle reliably, and is the migration of the current mess something the operator can actually finish in an afternoon?' },
]

const DESIGNS_BLOB = JSON.stringify(designs.map((d) => d.design), null, 1)

phase('Judge')
log('Judge: 3 judges score all proposals')
const judgments = (await parallel(LENSES.map((l) => () =>
  agent(`${READ_FIRST}\nTHREE PROPOSALS (JSON):\n${DESIGNS_BLOB}\n\nYou are a judge. Your lens: ${l.lens}\nScore each proposal 1-10 on: claim_safety, truthful_state, flexibility, time_to_value, va_bot_fit, maintainability_solo_claude_code, stack_fit, risk_inverse (10 = lowest risk). total = sum. Be adversarial: list concrete flaws per proposal (what would break, be slow, be wrong for this operator, or silently reintroduce a second source of truth). Name a winner, list the best ideas from the non-winners to graft, and state the consensus verdict on whether the Google Sheet is still necessary. Identify proposals by their 'name' field.`, {
    label: `judge:${l.key}`,
    phase: 'Judge',
    schema: JUDGE_SCHEMA,
    effort: 'high',
  }).then((j) => (j ? { key: l.key, judgment: j } : null))
))).filter(Boolean)
log(`Judge: ${judgments.length}/3 judgments returned`)

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    sheet_verdict_md: { type: 'string' },
    final_design_md: { type: 'string' },
    prototype_spec_md: { type: 'string' },
    kit_families_json: { type: 'string' },
    state_machine_json: { type: 'string' },
    questions_for_user: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } },
  },
  required: ['sheet_verdict_md', 'final_design_md', 'prototype_spec_md', 'kit_families_json', 'state_machine_json', 'questions_for_user', 'assumptions', 'sources'],
}

phase('Synthesize')
log('Synthesize: merging the winner with grafted ideas and resolving every judge flaw')
const final = await agent(`${READ_FIRST}\nPROPOSALS (JSON):\n${DESIGNS_BLOB}\n\nJUDGMENTS (JSON):\n${JSON.stringify(judgments.map((j) => j.judgment), null, 1)}\n\nYou are the synthesizer. Produce the final design for the Avatar Kits control plane by taking the proposal the judges favored and grafting the best ideas they flagged from the others, resolving every flaw the judges raised (say how, briefly). Write for the operator (plain English, short sentences, no em-dashes) with technical precision where it matters. Output fields:
1. sheet_verdict_md: the honest answer to 'is the Google Sheet still necessary?', with reasons tied to the measured failures, what replaces each of its remaining uses, and the exact cut-over rule (when the sheet becomes read-only and when it can be deleted).
2. final_design_md: a complete design document in Markdown with these sections: Summary; What exists today and what is unknown; Architecture (control plane vs local builder, single source of truth, one write path, backend choice with the migration path from prototype, auth and tokens); Data model (tables and JSON shapes: kit_families, kits, kit_assets, personas/profile fields, vas, bots, claims/events, accounts, oneup_accounts, sync_runs, reconciliation_items); Kit state machine and claimability (states, events, the per-family claim predicate, block reasons); API contract (endpoints, roles, idempotency) and the kitctl command mapping; VA bot sync (how Account_Creation_VA_1_Bot and _2_Bot use the API; offline behaviour; what the VA sees); Build pipeline integration (how build_kit.py reports steps and uploads assets; QC gate); Process pages (each as numbered steps with microcopy in the friend's plain-English style); The 'Adjust this process' button (mechanics); Integration into hq.jwcoconsulting.com (mount contract, hash routes, what we need from the host site); Migration and reconciliation (import sources, discrepancy classes, bulk resolutions, asset uploader, the afternoon runbook); OneUp and accounts registry (join keys, sync); Phased delivery plan (Phase 0 prototype in this repo; Phase 1; Phase 2; Phase 3, each with concrete deliverables and an estimate in operator-days); Risks; Open questions. Cite sources inline as URLs where a fact depends on an external API.
3. prototype_spec_md: a precise build spec for a static, no-build-step prototype (vanilla HTML/CSS/JS ES modules, one folder, relative paths only, works from file:// and from a static host) with sample data that mirrors the REAL situation (about 14 kits across both families in varied states including every discrepancy class with realistic fictional names; 2 VAs with their bots and devices; ~12 accounts; events), suitable for one builder agent to implement in one pass: file list, routes (hash-based), components, sample-data shapes, interactions that must work (kits board with state filters and block reasons; kit detail with reference sheet placeholder, assets, event timeline; claim pool simulation 'What Mark's bot gets next' with the predicate explained; simulate claim/created/release events that append to the event log and re-derive status; reconciliation screen with the discrepancy classes and bulk-resolve buttons; accounts table with CSV import + column mapping and OneUp JSON paste; VAs page; kit families config viewer/editor rendered from JSON; 'Adjust this process' modal that composes the Claude Code brief and opens the prefilled link), data adapter interface (local JSON + localStorage now, HTTP API later), visual spec (dark theme tokens, sidebar groups, numbered steps, cards, right rail, status chips; also a light theme), accessibility basics, and what must be clearly-labeled stubs (real Telegram send, real OneUp fetch, real API).
4. kit_families_json: a JSON string with the family registry for 'transformation', 'heygen', and one more example, exactly as the prototype should ship it (policy block, image slots, metadata fields, process steps, handoff template).
5. state_machine_json: a JSON string listing states, events, allowed transitions (from, event, to, actor roles) and block reasons.
6. questions_for_user: consolidated, deduplicated, max 12, ordered by how much the answer changes the build.
7. assumptions: what we assumed in their absence.
8. sources: URLs relied on.`, {
  label: 'synthesize',
  phase: 'Synthesize',
  schema: FINAL_SCHEMA,
  effort: 'xhigh',
})

return { designs, judgments, final }