# Report ingestion and driver attribution: design draft v3

Status: draft for discussion · answers Performance review questions B1 (ingestion) and B2 (attribution)

> **Built so far differs from this draft (2026-11-01):** Postgres only (no MongoDB); **no built-in or platform report
> definitions and no starter templates**. Each workspace sets up its own report templates from a first upload, and a
> template controls which columns are kept, column types and roles, daily or weekly period, PDF sections, and the
> analytics computed per upload (`report_metric`). PDFs are read by layout readers (Amazon DSP Scorecard, POD Details).
> Sections 3, 3.1 (definition scoring and confidence) and the `report_definition` tables below describe the earlier
> plan; `apps/ingestion-api/README.md` describes what runs now.

## Decisions this version is built on

| Topic | Decision |
|---|---|
| Repo | pnpm + Turborepo; `apps/web` = **one TanStack Start SSR deployable**; modules in `packages/<module>` never import each other |
| Runtime | **Long-lived container** |
| Databases | **Postgres** for the platform's core records (workspaces, users, memberships, roles, roster, schedules, fleet, report metadata, driver identities). **MongoDB** for the report row data. *(This is my reading of "mongodb and postgres for everything". Correct me if Mongo should hold more than report rows.)* |
| Tenancy | **One workspace = one client.** Every backend record and query is scoped by `workspaceId`, the same as in the routes (`_shell/$workspaceId/...`) |
| Reports | Different per client; **KPIs not defined yet** |
| Implementation | **TypeScript** (chosen 2026-10-30): `apps/ingestion-api` (Hono, Drizzle, MongoDB driver), with the logic in `packages/ingestion` and `packages/db`. Docker Compose runs Postgres + MongoDB; its `app` profile also runs the API and worker. A Python/FastAPI version was built for comparison and removed. |

Design principle: **store every report row faithfully now, map it to named fields through configuration, and compute KPIs later.**

---

## 1. Packages

```
packages/
  performance/  fleet/  scheduler/            modules (never import each other)
  chat/  access/  contracts/  ui/  config/    existing shared packages
  ingestion/   NEW · report definitions, detection, mapping, raw-row storage, identities,
                     UploadHub + AttributionQueue screens, server fns, worker jobs
  db/          NEW · Postgres client + schema + migrations (RLS), Mongo client + workspace-scoped
                     collections + indexes; the only place either database is touched
```

- Route files stay thin. For example, `routes/_shell/$workspaceId/performance/reports.tsx` runs the `access` guard in `beforeLoad` and renders `<UploadHub module="performance" />` from `@platform/ingestion`. Fleet and scheduler mount the same screen and see only the report types they own.
- **Eslint boundaries:** `ingestion` and `db` never import a module. Modules import `ingestion`, `db`, `access`, `contracts`, `ui` and `chat`.
- Zod schemas for definitions, files, rows and identities live in `@platform/contracts`.

---

## 2. Upload and processing

```
Browser (UploadHub)          server fns (@platform/ingestion)             Object storage (S3/R2)   worker process (same image)
 1 createUploads(files) ────► can(user,'reports.import', ws)                 │                        │
                              PG: insert report_file (uploading)            │                        │
 ◄── presigned PUT URLs ─────                                               │                        │
 2 PUT bytes ───────────────────────────────────────────────────────────────► raw/{wsId}/{fileId}     │
 3 markUploaded() ──────────► PG: stage=uploaded; insert ingest_job      ──────────────────────────────► detect: sha256, headers →
                                                                                                         match definition, guardrails
 ◄── live status ─────────── stage = ready | needs_confirmation | unknown_report
 4 confirm() ───────────────► insert ingest_job       ─────────────────────────────────────────────────► parse → map → resolve identities
                                                                                                         → Mongo bulk upsert report_rows
                                                                                                         → PG txn: file=success + outbox event
 ◄── "312 rows · 4 need review"
```

- **One image, two processes:** the API and the worker (job loop). The same build runs both; they scale independently. Locally the worker can run inside the API process.
- **Queue: an `ingest_job` table in Postgres**, claimed with `FOR UPDATE SKIP LOCKED`. No Redis, and nothing beyond Postgres to run.
- **File bytes never pass through a server function.** They go by presigned PUT straight to object storage, and the original file is kept as immutable evidence.
- **One job per file.** One bad file never blocks the others.

### Writing across two databases (the order matters)
1. The worker bulk-upserts rows into **Mongo**, keyed by `{workspaceId, definitionKey, naturalKey}`, so the write is idempotent.
2. Then, in **one Postgres transaction**, it sets the `report_file` stage to `success` or `partial` with its counts and inserts an **outbox** event (`report.imported`).
3. If the worker dies between steps 1 and 2, the job is retried (up to 3 attempts). Step 1 re-runs harmlessly, because the upsert is idempotent.
4. A separate outbox relay publishes events only after the commit. That fixes Performance review A14: a rolled-back import can never announce itself.
5. Readers that need "settled" data filter rows to files whose stage is `success` or `partial`. In practice this means files committed in Postgres.

---

## 3. Different reports per client: definitions as configuration

**Three layers:**
1. **Raw (Mongo):** every row, with every original column under its original header. Never dropped, never changed.
2. **Mapped (Mongo, same document):** named, typed fields produced by a **versioned report definition**. Mapped fields can always be re-derived from raw.
3. **KPI (later):** formulas over mapped fields, backfillable over all history because raw is complete.

**Scopes:** a definition is either `platform` (a standard Amazon or Netradyne report shared by every client) or `workspace` (one client's variant, or a report only that client sends). Detection tries the workspace's definitions first, then the platform's.

| Situation | Behaviour |
|---|---|
| Known layout | Auto-detected by header fingerprint → mapped → saved |
| Column renamed | `column_drift` warning. An admin adds the new header as an alternative name, publishes a new definition version, and **re-maps from raw**. Nobody re-uploads. |
| New column | Kept in raw and listed as "unmapped" on the file. It can be mapped later. |
| **Report never seen before** | Stage `unknown_report`, and **the rows are still saved in raw**. An admin maps it once: name it, choose the driver-ID column, the date or week column and the fields. Future files with the same fingerprint then map automatically. |
| PDF scorecard and POD | Extracted on the server in the worker into the same raw rows-and-cells shape. The sample PDFs are text-based, so plain text extraction with `pdfjs-dist` is enough; no OCR (section 8.6). |

**Regression set:** each definition version has an anonymised sample file and its expected mapped output in `packages/ingestion/fixtures`. `turbo run test` re-checks them on every PR, and also re-runs recognition (3.1) on every fixture so a new definition can't steal another report's files.

### 3.1 How a file is recognised

Recognition reads the file's **contents**. The file name is only a weak tiebreaker, because names are often wrong: a scorecard named for NJDD/NEWSTATION contains PTLG at DNJ4.

1. **Sniff the format from the bytes, not the extension.** `%PDF` means PDF; `PK` (a zip archive) means XLSX; anything else is text. Text is decoded as UTF-8 (BOM stripped), with Windows-1252 as the fallback.
2. **Read a preview.**
   - Tables: the first 15 rows of the first sheet.
   - PDFs: the text of the first 3 pages, which needs no OCR because the files are text-based.
3. **Normalise every header cell:** lower case, `_` treated as a space, whitespace collapsed, trimmed. `Delivery Associate ` matches `delivery associate`, and `driver_transporter_id` matches `driver transporter id`.
4. **Score every active definition** (the client's own first, then the platform catalogue):
   - **Tables:** find the row, among the first 15, containing the most of the definition's *required headers*. That row becomes the header row, which handles Netradyne's preamble rows. The score is the share of required headers found.
   - **PDFs:** the share of the definition's *required phrases* found in the text, for example "dsp scorecard", "overall standing", "delivery excellence performance".
   - `confidence = 0.9 × score + 0.1 if the file name matches the definition's pattern`.
5. **Decide:**
   - ≥ 0.8 → **recognised automatically**.
   - 0.5–0.8 → the uploader **confirms** the type.
   - < 0.5 → **unknown report**: rows are saved raw and the file goes to the mapping queue (8.4).
6. **Read the context: DSP, station and period.**
   - Content first: columns such as `DSP`, `station`, `Service Area`; preamble rows *above* the header (`Fleet: PTLG`); PDF text (`PAYA at DYY6`).
   - Only scan rows above the header row for preamble. A data cell lower down can look like `Fleet …` and give a false match.
   - The file name only as a fallback.
   - The guardrails (duplicate, foreign DSP or station, period mismatch) then run on this context.

**Choosing required headers.** Pick 4–5 headers that are distinctive for that report *and* present in every known variant. Safety Dashboard and Quality Overview both start with `Date, Delivery Associate, Transporter ID`; they are told apart by `On-Road Safety Score Tier`/`FICO` versus `Routes Completed`/`DSB Count`. Columns that only some variants have (`Impacts CDF`, `Delivery Completion DPMO Tier`) are never required. For a client's own report, the mapping screen (8.4) proposes the required headers automatically from the sample.

**Tested on the 29 sample files** (now implemented in `apps/ingestion-api`):

| Result | Count |
|---|---|
| Recognised automatically, confidence 1.00 | **29 of 29** |
| Closest wrong report (runner-up score) | 0.54 at most: the W1 driver overview against D4 Quality, which share a few headers |
| Header row found below a preamble | 4 files: Netradyne alerts at row 5, Netradyne driver summary at rows 10–11 |
| Context read from content rather than the name | the mis-named scorecard → PTLG/DNJ4; the escalations file → OTAD/DAT9, which the foreign-DSP guardrail would stop |
| Exact duplicate caught | 1 (the PAYA daily feedback file) |

The gap between 1.00 for the right report and at most 0.54 for the next-best leaves a wide margin, so the 0.8 auto-accept threshold is safe on these samples.

**What recognition alone can't do** (handled by the steps after it):
- **Week files of the same report:** D7 daily and D7 weekly have nearly the same columns. They are one definition; the period comes from the content (delivery dates or the week column), not from the type.
- **Station for D4B and D7:** these files carry no DSP or station inside, and recognition gets the station from the file name only. If a client has several stations, the uploader confirms the station when the name gives none.

### 3.2 How columns are mapped once the report is known

Mapping has two steps. The first runs **once per file** and decides which column feeds each field. The second runs **once per row** and turns text into typed values.

**What a definition says about each field**

```ts
field('rtsPackages', {
  headers: ['Packages Returned to Station (RTS) - Unadjusted'],   // name + synonyms, normalised
  type: 'int',                                                    // shared value parser (below)
  required: false,                                                // missing → null, not an error
  position: 7,                                                    // fallback ONLY over a broken header
  identity: undefined,                                            // or 'amazon_transporter' | 'netradyne' | 'name' | 'employee_id' …
})
field('timestamp', { pattern: /^timestamp\((\w+)\)$/, type: 'datetime', required: true })  // captures the timezone
```

**Step 1: the column plan (once per file).** For each field, try these in order:
1. **Header name or synonym:** an exact match after normalising (lower case, trimmed, `_` = space).
2. **Header pattern:** a regular expression that can also capture metadata from the header. `Timestamp(EDT)` gives the field plus the timezone `EDT`.
3. **Position, only if the header at that position is known garbage** (`undefined`, `undefined %`). This handles Amazon's broken export without the risk of position-mapping a correctly named but reordered file.
4. **Not found:**
   - A **required** field raises `column_drift` naming the field; the file goes to the uploader as partial and is flagged for ops.
   - An **optional** field is null and listed on the file as "not in this variant".

Columns that no field claims are **unmapped**. They stay in `raw` and are listed on the file. The plan (field → column and how it matched) is stored on `report_file.column_plan`, so anyone can see why a value landed where it did.

**Step 2: each row.**
- **Null tokens:** `''`, `NA`, `N/A`, `-`, `null` become null and never 0 (the PRD's "null never scores zero" rule).
- **Parse by type.** A value that fails sets **that one field** to null and records an issue on the row (`not a percent: 'abc'`). The row is still saved.
- **Required value missing on a row:** an issue, and the row is held from KPIs but kept in raw.
- **Identity:** the first strong identifier the definition marks (transporter ID, Netradyne ID, employee ID); otherwise the driver name. That goes to the identity resolution in section 5.
- **Natural key:** built from the mapped fields the definition lists. A repeat within the same file is flagged; across files, it's an upsert.
- `raw` (every original column) and `fields` (mapped values) are saved together in the same Mongo document.

**Shared value parsers.** These are written once in `packages/ingestion` and reused by every definition, including client-made ones:

| Type | Accepts (from the samples) | Produces |
|---|---|---|
| `id` | ` a1b49aojpauvva ` | `A1B49AOJPAUVVA` (trimmed, upper case) |
| `int`, `decimal` | `232`, `1,915.7` | numbers |
| `percent` | `99.46%`, `100.0%`, `99.9` | `99.46`; rejects anything outside 0–100 rather than clamping |
| `week` | `2026-W26`, `-2026-W27` | `{year: 2026, week: 26}` |
| `datetime` | `2026-06-29 14:24:00.667`, `2026-07-01` + timezone from the header | an ISO timestamp |
| `yn` | `Y` / `N` | boolean |
| `flag` | `0` / `1` | boolean |
| `text` | anything | trimmed text |

**PDFs need one extra step.** A PDF has no header row, so each PDF report has a small **extractor written in code** that turns the page text into rows and headers. After that, the same mapping applies.
- **POD details (W3):** each DA line is `<name> <transporter id> <13 numbers>`. The extractor splits off the 13 numbers from the right, finds the transporter ID before them, and treats the rest as the name, producing rows under fixed header names.
- **DSP Scorecard (W2):** summary lines follow `<metric> <value> [unit] | <tier>`, for example `Seatbelt-Off Rate 3.1 events per 100 trips | Fantastic`. The DA grid on pages 4–7 becomes per-driver rows.
- Extractors change only when Amazon changes the PDF layout. They are covered by the PDF fixtures.

**Changing a mapping later never needs a re-upload.** When a definition gets a new version (a new synonym, a newly mapped column), a `remap(fileId)` job reads the stored `raw` documents from Mongo, builds a new plan from the stored headers, and rewrites `fields`. For PDFs, it re-runs the extractor on the stored original file.

**Tested on 7 sample files** (now implemented in `apps/ingestion-api`):

| File | Result |
|---|---|
| D4B PTLG (headers `undefined`) | 10/10 fields mapped; the 3 RTS fields came **by position over the broken headers**; 0 value issues |
| D4B PAYA (proper headers) | 10/10 fields mapped by header; the same definition handled both variants |
| D7 daily | 13 fields; `impactsCdf` reported as not in this variant |
| D7 weekly W24 | 13 fields; `scorecardWeek` reported as not in this variant; `Impacts CDF` read as `true` |
| D1 Netradyne alerts | Header found at row 5; timezone `EDT` captured from `Timestamp(EDT)`; 4 unmapped columns kept (S.No, start/end coordinates, driving conditions); the composite key (VIN + time + type) had **0 duplicates across 106 alerts**, while `Alert Id` was `0` on every row and `Driver Id` was always empty |
| W1 W24 and W26 | `dcDpmoTier` missing in W24 and present in W26, with no error either way; 41–43 per-metric columns kept unmapped in raw until KPIs are defined |

Across the 7 files: no file had a missing required field, no row had a value that failed to parse, and no natural key repeated within a file.

---

## 4. What is stored where

### Postgres (relational core, with RLS on `workspace_id`)

```sql
create table report_definition (
  id uuid primary key,
  key text not null,                    -- 'amazon.da_weekly_overview'
  version int not null,
  scope text not null check (scope in ('platform','workspace')),
  workspace_id uuid references workspace,          -- null when scope = platform
  name text not null,
  owning_module text not null,          -- performance | fleet | scheduler
  formats text[] not null, cadence text not null, publish_weekday int, lag_days int,
  fingerprint jsonb not null,           -- {requiredHeaders[], sheetName?, fileNameRegex?}
  identity_columns jsonb not null,      -- {transporterId?, netradyneId?, name?}  (header names)
  period jsonb not null,                -- {kind:'date'|'week', header?, chosenAtImport?}
  fields jsonb not null,                -- [{key, headers[], type, required, max?}]
  natural_key text[] not null,          -- e.g. {identity, period}
  status text not null default 'draft', -- draft | active | retired
  created_by uuid not null, created_at timestamptz not null default now(),
  unique (key, version, workspace_id)
);

create table report_file (              -- the PRD's "batch"
  id uuid primary key, workspace_id uuid not null references workspace,
  module text not null, definition_id uuid references report_definition,
  storage_key text not null, file_name text not null, format text not null,
  byte_size int not null, sha256 text,
  stage text not null,                  -- uploading|uploaded|detecting|needs_confirmation|unknown_report|
                                        -- processing|success|partial|failed|superseded
  detection jsonb, warnings jsonb not null default '[]',
  period_start date, period_end date, scorecard_year int, scorecard_week int, reference_date date,
  counts jsonb,                         -- {rows, mapped, created, updated, needsReview, unmappedColumns[]}
  uploaded_by uuid not null, on_behalf_of uuid, confirmed_by uuid, override_reason text,
  superseded_by uuid references report_file,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on report_file (workspace_id, sha256) where stage <> 'superseded';
create index on report_file (workspace_id, definition_id, reference_date) where stage <> 'superseded';

create table outbox_event (
  id bigserial primary key, workspace_id uuid not null, type text not null,
  payload jsonb not null, created_at timestamptz not null default now(), published_at timestamptz
);
```

Driver identities are also in Postgres (section 5), because they link to `person`, which is in Postgres.

### MongoDB (high-volume, schema-flexible report data)

```ts
// report_rows: one document per source row. Simplified here; the full envelope
// (grain, normalised period, canonical measures `m`) is in section 6.2.
{
  _id, workspaceId: 'uuid',               // same UUID as Postgres
  definitionKey: 'amazon.da_weekly_overview', definitionVersion: 3,
  fileId: 'uuid',                         // report_file.id in Postgres
  rowIndex: 17,
  naturalKey: 'A2H3K…|2026-W43',
  period: { date?: Date, year?: 2026, week?: 43 },
  identityId: 'uuid' | null,              // driver_identity.id in Postgres
  raw:    { 'Transporter ID': 'A2H3K…', 'DA Name': 'Garcia, Maria', 'Delivered': '212', 'New Col': 'x' },
  fields: { transporterId: 'A2H3K…', deliveredPackages: 212, dcrPct: 99.1 },
  issues: [{ code: 'invalid_value', field: 'dcrPct', message: '…' }]
}
```

Indexes (every one starts with `workspaceId`):
- `{workspaceId, definitionKey, naturalKey}` **unique**, for the upsert.
- `{workspaceId, identityId, 'period.date'}` for a driver's history.
- `{workspaceId, fileId}` for "rows of this file" and re-mapping.

**Tenant isolation in Mongo:** Mongo has no row-level security, so all access goes through `forWorkspace(ctx).reportRows`, which always adds `workspaceId`. Direct `db.collection()` calls outside `packages/db` are banned by lint, and a test asserts that every index starts with `workspaceId`.

**References across the two databases:** Mongo rows hold Postgres UUIDs (`workspaceId`, `fileId`, `identityId`). There are no foreign keys across databases. Integrity relies on the write order in section 2, plus a nightly check that reports orphaned rows.

---

## 5. Drivers in reports who aren't in the system (B2)

A report names a driver by transporter ID, Netradyne ID or a free-text name, and the client's roster may not have them yet. **Report rows point at an identity, never directly at a person.**

```sql
create table driver_identity (
  id uuid primary key, workspace_id uuid not null references workspace,
  source text not null,                 -- amazon_transporter | netradyne | name | employee_id | email | phone | custom:<key>
                                        -- (non-Amazon definitions declare which kind their driver column is; see section 8)
  external_key text not null,           -- transporter id | netradyne hash | normalised name | employee id | …
  display_name text,                    -- most frequent non-empty name seen
  status text not null default 'unresolved' check (status in ('unresolved','linked','ignored')),
  person_id uuid references person,     -- set when linked to a roster driver
  match_method text,                    -- exact_id | fuzzy_auto | manual | created_from_report
  match_confidence numeric(3,2),
  ignore_scope text,                    -- pending_only | always
  hints jsonb,                          -- {stationCode, phone, email} seen in reports → prefill "Add driver"
  first_file_id uuid references report_file, last_seen_at timestamptz, seen_count int not null default 0,
  unique (workspace_id, source, external_key)
);
create index on driver_identity (workspace_id, status) where status = 'unresolved';
create index on driver_identity using gin (display_name gin_trgm_ops);   -- fuzzy name suggestions

create table identity_event (           -- audit trail of every decision
  id uuid primary key, workspace_id uuid not null, identity_id uuid not null references driver_identity,
  action text not null,                 -- auto_linked | linked | unlinked | created_person | ignored
  person_id uuid, actor_id uuid, confidence numeric(3,2), at timestamptz not null default now()
);
```

**Behaviour:**
1. **Import:** find or create the identity by `(source, external_key)`.
   - If the identity is already linked, the row is attributed.
   - Otherwise try an exact transporter-ID match on `person`, then fuzzy name matching with `pg_trgm`. A fuzzy match is auto-linked only at ≥ 0.85 **and only when exactly one person matches**.
   - If nothing matches, the identity stays `unresolved` and **the row is still saved in Mongo** with that `identityId`.
2. **The attribution queue** is `driver_identity where status = 'unresolved'`, ordered by `seen_count`, with live name suggestions against the current roster.
3. **Link** sets `person_id` and writes an event. **No Mongo document changes.** Every past and future row resolves through `identityId → person_id`. This is why the indirection matters when the data sits in two databases: linking a driver never rewrites thousands of report rows.
4. **Add driver** creates the `person` from `display_name` and `hints`, then links the identity.
5. **Ignore:** `pending_only` lets the identity come back with the next upload; `always` suppresses it permanently, for example a rescue driver from another DSP.
6. **"Not added"** on the roster, drill or watchlist means an identity with no `person_id`: an Add button, no Coach or Message actions.

There are no fake "provisional person" records, so scheduler, fleet and headcount never see unconfirmed drivers. **This needs product sign-off**, because it changes how F-PERF-3.6 stores these drivers. Users see the same behaviour.

---

## 6. Storing mapped data so any KPI can be computed later

The KPIs aren't known yet, so the stored data must not be shaped for particular KPIs. Every row is stored the same way, whatever report it came from, so that a KPI defined later is only a query. This is implemented and tested in `apps/ingestion-api`.

### 6.1 Four rules that make later KPIs possible

1. **Every row gets the same envelope.** Whatever the report, a `report_rows` document has the same top-level shape: workspace, report, file, **grain**, **period**, station, **identity**, **measures**, plus the report-specific `fields` and the untouched `raw`.
2. **Every row gets a normalised period:** the day when the report has one, and **always the Amazon week** (Sunday–Saturday; week 1 holds 1 January), computed at ingest. A daily report and a weekly report therefore roll up to the same week without any date maths at query time.
3. **Numbers KPIs need go into canonical measures, not report-specific names.**
   - Daily Quality's `Packages Delivered` and the Associates export's `Delivered Packages` both become `m.packages.delivered`.
   - The **measure dictionary** (Postgres `measure_definition`: key, unit, how it rolls up) is the vocabulary KPIs are written in.
   - A client's custom report maps to the same measures on the mapping screen, so KPIs work for non-Amazon clients unchanged.
4. **The grain is explicit:**
   - `event`: one package, alert or feedback
   - `driver_day`
   - `driver_week`
   - `unmapped`: raw only

   A KPI states which grain and which reports it reads. That is how it avoids double counting the same measure from two reports.

### 6.2 The stored document (real output)

```json
{
  "workspaceId": "ptlg", "definitionKey": "amazon.quality_overview", "definitionVersion": 1,
  "fileId": "2abb…", "rowIndex": 1,
  "grain": "driver_day",
  "naturalKey": "\"A2CSTAI14M2JZO\"|\"2026-07-01\"",
  "period":   { "date": "2026-07-01", "year": 2026, "week": 27, "weekStart": "2026-06-28" },
  "station":  "DNJ4",
  "identityId": "78e1…",                       // driver_identity.id in Postgres; person comes through it
  "m":       { "packages": { "delivered": 195 }, "rts": { "da_controllable": 1 }, "pod": { "rate": 100.0 } },
  "fields":  { "date": "2026-07-01", "driverName": "Izabella Azucena Lopez", "transporterId": "A2CSTAI14M2JZO",
               "packagesDelivered": 195, "routesCompleted": null, "rtsDaControllable": 1, "pod": 100.0, "dsbCount": null },
  "raw":     { "Date": "2026-07-01", "Delivery Associate ": "Izabella Azucena Lopez", "POD": "100.00%", "…": "…" },
  "issues":  [],
  "ingestedAt": "2026-10-30T15:37:49Z"
}
```

- **Measures are nested** (`m.packages.delivered`, not a field named `"packages.delivered"`). MongoDB can't query field names that contain a dot, and nesting makes the dictionary key the query path.
- **Empty stays empty:** `routesCompleted: null` is stored as null and has no measure. A KPI never sees a false zero.

**Indexes** for KPI queries: `{workspaceId, grain, period.year, period.week, identityId}` and `{workspaceId, identityId, period.date}`.

### 6.3 A KPI is a definition, not code

```ts
{ key: 'rts_controllable_dpmo', by: 'workspace',          // or 'driver'
  kind: 'ratio', num: 'rts.da_controllable', den: 'packages.delivered', scale: 1_000_000,
  sources: ['amazon.quality_overview'] }                   // which reports; prevents double counting
```

Three kinds cover everything seen so far:
- **`sum`:** counts and totals.
- **`ratio`:** always the **ratio of sums**, never an average of per-driver ratios. This is how Amazon computes DPMO.
- **`wmean`:** a weighted mean, for example POD weighted by packages delivered. Rows with no value are excluded, so they don't dilute it.

Each definition compiles to one MongoDB aggregation (`$match` → `$group` by workspace, week and optionally identity → `$project`). `GET /kpis` returns each KPI with its generated pipeline.

### 6.4 Results are saved, not recomputed on every page load

The worker computes KPIs after each successful import (the `report.imported` outbox event) and upserts them into a `kpi_values` collection:

```json
{ "workspaceId": "paya", "kpiKey": "rts_controllable_dpmo", "kpiVersion": 1, "scope": "workspace",
  "subjectId": "paya", "period": { "year": 2026, "week": 27 },
  "value": 5076.14, "inputs": { "num": 68, "den": 13396, "rows": 61 }, "computedAt": "2026-10-30T15:40:59Z" }
```

- Screens, alerts and recipes read `kpi_values`. That's one small document per KPI, subject and week, instead of scanning rows.
- Storing `inputs` (numerator, denominator, row count) lets a screen explain a number and lets a drill go back to the rows.
- Changing a KPI definition (a new `kpiVersion`) recomputes from `report_rows`. Nothing needs to be re-uploaded.
- Identity is resolved at **read** time (`identityId → person_id` in Postgres). Linking a driver later moves all their KPI values to them with no recompute.

### 6.5 Example KPIs computed from the 29 samples
These are illustrations; the real KPIs are still to be defined.

| KPI (example) | Result |
|---|---|
| DA-controllable RTS per million delivered, week 27 | PAYA **5,076** (68 / 13,396), PTLG **3,803** (48 / 12,623) |
| POD rate, package-weighted, week 27 | PAYA 99.8, PTLG 99.4 |
| Packages delivered, negative feedback, severe Netradyne alerts, RTS impacting DC | per driver per week, ranked |
| Week check: computed Amazon week vs the files' own week columns | **0 mismatches** |

### 6.6 What processing the samples found in the data (now reflected in the definitions)

1. **The D4B "DSP_Associates_Concessions" export is a single day, not a week.**
   - Its packages equal exactly one day of the daily Quality report for all 58 PTLG drivers (1 July), and for 58 of 61 PAYA drivers.
   - Keyed by driver + week, as I first defined it, each day's upload would **overwrite the day before**.
   - It is now keyed by driver + **report date**, with the date chosen at upload as the PRD says. Without a date the rows are kept but excluded from KPIs, and the file shows "pick the report date".
2. **One package can be returned twice.** In the PTLG RTS file, one tracking ID appears on two rows, for two drivers on two days, and only one of them impacts DC DPMO.
   - The PRD's "one per company and tracking id" key would silently drop one driver's return.
   - The key is now tracking ID + planned date + driver.
   - Any two rows of one file that share a key are now **flagged and both kept**, never overwritten.
3. **The same measure comes from several reports.** `packages.delivered` exists in D4, D4B and W1. Every KPI must name its source reports, or totals double.

---

## 7. Still open

1. **Roster owner:** which package owns `person` and drivers? `ingestion` needs to read it for matching. Is there a `workforce` or `people` package, or does it sit in the shell?
2. **Who maps a new client report:** see section 8.4. My recommendation is LMDmax staff first, client admins later. Please confirm.
3. **Raw file retention:** how long do we keep original uploads?
4. **ORM for Postgres:** Drizzle (my recommendation: lighter, good with RLS and raw SQL) or Prisma? For Mongo: the official driver plus Zod, or Mongoose?
5. **Mongo scope:** report rows only (as assumed here), or also chat messages and other high-volume data?
6. **Non-Amazon clients:** no sample files exist yet (confirmed 2026-10-30). The non-Amazon path is therefore designed generically and **unvalidated**:
   - The mapping screen (8.4) and the extensible identity sources (section 5) assume nothing about a non-Amazon layout.
   - Build and test them with Amazon files treated as "unknown". For example, map the D8 concessions file from scratch, as if no platform definition existed, and check that the result matches the platform definition.
   - Add one or two synthetic non-Amazon fixtures to test the other identifier kinds: an employee-ID file and an email file.
   - Treat the first real non-Amazon client's onboarding as the validation step, and budget time to adjust the mapping screen afterwards.
7. **The missing Amazon reports:** samples of Engine-Off Compliance (D6), Safety Dashboard event detail (D11) and Parking Procedure Score (W7) are still needed. The Fleet reports D9, D10 and F1 are also missing, if fleet is in scope.
8. ~~**D4B vs W6**~~ **Answered by the data (6.6):** "DSP_Associates_Concessions" is the **daily** D4B export. Its numbers match one day of the Quality report. Whether a separate weekly W6 summary exists is still unknown; no sample of one was found.

---

## 8. Client onboarding: which reports a client uploads

### 8.1 Approach: the client declares what they send, but upload accepts anything
- A **workspace report list** records what each client is **expected** to send. It drives the "this week: 5 of 7 received" checklist and the missing-report alerts (F-PERF-1.6).
- It does **not** limit what the client may upload. There's one drop zone, and the system identifies each file from its content.
- A file that isn't on the list is still accepted:
  - **The platform already knows it:** the client is asked "Start tracking this report?".
  - **Nobody has seen it before:** the rows are saved raw and the file goes to the mapping queue.

### 8.2 Two kinds of client

| | Amazon DSP | Non-Amazon client |
|---|---|---|
| Starting list | Pre-ticked from the **platform Amazon catalogue** (8.5). They untick what they don't receive. | **Empty.** It's built from sample uploads. |
| Onboarding step | Confirm the checklist; optionally upload one sample of each to verify | **Upload one sample of every report they send.** Each goes to the mapping queue and becomes a *workspace* definition. |
| Driver identifier | Transporter ID (Amazon), Netradyne hash or name (Netradyne) | Whatever their files carry: employee ID, email, phone or name. The definition declares it. |
| Typical effort | Minutes | One mapping session per report type, then automatic |

Store the kind on the workspace (`workspace.client_kind = 'amazon_dsp' | 'other'`). It only selects the onboarding path and the default checklist; everything after that is the same pipeline.

### 8.3 Schema

```sql
create table workspace_report (           -- what this client is expected to send
  workspace_id   uuid not null references workspace,
  definition_key text not null,           -- platform key (amazon.quality_overview) or workspace key (ws.<id>.fuel_log)
  enabled        boolean not null default true,
  expected_cadence text,                  -- overrides the definition's cadence if this client differs
  added_via      text not null,           -- onboarding_checklist | sample_upload | detected_on_upload | custom_mapping
  added_by uuid, added_at timestamptz not null default now(),
  primary key (workspace_id, definition_key)
);
alter table workspace add column client_kind text not null default 'amazon_dsp';
```

### 8.4 The mapping screen (`_shell/admin/report-mapping`)

**Who maps:** I recommend **LMDmax staff only** at first. Non-Amazon clients make this a regular onboarding task, so it needs a proper screen from day one, but clients never have to understand mapping. Opening it to client admins later is just a permission in `packages/access` (`reports.define`).

**Steps for one unknown file:**
1. **Preview:** the first 20 rows, with the detected header row highlighted. Preamble rows above the header, such as "Fleet: PTLG" or "Duration: …", are shown separately and can be captured as file-level context.
2. **Name it:** report name, owning module (performance, fleet or scheduler), cadence, scope (just this client, or the platform catalogue).
3. **Driver column:** which column identifies the driver and what kind it is (transporter ID, employee ID, email, phone, name). Package-level reports may have none.
4. **Period:** a date column, a week column, or "picked at upload" for files without one.
5. **Fields:** for each column, keep it raw-only (the default) or map it to a named, typed field (int, decimal, percent, date, boolean, text).
6. **Uniqueness:** which fields make a row unique. The screen suggests a key and warns when the sample has duplicates under it.
7. **Test, then activate:** the definition runs against the sample and shows the mapped rows and issues. On **Activate**:
   - it becomes `active` and is added to the client's `workspace_report`;
   - the waiting file is processed;
   - the fingerprint is generated from the headers, so later files with the same columns map automatically.

**What the client sees meanwhile:** "We received *Fuel_Log_Oct.xlsx*. Our team is setting it up; your data is saved." Nothing is lost while the file waits.

### 8.5 Platform Amazon catalogue, from the sample files

Built from the 29 sample files in `Downloads/DSP Reports` (two clients: PTLG at DNJ4 and PAYA at DYY6):

| PRD code | Report (file name pattern) | Format | Driver key in file | Notes from the samples |
|---|---|---|---|---|
| D1 | Netradyne alerts: `All Alerts Report( <Mon DD YYYY> ).xlsx` | xlsx | **Name only** (Driver Id is blank) | 4 preamble rows (generated time, `Fleet: PTLG`, date). **Alert Id is `0` on every row.** Timezone is in the header: `Timestamp(EDT)` |
| D2 | Netradyne driver summary: `Drivers-Report(<Mon-DD-YYYY>).csv` | csv | Netradyne hash + name | About 9 preamble rows (Fleet Name, Duration, Risk Level, filters, Total Events); `NA` values |
| D3 | `Safety_Dashboard_<DSP>_<STN>_<date>.csv` | csv | Transporter ID | The header has a trailing space (`Delivery Associate `) |
| D4 | `Quality_Overview_<DSP>_<STN>_<date>.csv` | csv | Transporter ID | POD comes as text, for example `99.46%` |
| D4B | `DSP_Associates_Concessions_<STN>_ - <timestamp>.csv` | csv | Transporter ID ("Delivery Associate ID") | **One day of data despite the Week column** (6.6); the report date is picked at upload. Week is `-2026-W27` with a leading dash. **The PTLG copy has headers `undefined`, `undefined %`, `undefined`**, which is an Amazon export bug; the PAYA copy has the real names. |
| D5 | `Quality_RTS_<DSP>_<STN>_<date>.csv` | csv | Transporter ID | One row per returned package. **A tracking ID can repeat** (the same package returned by two drivers on two days), so the key is tracking ID + planned date + driver |
| D7 | `DSP_Customer_Delivery_Feedback_negative_<STN>_<date or week>.csv` | csv | Transporter ID | **Three column variants:** daily has `Scorecard Reporting week`; weekly W26 lacks it; weekly W24 adds `Impacts CDF` |
| D8 | `DSP_Delivery_Concessions_<STN>_.csv` | csv | Transporter ID | Has `DSP` and `Service Area` columns, so the foreign-DSP check can use content |
| F2 (Fleet) | `Trip_Level_Table_<DSP>_<STN>_<date>.csv` | csv | Transporter ID | Working-device trips; VIN, device and vehicle |
| W1 | `DSP_Overview_Dashboard_<DSP>_<STN>_<YYYY-Www>.csv` | csv | Transporter ID | **Columns differ by week:** W24 lacks the DC DPMO tier, score and weight columns, while W26 has them. Amazon provides **every metric's tier, score and the weight applied**. |
| W2 | `US_<DSP>_<STN>_Week<N>_<YYYY>_en_DSPScorecard.pdf` | pdf (9 pages) | Transporter ID (DA grid pages 4–7) | Text PDF, no OCR needed. Page 3 lines look like `Seatbelt-Off Rate 3.1 events per 100 trips \| Fantastic`; Appendix A weights are on pages 8–9. **One file's name says NJDD/NEWSTATION, but its content is PTLG at DNJ4.** |
| W3 | `US-<DSP>-<STN>-Week<N>-<YYYY>NA-DA-POD-Details.pdf` | pdf (8 pages) | Transporter ID | Text PDF: a summary page, then rows of `Name TransporterID` plus 13 numbers |
| W4 | `US_<DSP>_<STN>_WEEK<N>_<YYYY>_tenure_workforce_das_Report.csv` | csv | Transporter ID | Shorter names than other reports ("Matthew Nunez" vs "Matthew Edward Nunez") |
| W5 | `US_<DSP>_<STN>_WEEK<N>_<YYYY>_Escalations_(Infractions)_Report.csv` | csv | Transporter ID | snake_case headers; UTF-8 without a byte-order mark, and contains curly quotes (’) |

**Not in the samples** (needed to complete the catalogue): D6 Engine-Off Compliance, D11 Safety Dashboard event detail and W7 Parking Procedure Score; plus the Fleet reports D9 DVIC, D10 Device Health and F1 Fleet Rotation.

### 8.6 What the samples change in this design

1. **The same report arrives with different columns** (W1, D7, D4B across clients and weeks).
   - Fingerprints match on a **required subset** of headers, never the exact header set.
   - Every other field is optional.
   - A definition can have several **variants** under one key.
2. **Headers need normalising before matching:** trim spaces, collapse line breaks, ignore case, and treat `snake_case` and `Title Case` as equal.
   - Amazon's `undefined` headers need a **positional fallback** on that variant ("column 8 = RTS packages").
3. **Header-row detection:** both Netradyne files have preamble rows. Detect the header as the first row in the top 15 that contains the definition's required headers, and keep the preamble as file context (fleet name, duration).
4. **Encoding:** every CSV sample decoded as UTF-8, some with a byte-order mark (BOM) and some without. Strip the BOM, try UTF-8 and fall back to Windows-1252, so a file re-saved in Excel on Windows still reads correctly.
5. **Value parsers** shared across definitions:
   - percent text (`99.46%`)
   - week formats (`2026-W26`, `-2026-W27`, a bare `27` plus a year column)
   - `NA` and blank as null
   - timestamps with milliseconds
   - a timezone taken from a header (`Timestamp(EDT)`)
6. **IDs inside files are not reliable:**
   - Netradyne `Alert Id` is `0` on every row, so the PRD's "one per company and alert id" rule would **merge every alert into one**.
   - The D1 natural key must be a composite: VIN + timestamp + alert type.
   - D1 has no driver ID, so Netradyne alerts are matched **by name only**. This is where the identity layer (section 5) earns its keep.
7. **File names can't be trusted:**
   - A scorecard named for NJDD/NEWSTATION contains PTLG at DNJ4.
   - The PTLG weekly folder also holds an OTAD/DAT9 escalations file.
   - Detection reads DSP and station **from content first**. The foreign-DSP guardrail is essential, not optional.
8. **Exact duplicates happen.** The PAYA daily folder has the same feedback file twice. The SHA-256 duplicate check catches this.
9. **PDFs are text-based.** Plain server-side text extraction (`pdfjs-dist`) is enough; no OCR or third-party converter is needed. This settles the PDF-extraction question.
10. **Amazon already gives each driver's per-metric score, tier and applied weights** (W1), and prints the company's overall score on the scorecard (`70.4 | Great`). **Store Amazon's numbers; don't recompute them.** Recomputing is needed only for the mid-week prediction, so the scoring-engine questions (Performance B3) matter less.
11. **Amazon republishes scorecards** "six weeks after the original publication date" when disputes are approved (scorecard page 2). Re-import and supersession (F-PERF-1.4) is a real, recurring case, not an edge case.
12. **Names differ between reports** for the same driver: different case, middle names dropped, run-together ("MariottiJr"). Use the transporter ID wherever a report has one; name matching is only for Netradyne.
