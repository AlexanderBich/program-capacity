# Frontend architecture

How this codebase is organized. Follow it when adding code; if something is not covered, follow the closest rule by analogy. The rules that can be checked are enforced by ESLint and stylelint.

## Whose is it?

Before creating a file, ask one question: **whose is this?** The answer picks the folder.

- **Colocation by default.** Code lives as close as possible to what uses it.
- **Promotion only outward, and only when needed.** Born local; a second consumer moves it one layer wider. Nothing is placed "for later".
- **Where it is promoted to depends on what it knows.** Knows about a domain (programs, reservations, sessions): `domains/<name>/`. Knows about nothing: `components/`, `utils/`, `hooks/`.
- **The last step goes by neutrality, not by count.** Something two domains use but that is still about one of them stays with its owner, and the other imports it through the public door.

This trades "reuse by type" for high cohesion: changing a feature means one folder, not four.

## Structure

The top level holds architectural buckets only. Domain names do not appear there.

```
src/
├── app/          # Routes, with private _components, _constants for one page
├── domains/      # auth, program, reservation. Public API only through index.ts
├── components/   # Domain-neutral: ui/ primitives and layout/
├── api/          # All API access, by resource
├── utils/        # Pure helpers: formatAmount, parseToMinorUnits, cn
├── hooks/        # Neutral hooks: useNow, useFlashOnChange
├── constants/    # Routes, currencies
├── styles/       # tokens.css, globals, breakpoints, mixins
├── test/         # What specs share: MSW server, fixtures, render helper
└── env.ts        # Environment validated by zod: missing means it fails at startup
```

| Whose is it? | Lives in | Example |
|---|---|---|
| One page | `app/<route>/_components` | `ReservationRow`, `UtilizationChart` |
| One domain, several pages | `domains/<name>/` | `AvailabilityBar`, `ReserveForm`, the session store |
| Nobody's | `components/`, `utils/`, `hooks/` | `Button`, `Dialog`, `formatAmount` |
| Any API call, wherever it is used | `api/<resource>/` | `useProgram`, `programRoutes` |

The API layer is the one deliberate exception to colocation: "where is this request?" always has one answer.

## Anatomy of a domain

A domain is a self-contained bundle, arranged by type inside, with one door to the outside.

```
domains/program/
├── index.ts       # The public API: the only way in from outside
├── components/    # AvailabilityBar, CreateProgramForm, LiveIndicator
├── hooks/         # useLiveAvailability, useFallbackRefetchInterval
├── utils/         # utilizationPercent
├── schema.ts      # Form validation
├── store.ts       # Client state, if the domain has any
└── constants.ts
```

From outside, import `@/domains/program`, never its internals. A domain never imports through its own index. `index.ts` is the only justified barrel: it is a boundary, not a shortcut. A domain has no API module; its data comes from `@/api/<resource>`.

## API layer

```
src/api/
├── client.ts        # The axios instance: attaches the token, refreshes once on a 401
├── session.ts       # The one place the access token lives
├── errors.ts        # ApiError, and normalizing what the backend sends into it
├── query-client.ts  # Defaults: a 4xx is not retried, transient failures are
├── provider.tsx
└── program/         # A resource
    ├── routes.ts    # programRoutes.detail(id)
    ├── keys.ts      # programKeys, one createQueryKeys factory per resource
    ├── types.ts     # The contract with the backend
    └── queries/     # One query or mutation per file, fetcher and hook together
```

- **Keys are invalidated through `_def`**: `programKeys.list._def` for every list, `programKeys.detail(id).queryKey` for one.
- **A mutation owns its cache effects.** It applies the availability the server returned and invalidates the lists behind it, so a component only reacts to the outcome.

## State

| Kind | Tool | Where |
|---|---|---|
| Server state | React Query | `api/<resource>/queries` |
| What a form holds | react-hook-form with zod | `domains/<name>/schema.ts` |
| One component's state | `useState` | The component |
| Client state across pages | Zustand | `domains/<name>/store.ts` |

Server state is never mirrored into Zustand, which only holds what is purely client state: session status, stream status, toasts.

**Live data has one path into the cache.** A single stream runs in the authenticated layout and writes to React Query through `applyAvailabilityToCache`, ordered by `version`, so a stream event and a mutation response can arrive in any order without a figure moving backwards. A burst of changes refreshes the lists behind them once. While the stream is down, queries fall back to polling, and it reconnects with exponential backoff and jitter so that clients do not all return at once after an outage.

## Money

Money is never a float on its way to the screen. Amounts stay decimal strings and are formatted as strings, so figures beyond double precision stay exact. The FX preview runs the server's own calculation on integers, rounded up the same way. The only floats are the bar width and the chart, neither of them authoritative.

## Forms

- A zod schema in the domain gives UX validation. The backend stays the source of truth, and what it refuses is shown in the form.
- `Field` connects a control to its label and to its hint or error through `aria-describedby`. A control is its only child, and a button beside it goes in `action`, so it stays out of the control's name.
- **Safe to retry.** The invoice id is the idempotency key for reserving. The release form generates its repayment id once when it opens, so a double submit or a retry frees capacity once.

## Security

- **The access token stays in memory** and the refresh token in an httpOnly cookie, so nothing an XSS could read is stored. A reload restores the session through the cookie, concurrent refreshes share one request, and a refresh answering after sign-out cannot bring the session back.
- **Security headers come from `nginx.conf`** and `security-headers.inc`: a strict Content Security Policy with no inline scripts or styles, no framing, no referrer. The browser tests fail on any violation.
- **What the UI hides, the backend still refuses.** Roles in the UI are a courtesy; `useSession` only decides what to show.

## Styles

- One `.module.scss` belongs to exactly one component.
- Shared markup becomes a component, a shared recipe a mixin in `_mixins.scss`, shared values a token in `tokens.css`.
- stylelint rejects colors outside `tokens.css`.
- Breakpoints are named and used through `@include down($tablet)`. `:hover` goes through the `hover` mixin, so that it does not stick after a tap.

## Conventions

- Files are kebab-case, named after their main export. Named exports only.
- Components are function declarations, everything else arrow consts. One component per file, no `React.FC`.
- Types say their role: `ProgramRowProps`, `SessionStoreState`, `ReserveFormValue`, `CreateReservationInput`, `ReservationFilters`.
- Each page is its own chunk through the router's `lazy`, and the chart library is loaded only where it is drawn.

## Earn your existence

- No pass-through components or hooks. A wrapper exists because it adds something.
- No dead code and nothing kept "for later".
- No hidden defaults: what a call depends on is in its arguments, as `refetchIntervalMs` is.
- Configuration fails at startup, not on first use.

## Tests

| Level | Lives in | Covers |
|---|---|---|
| Unit | `*.spec.ts(x)` next to the file | Utils, schemas, stores, hooks, the API layer, components with behaviour. `*.property.spec.ts` for money |
| Integration | `<page>.integration.spec.tsx` next to the page | A page with its components, hooks and API client, only HTTP replaced by [MSW](https://mswjs.io) |
| End to end | [`../e2e`](../e2e/tests) | Main scenarios in a real browser against the whole stack |

Query by role, label and text as a user would. Any request a test did not describe fails it.

## Where does it go?

1. Only this page uses it: `app/<route>/_components`.
2. It calls the API: `api/<resource>/queries`, one per file.
3. It knows about a domain and more than one page needs it: `domains/<name>/`, exported from `index.ts`.
4. It knows nothing about any domain: `components/ui`, `components/layout`, `utils/` or `hooks/`.
5. It is a color, a size or a space: a token in `tokens.css`.
