# Cadence – AI Rules

## Tech Stack

- **Monorepo layout**: `apps/api` (Deno + Hono), `apps/web` (Astro + React), `packages/contracts` (shared TypeScript types/constants). Root task runner is `deno.json`.
- **API runtime**: Deno 2.9+, TypeScript strict mode. HTTP framework is **Hono** (`npm:hono`). No Express, Fastify, or other HTTP frameworks.
- **Database**: Node's built-in `node:sqlite` (`DatabaseSync`) — no third-party ORM or query builder. Raw SQL only. Schema migrations run inside `GenerationRepository.migrate()` using `PRAGMA user_version`.
- **Frontend framework**: **Astro 7** (static output) with the `@astrojs/react` integration. The single entry page is `apps/web/src/pages/index.astro`. All interactive UI lives in React components under `apps/web/src/ui/`.
- **React**: React 19 via pnpm inside `apps/web`. Used for all interactive components; Astro handles the static shell.
- **Styling**: Custom CSS variables + hand-written CSS in `apps/web/src/styles/global.css` and co-located `.css` files. **No Tailwind, no CSS-in-JS, no UI component library (no shadcn/ui, no MUI)**. All design tokens are CSS custom properties (`--bg`, `--accent`, `--ink`, etc.) defined in `:root` and `[data-theme="dark"]`.
- **Icons**: `lucide-react` for all icons in UI components.
- **Shared contracts**: `packages/contracts/src/index.ts` — all types, constants, and domain enums shared between API and web. Import via the `@contracts` alias. Never duplicate these types in either app.
- **Validation**: **Zod** (`npm:zod`) is available for API-side schema validation. Use it for all external-input parsing in `apps/api/src/validation.ts`. Do not add a separate validation library on the web side.
- **Testing**: **Vitest** for the web (via `deno run -A npm:vitest`); **Deno's native test runner** (`deno test`) for the API. API coverage gate is 100 % on `apps/api/src/`. Do not mix test runners between the two apps.

## Library Rules

| Need | Use | Never use |
|---|---|---|
| HTTP routing (API) | `hono` | Express, Fastify, oak, fresh |
| Database access | `node:sqlite` (raw SQL) | Drizzle, Prisma, Kysely, better-sqlite3 |
| Shared domain types | `@contracts` alias | Re-declaring in `apps/api` or `apps/web` |
| Input validation (API) | `zod` | `joi`, `yup`, `class-validator` |
| UI icons | `lucide-react` | Heroicons, FontAwesome, react-icons |
| Styling | CSS custom properties + plain CSS | Tailwind, styled-components, emotion, shadcn/ui |
| UI components | Hand-written React components | shadcn/ui, MUI, Radix primitives directly |
| Frontend build | Astro (`pnpm` inside `apps/web`) | Vite standalone, CRA, Next.js |
| Package manager (web) | `pnpm` via Corepack | npm, yarn inside `apps/web` |
| Package manager (API/root) | `deno install` | npm, pnpm at root level |

## Conventions

- All source files are TypeScript with `strict: true` and `noUncheckedIndexedAccess: true`.
- Formatting: 100-character line width, double quotes, semicolons (`deno fmt`).
- Tenant isolation is mandatory: every repository query must filter by `tenantId`. Never omit it.
- The MiniMax API key is API-only. Never reference `MINIMAX_API_KEY` in web code or return it from any endpoint.
- Audio is served same-origin via `/api/generations/:id/audio` with HTTP byte-range support. Do not serve audio files directly from the filesystem to the browser.
- New API routes go in `apps/api/src/app.ts` using Hono's route methods. Keep route handlers thin; push logic into repository/storage/provider modules.
- New web UI components go in `apps/web/src/ui/`. Co-locate component-specific CSS in a `.css` file with the same base name.
- Run `deno task verify` before considering any change complete.
