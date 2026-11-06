# Gadaa Betting 🇪🇹

## Live demo

**[https://gadaabettingsystem.vercel.app/](https://gadaabettingsystem.vercel.app/)**

Demo player login (fake money, simulated matches and payments):

- Phone: `+251911000001`
- Password: `Test@1234`

> This is a demo. No real money is used. Matches, odds and payments are simulated.


A production-grade sports betting platform for the Ethiopian market: live odds,
single/multi/system bets, Chapa payments (telebirr / CBE Birr / banks), a
double-entry wallet, an automated settlement engine and a full admin panel.

Green & gold, mobile-first, English / Amharic / Afaan Oromo, dark mode, 18+.

## Quick start (sandbox / local)

```bash
cp .env.example .env          # fill values (test mode works out of the box)
bun install
bun run db:push               # create schema
bun prisma/seed.ts            # settings, staff, demo player, 14d report history
bun run dev                   # Next.js on :3000 (boots the background worker)
cd mini-services/realtime && bun run dev   # realtime hub on :3003
```

Demo accounts (from the seed):

| Role        | Phone         | Password      |
| ----------- | ------------- | ------------- |
| Super Admin | +251911000000 | (private)    |
| Finance     | +251911000002 | (private)  |
| Support     | +251911000003 | (private)  |
| Player      | +251911000001 | Test@1234 (500 ETB) |

Deposits run through a simulated Chapa checkout (test mode) — complete it and
the wallet is credited via the exact verify → idempotent-credit pipeline a
real callback would use (welcome bonus included on the first deposit).

## Architecture

```
src/
  app/
    page.tsx                # single-route SPA shell (all views switch client-side)
    api/                    # ~30 REST route handlers (auth, kyc, wallet, deposits,
                            #  withdrawals, webhooks/chapa, sportsbook, bets, admin/*)
  lib/
    wallet.ts               # double-entry ledger + optimistic-concurrency mutations
    payments.ts             # deposit lifecycle (webhook+verify, idempotent) & withdrawals
    chapa.ts                # Chapa gateway client (initialize/verify/transfer, HMAC)
    bets.ts                 # placement pipeline (SINGLE/MULTIPLE/SYSTEM, live delay)
    settlement.ts           # outcome computation, market+bet settlement, cashout
    sports/                 # SportsDataProvider abstraction:
                            #   mock-provider.ts (deterministic simulator)
                            #   api-football-provider.ts (rate-budgeted, header-aware)
                            #   budget.ts (100/day, 10/min, backoff)
    worker/                 # background jobs: fixtures sync, live poll (10s),
                            #   odds sync (20s), live-bet acceptance (2s), settlement (30s)
    auth.ts rate-limit.ts   # JWT sessions, brute-force lockout, fixed-window limiter
    responsible.ts          # deposit/stake/loss limits, cooling-off, self-exclusion
    i18n/                   # en / am / om dictionaries
    validation.ts           # Zod schemas for every endpoint
  components/app/           # shell, bet slip, odds button, user views
  components/admin/         # admin panel (reports/charts, users, KYC, withdrawals,
                            #  events & odds, bets, bonuses, audit, settings)
mini-services/realtime/     # Socket.IO hub (:3003) — score/odds/notify fan-out
prisma/schema.prisma        # full domain (users…notifications), money in cents
```

### Money flow (double-entry)

Every balance mutation writes a `LedgerEntry` (before/after balances + counter
account: `HOUSE_MAIN`, `PROMO_BONUS`, `PAYMENTS_CHAPA`,
`HOUSE_PENDING_WITHDRAWAL`) inside the same DB transaction as the state change.
Wallet rows carry a `version` token — concurrent mutations retry, so double
spending is impossible. On PostgreSQL, add `SELECT … FOR UPDATE` in
`applyMutations()` (marked in code) for strict row locking.

### Bet lifecycle

1. **Placement** — Zod validation → responsible-gaming checks → selection
   validation (market OPEN, no same-market combos) → atomic debit + bet + legs.
2. **Live delay** — bets on live events enter `PENDING_ACCEPTANCE`; after 5 s
   the worker confirms (odds unchanged) or voids + refunds.
3. **In-play** — goals/red cards auto-suspend all markets for 45 s, then they
   reopen with refreshed odds; every odds/score change is pushed over
   Socket.IO (`score_update`, `odds_update`).
4. **Settlement** — when a match finishes, markets resolve via pure outcome
   functions (1X2, DC, O/U incl. PUSH on integer lines, BTTS, Handicap,
   Money-line) and bets pay out (system bets settle per k-combination, voids
   reduce odds). Admins can override events, markets and individual bets.
5. **Cashout** — discounted offer from remaining-leg odds progress; claim-style
   update prevents double cashouts.

### Chapa integration

- `POST /api/deposits` → initialize (`tx_ref`, ETB, callback/return URLs)
- `POST /api/webhooks/chapa` → HMAC signature over the raw body → verify via
  `GET /v1/transaction/verify/:tx_ref` → credit **once** (txRef unique + status
  flip inside the credit transaction)
- Withdrawals hold funds instantly; finance approval triggers
  `POST /v1/transfers` (telebirr / CBE Birr / bank), failures auto-refund
- `CHAPA_TEST_MODE=true` runs a fully simulated gateway (signature-checked)

## Provider swap

`SPORTS_PROVIDER=mock|api-football` (or admin Settings tab at runtime).
Implement `SportsDataProvider` (`src/lib/sports/types.ts`) for Sportmonks /
Betradar and register it in `src/lib/sports/index.ts` — nothing else changes;
users never touch the provider directly.

## Deployment

### Vercel (app) + managed Postgres + separate worker
1. Provision Postgres (Neon/Supabase), set `DATABASE_URL`, run `prisma migrate deploy`.
2. Set all `.env` values in the dashboard. `CHAPA_TEST_MODE=false`, real keys.
3. Deploy the realtime hub on any Node host (Fly.io / Railway / VPS):
   `cd mini-services/realtime && bun index.ts` — set `REALTIME_URL/KEY` for the app.
4. For production-grade job isolation, move `src/lib/worker` into a BullMQ
   worker process (the job functions are already pure exports).

### Docker + VPS
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install && bunx prisma generate && bunx prisma migrate deploy
EXPOSE 3000
CMD ["bun", "run", "start"]
```
Run behind Caddy/Nginx with Postgres + Redis. Keep `JWT_SECRET`,
`CHAPA_*`, `API_FOOTBALL_KEY` in a secrets manager — never in the repo.

## Security & compliance

bcrypt (cost 11) password hashing · JWT httpOnly SameSite cookies · same-origin
CSRF guard on mutations · fixed-window rate limits + login lockout · Zod on
every endpoint · audit log for every admin action · responsible gambling
(deposit/stake/loss limits, cooling-off, self-exclusion, 18+ gate at
registration and KYC) · fraud signals (deposit velocity, unusual stakes,
session tracking) · provider API keys in env only.

## Notes

- The sandbox schema is SQLite; switch `datasource db` to `postgresql` for
  production (statuses → enums, `*Json` string columns → `Json`).
- Unit tests for wallet/settlement logic were intentionally omitted in this
  environment; the modules are pure-function friendly (`computeMarketOutcome`,
  `slipTotals`, `combinations`) and test-ready.

Demo player (fake money): +251911000001 / Test@1234
