# SpikeParts

A manufacturing OS for robotics teams. Imports parts and assemblies live from
Onshape, auto-routes custom parts to a machine queue, tracks revisions, and
gives every machine its own queue dashboard.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Turbopack**
- **Tailwind CSS v4** + **shadcn/ui** primitives
- **Drizzle ORM** on **SQLite** (`better-sqlite3`)
- **tRPC v11** end-to-end typed APIs
- **better-auth** for sign-in / sign-up
- **Onshape REST API v6** with HMAC-signed requests

## Getting started

```bash
pnpm install
pnpm db:push           # creates ./data/spike.db with the schema
pnpm db:seed           # seeds the 9 machine queues
pnpm dev
```

Open http://localhost:3000.

## Connecting Onshape

1. Get API keys at <https://dev-portal.onshape.com/keys>. Pick scope
   `OAuth2Read` (and optionally `OAuth2ReadPII`).
2. Copy `.env.local.example` → `.env.local` and fill in:
   ```
   ONSHAPE_ACCESS_KEY=…
   ONSHAPE_SECRET_KEY=…
   ```
3. Restart `pnpm dev`. The dashboard top bar will show **Onshape connected**.
4. Go to **Onshape Import**, paste the URL of any document, Part Studio, or
   Assembly that the keys' owner can read, and pick what to import.

The signing implementation is at `src/lib/onshape/client.ts`. Thumbnails are
fetched server-side by `src/app/api/onshape/thumbnail/route.ts` so the secret
never touches the browser.

## Features

- **Part import** — name, material, mass, volume, bounding box, thumbnail
  pulled directly from Onshape
- **Assembly (BOM) sync** — flatten an Onshape assembly into a parts list,
  splitting COTS from custom
- **Auto-routing** — custom parts get a machine sequence based on material
  and geometry (waterjet for sheet aluminum, 3D printer for plastic, mill for
  small aluminum blocks, etc.)
- **Multi-step operations** — each part has an ordered list (e.g. CNC Router
  → Deburr → Tap → Anodize) with per-step status, estimate, actuals, and
  machine override
- **Revision tracking** — each microversion bump from Onshape creates a
  flagged revision and surfaces a "design changed" alert
- **Kanban** — drag cards through Needs Design → Ready → In Production → QC →
  Done → On Robot
- **Machine dashboard** — each of the 9 machines has its own page with a
  per-status column board
- **Priority flags** — Blocking / High / Normal / Low; blocking parts ring red
- **Batch grouping** — tag parts with a batch key to run them together
- **File attachments** — attach .gcode/.nc/.dxf/.svg/.stl/.step/.pdf per part
  or per step; stored as data URLs in SQLite for the demo

## Scripts

- `pnpm dev` — Next dev server
- `pnpm db:push` — apply schema to SQLite
- `pnpm db:generate` — generate migration SQL
- `pnpm db:seed` — seed the 9 shop machines
