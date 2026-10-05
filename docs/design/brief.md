# BRIEF: Avatar Kits module for hq.jwcoconsulting.com

## 1. The operator's first message (verbatim)

https://hq.jwcoconsulting.com/#biz

I have a new business website. So there's a couple of things that I want to build out for it. One of the most apparent things would be just to implement my workflows. I'm my whole workflow from my avatar creator to my metadata changer, video creator and posting.

Here's a couple things though. I want you to essentially make it so that it's integrated into this website. But I need you to make it ubiquitous and really flexible in the sense that I'm going to have different ways of creating my avatars, different ways of creating my videos and things like that, right? Right now. Avatar creators specifically for transformation style avatar kits. Right now, the video creator is only for transformation style avatars, right? I wanted to be really flexible, so I wanted to give it options, and I want to have a UI for each of these process, so that I can ask you or actually ask it in the UI itself. Or click a button in the UI that can make it so I can adjust it to have what I want.

So in this case, let's focus on just the Avatar Creator Kit because I need those kits, and I need to also keep track of these kits to make sure that I can give it to my virtual assistants via Telegram. And so that they can also create the accounts. Right now, we have transformation avatar kits, but I also want to make like HeyGen specific avatar kits, and those are a little bit different. Those aren't like six images, reference images, right? Because I don't need six reference images. I don't need three before, three after. I just need one or two or three good images that can be used as a reference to make. Every other image thereafter for all the videos.

Does that make sense? Let's go ahead and plan this out. I want you to integrate that workflow, specifically just the Avatar Creator workflow, and also come up with a way to integrate all of my existing Avatar Kits, as well as taking the data from OneUp and my Google Excel sheet. (Google Sheet id 1n7Qz0AFnmUN5lWMemQSFqPLZ_NvAEiYK17XrsK8ekWk, tab gid 1888102614; this is the 'Brain Sheet' whose 'Avatar Tracker' tab is referenced below.)

To essentially just make it so that it has a clear UI of all my accounts, all the data needed, and all that good stuff. Let me know if you have any questions and concerns.

Also, I pasted screenshots of what my friend's interface looks like as an example.

## 2. The operator's second message (verbatim), including the Telegram bot's breakdown of the existing system

This was essentially my overview. I asked my Telegram bot, the one that was in charge of creating these avatar kits, to explain what it does and some of the issues. You can take it as you will, but the key thing is I actually wanted to integrate it all into this website UI, so I can keep track of everything and so that I can have a consolidated source of information as well. And I want you to actually let me know whether you think the Google sheet that I gave you is even necessary at this point in time. I want to hear your honest thoughts because I am striving for simplicity and seamless, bulletproof systems that won't have any issues, right? But you also need to keep in context that I need to sync the data with my Telegram bot that my virtual assistants utilize. Which are Account Creation VA 2 and 1 Bot. (two bots, one each for my VAs)

Down below is my conversation with my telegram bot:

> Can you go ahead and give me a breakdown so my cloud can understand how you work? I'm trying to integrate the skill, and also make it more flexible.

I'll answer from what I actually verified this session, and flag what I couldn't.

1. What the job is
Build fictional transformation-influencer avatar kits. One stage, no cross-stage decisions. A kit is not done at kit. Done = lifestyle_ready + farm packet + lifestyle postable(s) + mini-synced + va_owner=''.

2. Session bootstrap (file-based, not memory)
Every session reads, in order:
- ~/AgentHome/CLAUDE/AI-Characters/PRIME.md — one job + pointers
- ~/AgentHome/CLAUDE/AI-Characters/KITS-TEMPLATE/TEMPLATE.md — authoritative procedure + current prefs
- SESSION-HANDOFF-KITS.md — where the last session stopped
- ROSTER.md — cast index (anti-clone)
Conflict rule: TEMPLATE.md wins over any prose, skill, or memory.

3. Build path (deterministic, one driver)
cd ~/AgentHome/CLAUDE/AI-Characters && source .env.local
python3 scripts/cast_from_bank.py --age-band young|midlife|older --write
python3 scripts/build_kit.py <slug> --va mark|joanna
build_kit.py chains: kit_reference --no-pfp (masters) → stage_farm_kit --spoof (packet shell) → real-face PFP (image_edit from after-close → iPhone-EXIF spoof) → profile patch (handle/bio/email) → gen_lifestyle --spoof --count 1 → pack_lifestyle → write_signup_txt → mini-sync (tar-over-ssh) → tracker ownerless.
Casting is the glow-up mill, not LLM archetype prose. handlegen.py randomizes IG handles at cast time (varied shapes, random 2-3 digits, collision-checked).

4. Hard constraints
- Kit image gen = Atlas GPT Image 2 / 2.5-sunburst only. Never Grok Imagine for masters. Grok is image-QC only.
- 2 input-images/min, one HTTP at a time (imagegen.py).
- Never call api.openai.com for kits.
- Mini sync = tar-over-ssh, never rsync (spaced packet names "First Last" break openrsync).
- Never pipe build_kit.py through | tail — buffers stdout; poll scripts/logs/<slug>.<step>.log.
- HME must resolve before stage_farm_kit (that step wipes profile.email).
- Bans: no Indian/Pakistani look, fictional only, no real-person likeness, never post, never Drive, never video.

5. QC gate
Viewer-grade (William 08-20): look at assets/reference-sheet.png. Ship if before is obviously heavier and after is the same person at a glance. Do not gate on check_identity.py 5-pair grok loops, dispute drills, hue≤8°, or heaviness_gate.py. Reroll only a named frame the sheet makes look wrong. Couples: one composite sheet.

6. Claimability
- Truth = Brain Sheet tab Avatar Tracker; tool = ~/AgentHome/PROJECTS/farm-kits/scripts/kitctl.py.
- Claimable predicate (all must pass): pipeline_stage ∈ {lifestyle_ready, produced} and Lifestyle Ready == yes and VA Owner empty and no open claim row in CLAIM_LOG and not skip-listed and packet present on disk with its PFP set complete for its declared pfp_mode.
- CLAIM_LOG gives atomicity: claimed iff a claim row with no later release row. VA Owner is only a projection of the log.
- va_owner is written only when the VA's bot runs claim-next. Pre-stamping it at build permanently blocks claim-next (ownerless-only).

7. VA bots
- joanna → Account_Creation_VA_2_Bot → Hermes profile ac-va-1 → Pixel 19241FDF600EJ5
- mark → Account_Creation_VA_1_Bot → Hermes profile ac-va-2 → Pixel 1C041FDF600H87
- They claim with kitctl.py claim-next --va <name>, then sync-sheet. Do not use raw character_tracker.js upsert --field va_owner= — local-DB-only, no CLAIM_LOG row, no lock, two VAs can take the same kit.

8. What I found live right now
kitctl claim-next --va mark and --va joanna both return FAIL: no claimable kit. There are 0 claimable kits.
- 55 kits sit at lifestyle_ready + Lifestyle Ready=yes, but 51 are already claimed in CLAIM_LOG. Sheet VA Owner is blank on most of them — the blank cell is a projection lie, not availability.
- 5 are owner-set without a log row: Cheryl Drummond (mark, also skip-listed), Gloria Hale (joanna), Harper Bishop (mark) — plus Delia Chambers, Elaine & Joel Brooks and others logged too.
- 3 have empty owner and no claim row, but fail other gates: Elaine Whitmore (stage=scheduled, life=no), camila-ruiz-ig2 (stage=spec), nina-prod-dryrun (stage=adopted).
- Elaine Whitmore is the only near-miss: packet complete (solid PFP, 3 spoofed lifestyle, signup txt, bio, handle, DOB) but stage is scheduled and Lifestyle Ready=no, so no bot will offer it.
So 10 kits cannot be handed to Mark and Joanna as claimable right now.

9. What I could not verify
Whether the mark/joanna owner stamps on Cheryl Drummond / Gloria Hale / Harper Bishop came from a bot's claim-next (logged properly) or a raw upsert (unlogged), and whether the VA bots are actually running kits' skill path right now.

10. Integration notes for a more flexible version
- Two families share one gate (real-face vs solid-color) — already handled by reading the packet's declared pfp_mode instead of hardcoding one policy.
- The claim predicate is hardcoded in kitctl.py (stage set, life flag, skip semantics). A declarative per-family policy block (which fields gate claimability, which PFP mode, how many lifestyle postables) would let you add a kit family without editing the gate.
- Lifestyle Ready vs pipeline_stage can disagree (Elaine Whitmore is exactly that), and claimed-but-owner-blank rows exist because VA Owner is a projection. Any integration must read CLAIM_LOG, never the sheet cell alone.
- kitctl lives at farm-kits/scripts/ but other tooling assumes AI-Characters/scripts/; the heygen family has specs under heygen-kits/ so batch_guard.py/repair_pfp.py don't cover them.

> (Operator) No, you definitely had some issue with claiming... there's a huge discrepancy when it came to the kits and whether or not they were actually claimable, and whether or not the information's correct in terms of whether or not the account was created by a virtual assistant. Because my virtual assistants found overlaps of a ton of accounts that you said were claimable, but they were already created.

KITS overview — with the claim/created discrepancy as the headline (measured live: Brain Sheet Avatar Tracker, CLAIM_LOG, reel-pipeline characters.json, kitctl.py)

THE CORE PROBLEM: 45 kits read as "free and ready" on the sheet while Created OK says the account already EXISTS. Filtered to the gate's own readiness fields (stage ∈ lifestyle_ready/produced and Lifestyle Ready = yes) with a blank VA Owner, there are 45 kits that look available while Created OK = Y/created. Sample: Eden Crowe, Joan Boone, Hattie Voss, Dottie Voss, Norma Hale, Peyton Porter, Frances Lawson, Callie Keller, Noelle Crowe, Denise Bishop, Norma Greer, Hattie Flynn, Denise Drake, Helen Bishop, Joan Nash, Patricia Shaw, Rhonda Drake, Sharon Hayes, Anita Voss, Anita Walsh (also in CLAIM_LOG), Natalie & Thomas Whitaker, Valerie Cross, Nina Castellano, Traci Vaughn, Whitney Cole.
Created OK is doing no work as a gate. Value vocabulary is inconsistent and only two strings block: 'Y': 53 (NOT treated as created), 'created': 37 (treated as created), 'burned': 6, 'N': 5, '': 4, 'failed': 1. kitctl._created_block() only blocks the literal strings created and burned. So 53 accounts marked Y sail through the guard. The same field is written two different ways by two different writers.

SECOND PROBLEM: 85 of 90 created accounts have NO CLAIM_LOG row. created_successfully = Y is set on 90 kits; 85 have no claim row (claimed through the old non-atomic path character_tracker.js upsert --field va_owner=, which writes no log row and takes no lock); 59 have a blank VA Owner cell while already created. VA Owner is only a projection of CLAIM_LOG, and two thirds of the real claims never entered the log.

THIRD PROBLEM: the claim guard and the truth live in different systems. kitctl reads the sheet's column AI (Created OK) for its created-gate, and CLAIM_LOG for atomicity. The tracker's own field is created_successfully, mirrored to that same column. Sheet and local tracker agree on all 106 rows, so it's not sync lag; it's a single flag written with two spellings and a gate that recognizes only one. 85 created kits sit at a stage string the gate considers claimable (76 at a claimable stage and LifeReady=yes).

FOURTH PROBLEM: the tool tells the VAs two different stories. kitctl list prints 55 rows with no check mark, a mixed list that includes already-created and already-claimed kits; the check column ignores the packet-on-disk check. claim-next returns FAIL for both VAs only because hidden guards trip. A VA reading the list sees dozens of plausible kits; the tool refuses all of them; the VA finds the accounts already exist.

FIFTH: claims go through two doors. Door A (correct): kitctl.py claim/claim-next → flock + CLAIM_LOG append + owner projection + verify. Door B (silent corruption): node library/character_tracker.js upsert --field va_owner=<name> → local + sheet write, no log row, no lock; still documented in KIT-GET-OR-BUILD.md step 4 and in the VA skill's older prose. 37 unlogged owner stamps are on the sheet right now (e.g. Adaline Mercer, Gloria Hale, Harper Bishop, Delia Chambers, Kendra Lee, Ivy Sandoval, Linh Nguyen, Margaret Nolan, Nancy Whitfield, Mei Chen, Yuki Tanaka, Tessa Ramos, Gina Russo). Inverse: 7 kits are claimed in CLAIM_LOG but their VA Owner cell has been wiped (Anita Keller, Anita Pratt, Anita Voss, Anita Walsh, Gloria Drake, Gloria Greer, Mark Sullivan): they look free forever because only the log knows they're taken.

What a fix has to touch:
1. Normalize Created OK to one vocabulary and make the gate accept all created-equivalents.
2. Backfill CLAIM_LOG for the 37 unlogged owner stamps so the log becomes the truth.
3. Close Door B — remove the upsert --field va_owner path; force every claim through kitctl.
4. Stop trusting stale pipeline_stage. Stage should advance on creation, or claimability should key off an explicit claimable flag rather than a stage string.
5. Make kitctl list honest — show the block reason inline.
6. One policy block per kit family (real-face vs solid-color PFP, which fields gate the claim, how many lifestyle postables) so adding a family doesn't mean editing the gate.

## 3. Facts established in this session (verified)

- The only accessible GitHub repo is IxParacosm/IxParacosm.github.io (GitHub Pages enabled, default branch master): one placeholder index.html ('Project105') last pushed in 2019. None of the existing pipeline (AI-Characters scripts, farm-kits/kitctl.py, heygen-kits, character_tracker.js, CLAIM_LOG, Hermes bot profiles) is in any accessible repo; it lives on the operator's Mac and a Mac mini ('mini-sync' over ssh). We cannot read it; design against the bot's description.
- hq.jwcoconsulting.com resolves to Cloudflare IPs; the HQ site is most likely Cloudflare Pages/Workers or Cloudflare-proxied; its source is not accessible. jwcoconsulting.com is on Squarespace. The URL uses a hash route (#biz): the HQ site is probably a hash-routed single-page app.
- The egress proxy blocks hq.jwcoconsulting.com, docs.google.com, github.io, and most vendor doc hosts. The Google Sheet contents are unknown beyond what the bot reported (tab 'Avatar Tracker', ~106 rows, columns including pipeline_stage, Lifestyle Ready, VA Owner, Created OK = column AI, created_successfully, skip list, pfp_mode).
- Runtime available for prototyping: Node 22, Python 3.11, bun. The repo has no build tooling.

## 4. What the operator's business looks like (inferred)

A solo operator (William, JWCo Consulting) runs a fleet of fictional AI-avatar social accounts (TikTok/Instagram style). The existing LOCAL pipeline builds 'transformation' kits: 6 master reference images (3 before, 3 after) plus a profile picture (real-face or solid-color pfp_mode), lifestyle postables, a signup txt (handle/bio/email/DOB), packaged as a 'farm packet' and synced to a Mac mini. Two VAs (Mark and Joanna) each have their own Telegram bot (Account_Creation_VA_1_Bot for mark, Account_Creation_VA_2_Bot for joanna), each a Hermes agent profile paired with a Pixel phone; the bots claim kits (kitctl claim-next --va <name>) and the VAs create the social accounts from the packet. OneUp (oneupapp.io) schedules posts. A second kit family, 'heygen' (1-3 strong reference stills, specs under heygen-kits/), exists but is not covered by the same tooling. Video creation (Kling via Atlas/Poyo/Higgsfield, Genjutsu, HeyGen) and posting are later phases; only the Avatar Kit slice is in scope now.

## 5. Friend's reference UI (from screenshots; the operator likes this)

A local web app 'reel studio' (dark theme). Left sidebar groups: Overview (Accounts, Posts, What's working, Calendar, Money), Pipelines (HeyGen, HeyGen Bible, One-shots, Clean copies), Create (Make the video, Copy to avatars, Make new clips, Caption bank, Clip labels); footer: 'Phone alerts: Off', 'All clips are labeled', 'Main avatar: Emerson'. 'Make new clips' is a numbered step form: step 2 'Before or after' (Before/After toggle; 'Full video - moves + sound' vs 'Moves only'; '+ More options'); step 3 'Choose a model' as a grid of price cards (e.g. 'Kling 3.0 via Poyo $0.37 per clip' with badges RECOMMENDED / CHEAPEST / NOT TRIED YET / CASHBACK TILL SEP 30; 'Genjutsu 720p Higgsfield (keeps the camera + place) $3.07'); a right rail 'YOUR RUN' (Clip, Model, Length, Avatars, big price, green 'Start - $3.07' button, 'Limit per run $25', 'When clips are ready: I review / Auto-add', 'Her photo: Check it first / Straight to video', and the note 'Spends real money on the model you pick. Nothing is posted or sent to Drive. Prices are live from Atlas.'). 'Make the video' shows a clip library ('EMERSON'S CLIPS', filters All/Before/After, Any framing, Any movement, Any place) with thumbnails tagged like 'after - 4.0s - face - posing - kitchen', a vertical preview with text overlay 'Im 65', a Save panel, 'Make Emerson's video', and a multi-track timeline (clip, song, text, 'Read Caption'). Plain-English microcopy throughout.

## 6. Session deliverables

(a) A written plan for the Avatar Kits module and how it integrates into the HQ site, including an honest verdict on the Google Sheet; (b) a clickable static prototype (no build step) with sample data in the IxParacosm.github.io repo; (c) questions for the operator. Design for a solo operator who maintains everything with Claude Code and who wants 'simplicity and seamless, bulletproof systems'.

## 7. Facts learned from the operator AFTER the first proposals started (judges and synthesizer: weigh proposals against these; a proposal that invents a new backend when one already exists should lose points)

Operator's answers (verbatim, lightly trimmed):
1. "The source lives only on my Mac, in two folders, and neither is in a git repository yet. It's also not a Cloudflare Pages project. It's a Cloudflare Worker with static assets: one Worker named `jwco-hq` serves the app files and the `/api` routes. I deploy it from my machine with Wrangler. Nothing deploys automatically from git. Where things are: hq/ is the deploy project: `wrangler.jsonc` is the Worker config (the D1 database binding, the custom domain hq.jwcoconsulting.com, and the Access settings); src/index.js holds the login check and the data API; `schema.sql` is the database schema, and `build.mjs` packages the app. life-rpg/ is the front-end source (plain HTML/CSS/JS, no framework); `build.mjs` copies it into `hq/public/` when deploying; the same folder also feeds the old claude.ai version. The Business workspace you'd plug into is life-rpg/js/biz.js, and it's currently a placeholder."
2. "Just focus on the avatar kits, everything you need should be in the AgentHome folder on my desktop." (The cloud session cannot read the Mac. Transcripts of earlier Claude Code sessions that ran on the Mac ARE readable; extraction agents are reconstructing hq/ and life-rpg/ sources and the AgentHome kit scripts into scratchpad/mac-sources/ with HQ-FACTS.md, KITS-FACTS.md and HERMES-FACTS.md. If those files exist when you run, read them and treat them as the most authoritative description of the current system; they may be partial.)
3. Asked whether this session can open the Google Sheet itself: it cannot (the proxy blocks docs.google.com and no Google connector is attached). A CSV export or a Google Drive connector is needed; design the importer for CSV + later API.
4. The two Hermes VA bots run on the Mac mini and can reach the internet over HTTPS. (So the bots can call an HTTPS API directly.)
5. The operator has a Cloudflare account for jwcoconsulting.com and is fine with D1 + R2 + Access there.

Implications the final design must reflect:
- The backend ALREADY EXISTS: extend the jwco-hq Worker (same D1 database via new tables in schema.sql, new /api/kits... routes in src/index.js, the existing Access login for humans, plus bearer tokens for machine clients: the build scripts on the Mac and the two bots on the mini). Add an R2 bucket binding for kit images. Do not propose a second Worker, a second database, Supabase, or a separate auth system.
- The front end is a new workspace module inside life-rpg/ (plain HTML/CSS/JS, no framework), mounted from life-rpg/js/biz.js and following whatever router/theme life-rpg already uses; the module must not assume a build step beyond build.mjs copying files.
- Deploys happen from the Mac with Wrangler; nothing deploys from git. The IxParacosm.github.io repo is only the home for the prototype and the plan; the real code lands in hq/ and life-rpg/ on the Mac (which should be put under git, privately, without committing secrets).
- 'Adjust this process' must work with that deploy model: Claude Code runs on the Mac against hq/ + life-rpg/ (a local session or Remote Control), so the button should produce a brief the operator pastes into or launches in a Mac-side session, plus the optional claude.ai/code link once those folders are in a repo.
