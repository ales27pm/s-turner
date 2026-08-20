# Maisons S. Turner — web app prototype

Interactive responsive prototype for the Maisons S. Turner redesign.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

## Included

- original rich responsive layout restored
- interactive model catalogue and filters
- model comparison with hide/clear controls
- project process explorer
- inclusions/responsibility matrix
- budget planner with local draft persistence
- FAQ and contact prototype
- Safari-safe server-side rendering of the original payload
- project intake API with local JSONL persistence
- server-side budget summary API
- optional CRM webhook forwarding

## Runtime API

### Health and diagnostics

```bash
curl -s http://127.0.0.1:4173/__health | python3 -m json.tool
curl -s http://127.0.0.1:4173/__baseline | python3 -m json.tool
curl -s http://127.0.0.1:4173/api/implementation-status | python3 -m json.tool
```

### Project intake

The contact form is bridged to `POST /api/project-intake`. Valid submissions are rate-limited and written to:

```text
.turner-data/project-intake.jsonl
```

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

- Replace prototype model catalogue values with Turner-approved data.
- Validate all business copy, inclusions, certifications, contact details, privacy/legal requirements.
- Connect the project intake webhook to the real CRM/backend before public production launch.
