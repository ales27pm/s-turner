# Maisons S. Turner — web app

Interactive responsive application for the Maisons S. Turner redesign. The Node server is the canonical entry point: it renders the restored payload, applies the runtime completion layer, and serves the local APIs.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

### Keep the macOS preview running

For a Tailscale preview that must survive terminal and Codex sessions, install
the bundled user LaunchAgent:

```bash
npm run service:install
tailscale serve --bg 4173
```

The service binds only to `127.0.0.1`, restarts automatically, and writes its
logs under the Git-ignored `.turner-data/logs/` directory. Inspect or remove it
with:

```bash
npm run service:status
npm run service:uninstall
```

Run the static and integration checks with:

```bash
npm run check
```

The check starts an isolated server, validates the rendered scripts and HTTP behavior, exercises the budget and intake APIs, then removes its temporary intake data.

## Official content snapshot

The catalogue is generated from the public Turner model sitemap and model pages.
The checked-in snapshot keeps the application deterministic while retaining the
source URL and source modification date for every model.

```bash
npm run content:sync
npm run content:check
```

`content:sync` parses the official HTML with a structured parser, validates every
model, and writes `data/official-content.json` atomically only after a complete
crawl. It also records the official process, FAQ, module components, contact
details, privacy page, and links to the APCHQ, GCR and RBQ verification surfaces.
Descriptions in the snapshot are factual summaries generated from published
specifications rather than copied marketing paragraphs.

To inspect the runtime completion layer without the primary client bundle:

```bash
TURNER_FALLBACK_ONLY=1 PORT=4174 npm start
```

## Included

- original rich responsive layout restored
- interactive catalogue of all official model sheets with source provenance
- filters for all published types, styles and bedroom counts
- model comparison with hide/clear controls
- official five-step project process explorer
- sourced module-components and responsibility matrix
- budget planner with local draft persistence
- interactive FAQ and operational contact form
- Safari-safe server-side rendering of the original payload
- project intake API with local JSONL persistence
- server-side budget summary API
- optional CRM webhook forwarding
- functional catalogue, comparison, process and FAQ fallbacks when the original client bundle is unavailable

## Runtime API

### Health and diagnostics

```bash
curl -s http://127.0.0.1:4173/__health | python3 -m json.tool
curl -s http://127.0.0.1:4173/__baseline | python3 -m json.tool
curl -s http://127.0.0.1:4173/api/implementation-status | python3 -m json.tool
curl -s http://127.0.0.1:4173/api/official-content | python3 -m json.tool
```

### Project intake

The contact form is bridged to `POST /api/project-intake`. Valid submissions are rate-limited and written to:

```text
.turner-data/project-intake.jsonl
```

The `.turner-data/` runtime directory is ignored by Git and must remain outside versioned artifacts because it can contain contact information.

Set a custom storage directory with:

```bash
TURNER_DATA_DIR=/secure/path npm start
```

To forward accepted records to a CRM/webhook endpoint:

```bash
TURNER_CRM_WEBHOOK_URL=https://example.com/webhook npm start
```

To read the latest stored records locally through the API, set an admin token:

```bash
TURNER_ADMIN_TOKEN=change-me npm start
curl -H 'Authorization: Bearer change-me' http://127.0.0.1:4173/api/project-intake
```

### Budget summary

```bash
curl -s http://127.0.0.1:4173/api/budget/summary \
  -H 'content-type: application/json' \
  -d '{"budgetTarget":575000,"houseQuote":382000,"land":85000,"foundation":52000,"siteConnections":18000,"options":0,"other":0,"contingencyPct":8}' \
  | python3 -m json.tool
```

## Remaining production work

- Establish an owner and review cadence for the synchronized Turner content.
- Validate final business copy and the privacy/legal implementation with Turner.
- Connect the project intake webhook to the real CRM/backend before public production launch.
- Replace local JSONL storage with an approved encrypted data store and retention policy before handling production submissions.
