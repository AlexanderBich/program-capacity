# Program Capacity Console

The live console for the [capacity service](../program-capacity-back/README.md): availability per program as it changes, reserving and releasing capacity, the audit trail, treasury reconciliations and FX rates.

React 19, Vite, React Router, TanStack Query, Zustand, react-hook-form with zod, SCSS Modules, Recharts, lucide icons.

## Run it

The backend must be running, by default on port 4000. Vite proxies `/api` to it, so the app is same-origin and the httpOnly refresh cookie works as it does in production.

```bash
cp .env.example .env && npm install && npm run dev
```

Then open http://localhost:5173. Checks:

```bash
npm run typecheck && npm run lint && npm test
```

## Structure

Before creating a file, ask **whose is this?** Code lives as close as possible to what uses it, and moves outward only when a second consumer appears.

```
src/
├── app/          # Routes, with private _components, _hooks, _utils for one page
├── domains/      # auth, program, reservation. Public API only through index.ts
├── components/   # Domain-neutral: ui/ primitives and layout/
├── api/          # All API access, by resource
├── utils/        # Pure helpers
├── hooks/        # Neutral hooks
├── constants/    # Routes, currencies
├── env.ts        # Environment validated by zod: missing means it fails at startup
└── styles/       # tokens.css, globals, breakpoints, mixins
```

| Whose is it? | Lives in |
|---|---|
| One page | `app/<route>/_components` |
| One domain, several pages | `domains/<name>/` |
| Nobody's | `components/`, `utils/`, `hooks/` |
| Any API call, wherever it is used | `api/<resource>/`: `routes`, `keys`, `types`, one query per file in `queries/` |

## Conventions

- Files are kebab-case, named after their main export. Named exports only. Barrels only at a domain's boundary; a domain never imports through its own index.
- Components are function declarations, everything else arrow consts. One component per file, no `React.FC`.
- Types say their role: `ProgramRowProps`, `SessionStoreState`, `ReserveFormValue`, `CreateReservationInput`, `ReservationFilters`.
- Server state lives in React Query, never mirrored into Zustand, which only holds what is purely client state: session status, stream status, toasts.
- Forms: a zod schema in the domain gives UX validation, the backend stays the source of truth.
- Styles: one `.module.scss` belongs to exactly one component. Shared markup becomes a component, a shared recipe a mixin, shared values a token. stylelint rejects colors outside `tokens.css`.
- No pass-through components or hooks, no dead code, no hidden defaults.

The rules that can be checked are enforced by ESLint and stylelint.

## Tests

| Level | Lives in | Covers |
|---|---|---|
| Unit | `*.spec.ts(x)` next to the file | Utils, schemas, stores, hooks, the API layer, components with behaviour. `*.property.spec.ts` for money |
| Integration | `<page>.integration.spec.tsx` next to the page | A page with its components, hooks and API client, only HTTP replaced by [MSW](https://mswjs.io) |
| End to end | [`../e2e`](../e2e) | Main scenarios in a real browser against the whole stack |

```bash
npm run test:cov
```

## Worth knowing

- **Money is never a float on its way to the screen.** Amounts stay decimal strings and are formatted as strings, so figures beyond double precision stay exact. The FX preview runs the server's own calculation on integers, rounded up the same way. The only floats are the bar width and the chart, neither of them authoritative.
- **Security headers come from `nginx.conf`**: a strict Content Security Policy with no inline scripts or styles, no framing, no referrer. The browser tests fail on any violation.
- **Live data has one path into the cache.** A single stream runs in the authenticated layout and writes to React Query through `applyAvailabilityToCache`, ordered by `version`, so a stream event and a mutation response can arrive in any order without a figure moving backwards. While the stream is down, queries fall back to polling, and it reconnects with exponential backoff and jitter so that clients do not all return at once after an outage.
- **Safe to retry.** The invoice id is the idempotency key for reserving. The release form generates its repayment id once when it opens, so a double submit or a retry frees capacity once.
- **The access token stays in memory** and the refresh token in an httpOnly cookie, so nothing an XSS could read is stored. A reload restores the session through the cookie, and concurrent refreshes share one request.
