# Maisons S. Turner — web app prototype

Interactive responsive prototype for the Maisons S. Turner redesign.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

## Included

- interactive model catalogue and filters
- model comparison
- project process explorer
- inclusions/responsibility matrix
- budget planner with local draft persistence
- FAQ and contact prototype
- responsive navigation
- locally bundled generated visual assets in AVIF

The browser bootstrap inflates the exact HTML/CSS/JS payload from `payload/*.gz` and injects it at startup. This keeps the committed prototype compact while preserving the complete UI implementation.

Before production, validate all business copy, inclusions, certifications, contact details, privacy/legal requirements, and connect the contact form to the real CRM/backend.
