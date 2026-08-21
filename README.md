# Maisons S. Turner — web app

Interactive responsive application for the Maisons S. Turner redesign. The Node server is the canonical entry point: it renders the restored payload, applies the runtime completion layer, and serves the local APIs.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

Runtime configuration is validated before the server binds. Invalid ports,
hosts, webhook URLs, paths, or boolean flags stop startup with a specific error
instead of being passed through to Node:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server bind host |
| `PORT` | `4173` | Server port, from 1 to 65535 |
| `TURNER_DATA_DIR` | `.turner-data` | Private intake storage directory |
| `TURNER_ADMIN_TOKEN` | disabled | Bearer token for intake listing |
| `TURNER_CRM_WEBHOOK_URL` | disabled | Absolute HTTP(S) CRM endpoint |
| `TURNER_FALLBACK_ONLY` | `0` | Use `0`, `1`, `false`, or `true` |
| `TURNER_PUBLIC_ORIGIN` | `https://maisonsturner.ca` | Canonical origin used by SEO metadata, robots, and sitemap |
| `TURNER_INDEXABLE` | `true` | Set to `false` to emit `noindex` and block crawling on a preview host |

### Keep the macOS preview running

For a Tailscale preview that must survive terminal and Codex sessions, install
the bundled user LaunchAgent:

```bash
npm run service:install
tailscale serve --bg 4173
```

Override the LaunchAgent endpoint when installing it, then point the proxy to
the same port:

```bash
TURNER_SERVICE_HOST=127.0.0.1 \
TURNER_SERVICE_PORT=4180 \
TURNER_SERVICE_PUBLIC_ORIGIN=https://preview.example.com \
TURNER_SERVICE_INDEXABLE=false \
npm run service:install
tailscale serve --bg 4180
```

The service binds only to `127.0.0.1`, restarts automatically, and writes its
logs under the Git-ignored `.turner-data/logs/` directory. Inspect or remove it
with:

```bash
npm run service:status
npm run service:uninstall
```

The LaunchAgent does not rotate those files. Configure `newsyslog` or a log
collector before using this service as a long-lived production process.

Run the static and integration checks with:

```bash
npm run check
```

The check starts an isolated server and CRM receiver, validates the rendered
scripts and HTTP behavior, exercises the budget and intake APIs, verifies the
custom data directory and webhook payload, then removes all temporary data.

## Browser and dependency requirements

The Node-rendered application is the supported entry point and does not depend
on browser-side gzip decompression. The legacy static `bootstrap.js` path is a
compatibility scaffold; opening it directly requires a browser that implements
`DecompressionStream`. Do not deploy the standalone `index.html` as the
production entry point.

The server negotiates Brotli or Gzip for HTML, JSON, JavaScript, CSS, XML, and
other text responses. The homepage hero uses official responsive WebP sources,
and the interactive homepage catalogue renders nine cards initially with an
incremental “Afficher plus” control. The complete server-rendered catalogue and
all model links remain available at `/modeles/`; this keeps the initial DOM
small without reducing crawlable inventory. Static image assets use a 30-day
browser cache.

`cheerio` is intentionally a development dependency because it is used only by
`content:sync`. A runtime host can install with `npm ci --omit=dev`; run content
synchronization in a build or maintenance environment and deploy the validated,
checked-in snapshot.

## Search and social metadata

The server returns the complete landing page to crawlers without requiring
JavaScript. The rendered `<head>` contains a descriptive title and description,
one canonical URL, Open Graph/Twitter cards, and Schema.org graphs for the
business, website, and FAQ. `/modeles/` is a server-rendered catalogue with an
`ItemList`; each `/modeles/:id/` page has unique metadata, breadcrumbs, and a
`Product` graph generated from the synchronized model record. Favicon assets
are served locally, and catalogue or model URLs without their canonical
trailing slash redirect permanently with HTTP `308`.

`/robots.txt` and `/sitemap.xml` are generated from `TURNER_PUBLIC_ORIGIN`. Set
that variable to the exact externally reachable origin, without a path. Preview
hosts can use their preview origin for auditing. Set `TURNER_INDEXABLE=false`
when the preview should not appear in search, then switch the public origin to
`https://maisonsturner.ca` and enable indexing only at the official cutover.
The sitemap contains the homepage, catalogue, and all model pages. Unknown
paths and unknown model slugs return a real `404`, including for `HEAD` requests.

## Official content snapshot

The catalogue is generated from the public Turner model sitemap and model pages.
The checked-in snapshot keeps the application deterministic while retaining the
source URL and source modification date for every model.

```bash
npm run content:sync
npm run content:check
```

`content:sync` parses the official HTML with a structured parser, validates every
model, and writes the versioned `data/official-content.json` atomically only
after a complete crawl. Each model retains a compact factual summary for cards,
the official descriptive copy, three explained features, and the published
room dimensions grouped by level. The snapshot also records the official
process, FAQ, module components, contact details, privacy page, and links to the
APCHQ, GCR and RBQ verification surfaces.

To inspect the runtime completion layer without the primary client bundle:

```bash
TURNER_FALLBACK_ONLY=1 PORT=4174 npm start
```

## Included

- original rich responsive layout restored
- interactive catalogue of all official model sheets with source provenance
- server-rendered catalogue and individual model URLs for search crawlers
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

For a monitoring probe, require both HTTP success and the JSON health flag:

```bash
curl --fail --silent http://127.0.0.1:4173/__health | jq -e '.ok == true' >/dev/null
```

### Project intake

The contact form is bridged to `POST /api/project-intake`. Valid submissions are rate-limited and written to:

```text
.turner-data/project-intake.jsonl
```

The `.turner-data/` runtime directory is ignored by Git and must remain outside versioned artifacts because it can contain contact information.

Browser submissions must be same-origin and use `application/json`; cross-origin
browser requests are rejected. The endpoint uses no cookie or session authority,
so a CSRF token would not protect an authenticated action. The stored record
contains an IP hash and explicit privacy metadata, but never the raw IP address.

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

## Linux production example

Install the application read-only under `/opt/maisons-turner`, create a dedicated
`turner` user, keep secrets in a root-owned `/etc/maisons-turner.env`, and use a
separate writable data directory. A minimal systemd unit is:

```ini
[Unit]
Description=Maisons S. Turner web application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=turner
Group=turner
WorkingDirectory=/opt/maisons-turner
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4173
Environment=TURNER_DATA_DIR=/var/lib/maisons-turner
Environment=TURNER_PUBLIC_ORIGIN=https://maisonsturner.ca
EnvironmentFile=-/etc/maisons-turner.env
ExecStart=/usr/bin/node /opt/maisons-turner/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/maisons-turner

[Install]
WantedBy=multi-user.target
```

Terminate TLS in a maintained reverse proxy, preserve the original `Host`
header for same-origin validation, and have the monitoring system poll
`/__health`. systemd sends stdout and stderr to journald; configure retention and
alerts there or in the organization’s logging platform.

## Remaining production work

- Establish an owner and review cadence for the synchronized Turner content.
- Validate final business copy and the privacy/legal implementation with Turner.
- Connect the project intake webhook to the real CRM/backend before public production launch.
- Replace local JSONL storage with an approved encrypted data store and retention policy before handling production submissions.
- Define production metrics, centralized log retention, alert thresholds, and an incident owner.
