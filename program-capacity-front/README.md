# Program Capacity Console

The live console for the [capacity service](../program-capacity-back/README.md): availability per program as it changes, reserving and releasing capacity, the audit trail, treasury reconciliations and FX rates.

How the code is organized, and why, is in [architecture.md](architecture.md): read it before changing anything.

## Stack

- **React 19**, **Vite**, **React Router**
- Server state: **TanStack Query**. Client state: **Zustand**
- Forms: **react-hook-form** with **zod**
- **SCSS Modules** with design tokens, **Recharts**, **lucide** icons
- Tests: **Vitest**, **Testing Library**, **MSW**
- Served by unprivileged **nginx** in Docker

## Run it

The backend must be running, by default on port 4000. Vite proxies `/api` to it, so the app is same-origin and the httpOnly refresh cookie works as it does in production.

```bash
cp .env.example .env && npm install && npm run dev
```

Then open http://localhost:5173. To run everything together in Docker instead, see the [project README](../README.md).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint and stylelint |
| `npm run format`, `format:check` | Prettier |
| `npm test` | Unit and page-level tests |
| `npm run test:cov` | The same, failing below the coverage thresholds |

## Environment

See [.env.example](.env.example). It is validated by zod in `src/env.ts`, so a missing value fails at startup.

## Structure

```
src/
├── app/          # Routes, with private _components for one page
├── domains/      # auth, program, reservation. Public API only through index.ts
├── components/   # Domain-neutral: ui/ primitives and layout/
├── api/          # All API access, by resource
├── utils/, hooks/, constants/, styles/, test/
└── env.ts
```
