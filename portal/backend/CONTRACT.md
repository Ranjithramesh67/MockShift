# Portal — API Contract

Authoritative for the parallel builds. Backend agents implement these
endpoints; frontend agents consume them. Deviate only if a genuine bug in this
doc blocks you — and say so in your report.

Base URL: the portal frontend rewrites `/api/*` → `http://127.0.0.1:3102/api/*`,
so frontend code calls **relative** `/api/...` URLs.

## Portal A — public purchase (A4, `routes/publicCheckout.js`, mounted `/api/public`)

Public checkout (mock gateway). Consumers stay unauthenticated; a shopper's
account is auto-created during checkout (A3 decision, role EDITOR) and they are
signed in via the same cookie session scheme. Free (₹0) plans activate
immediately (`requiresPayment:false`); paid plans hold a PENDING order + DRAFT
invoice until the confirmation step marks them paid. The first-recharge bonus
(`plans.trial_days`: Starter +5 / Pro +10 / Team +15) is awarded on the
customer's **first paid order ever** by extending the subscription's initial
`current_period_end`. Free orders are never created, so a Free signup never
consumes the bonus.

Shapes returned (consistent with Portal B where the same rows appear):
- `order`: `{ id, status, billing_cycle, amount, currency, payment_method,
  plan_key, plan_name, created_at }`
- `invoice`: `{ id, number, amount, currency, status, issued_at, paid_at }`
- `subscription`: `{ id, status, billing_cycle, plan: { id, key, name,
  currency }, current_period_start, current_period_end, trial_ends_at,
  cancel_at_period_end, cancelled_at, created_at }`
- `account`: `{ id, name, email, created }`

### `POST /api/public/checkout`
Body: `{ planKey, billingCycle: 'MONTHLY'|'YEARLY', account?: { name, email,
password } }`. `account` required when no session is present; ignored once a
session is (a mismatched email → 409). Password ≥ 8 chars, email must be valid.

- 404 unknown/archived plan; 400 invalid cycle or custom-priced (Enterprise)
  plan; 409 email already registered (sign in instead) or the user already has
  an ACTIVE/TRIALING subscription to the same plan.
- Paid plans → `201 { ok, requiresPayment: true, order, invoice, bonus:
  { firstRechargeEligible, days }, account }` (days = plan.trial_days when
  eligible).
- Free plans → `201 { ok, requiresPayment: false, subscription, account }`.
- A newly created account is signed in (Set-Cookie on the response).

### `POST /api/public/checkout/:orderId/confirm` (order owner)
Simulates the gateway success webhook. Marks the order `PAID` and the linked
invoice `PAID` (issued_at/paid_at now), creates the `ACTIVE` subscription with
`current_period_start = now()` and `current_period_end = now() + cycle
(1 month | 1 year) + bonus days`, and links `orders.subscription_id`.
Idempotent: confirming an already-settled order returns `{ ok,
alreadyProcessed: true, ... }`. 403 if the order belongs to another user; 409
if the user is already ACTIVE/TRIALING on that plan.
→ `{ ok, order, invoice, subscription, bonus: { firstRecharge, days } }`

**Plan change (A5):** an account holds at most one current plan. Confirming an
order for a **different** plan (or activating a free plan) supersedes every
other ACTIVE/TRIALING subscription the customer holds — those rows are
cancelled immediately (`status='CANCELLED'`, `cancelled_at=now()`, via
`app.supersede_subscriptions()`) and the new one becomes current. Duplicate
same-plan orders still 409.

### `GET /api/public/orders/:orderId` (order owner)
Lets the confirmation page reload after a refresh.
→ `{ order, invoice, subscription, bonus }` (`subscription` null until paid;
`bonus` present only for a PENDING order — `{ firstRechargeEligible, days }`).

## Portal A — subscriber self-service (A5, `routes/customerAccount.js`, mounted `/api/public/account`)

Session-auth owner-only surface for customers (their global role is EDITOR —
deliberately not a portal role, so no `requirePortalRole` here). Identity is
`app.current_user_id()` exactly like every other authenticated route; a user
can only ever read/mutate their own rows.

- Cancel and reactivate write `audit_log` rows (`subscriptions.self_cancel`,
  `subscriptions.self_reactivate`, `subscriptions.self_superseded`) with the
  customer as actor — visible to Portal B ops.
- **Cancel is "at the end of the paid period"**: the row stays
  ACTIVE/TRIALING, `cancel_at_period_end` flips to `true` (Stripe-style), it is
  never cancelled mid-period. Reactivate undoes a scheduled cancellation.
- The subscription/invoice `current_period_*` values here share the Portal A
  shapes above.

### `GET /api/public/account/overview` (session)
Current subscription (newest non-terminal: ACTIVE/TRIALING preferred, else
PAST_DUE/SUSPENDED; `null` when the customer has none) + newest-first invoice
history (invoice fields plus `order_id`, `billing_cycle`, `plan_key`,
`plan_name`) + account + `hasPaidOrders`.
→ `{ ok, account: { id, name, email, role }, current: subscription|null,
invoices: [...], hasPaidOrders }`

### `POST /api/public/account/cancel` (session)
Body: `{ subscriptionId }`. 404 unknown/not-yours; 409 unless the row is
ACTIVE/TRIALING or if it is already scheduled to cancel.
→ `{ ok, subscription }` (with `cancel_at_period_end: true`)

### `POST /api/public/account/reactivate` (session)
Body: `{ subscriptionId }`. Undo a scheduled cancellation. 404 unknown/
not-yours; 409 unless `cancel_at_period_end` is currently `true`.
→ `{ ok, subscription }` (with `cancel_at_period_end: false`)

## Portal B — Management App API Contract

## Conventions

- JSON everywhere except the audit CSV export.
- Money columns come back as strings/numeric from Postgres; format for display
  in the frontend (see `ui.tsx` `formatMoney`). Never float-math money in FE.
- Datetimes are ISO-8601 strings (pg returns `timestamptz` → `Date` → JSON).
- Auth: cookie session (same scheme as the main app). All Portal B routes run
  behind `access.requireAuth` + `requirePortalRole(...)` from
  `portal/backend/src/portalAccess.js`. Roles: ADMIN(4) MANAGER(3) SUPPORT(2)
  VIEWER(1).
- List responses: `{ total, page, pageSize, items }` (or named array).
  `page` is 1-based. `pageSize` capped at 100, default 20.
- Errors: non-2xx with `{ error: "message" }`.
- Audit: every mutating route calls `const { logAudit } = require('../auditLog')`
  and logs the before/after of the change (helper already swallows failures).

## Dashboard — B2  (`routes/dashboard.js`, mounted `/api/dashboard`, VIEWER+)

### `GET /api/dashboard/summary`
Response:
```json
{
  "scope": "portal",
  "role": "ADMIN",
  "summary": {
    "totalSubscriptions": 0, "active": 0, "trialing": 0, "pastDue": 0,
    "suspended": 0, "cancelled": 0,
    "trialsEndingSoon": 0,
    "expiringSoon": 0,
    "newThisMonth": 0, "churnThisMonth": 0,
    "mrr": "0", "revenue30d": "0", "totalOrders": 0, "paidOrders": 0,
    "freeSeats": 0,
    "plans": [ { "key": "pro", "name": "Pro", "active": 0, "trialing": 0, "status": "PUBLISHED" } ]
  }
}
```
- `mrr` = monthly recurring revenue (INR): for ACTIVE + TRIALING subscriptions,
  MONTHLY cycle → plan `price_monthly`, YEARLY cycle → plan `price_yearly/12`,
  CUSTOM → 0. Return as string.
- `revenue30d` = sum of PAID order amounts in the last 30 days.
- `trialsEndingSoon` = TRIALING subscriptions with `trial_ends_at` within 7 days.
- `expiringSoon` = ACTIVE subscriptions with `current_period_end` within 14 days.
- `plans` = per-plan ACTIVE/TRIALING counts across the whole catalog.

### `GET /api/dashboard/recent-subscriptions?limit=15`
```json
{ "items": [ { "id": "", "user": { "id": "", "name": "", "email": "" },
  "plan_key": "pro", "plan_name": "Pro", "status": "ACTIVE",
  "billing_cycle": "MONTHLY", "created_at": "" } ] }
```

### `GET /api/dashboard/recent-orders?limit=15`
```json
{ "items": [ { "id": "", "user": { "id": "", "name": "", "email": "" },
  "plan_key": "pro", "plan_name": "Pro", "amount": "299", "currency": "INR",
  "status": "PAID", "created_at": "" } ] }
```

## Subscribers & subscription ops — B3 (`routes/subscribers.js`, mounted `/api/subscribers`)

> Implemented-route note: the B3 router is mounted at `/api/subscribers` in
> `server.js`, so the lifecycle actions below live under the nested prefix
> `/api/subscribers/subscriptions|orders|invoices/:id/...`. Mutating responses
> echo `{ ok:true, subscription|order|invoice: {…} }` where the subscription
> row includes a nested `plan { id, key, name, currency }`.

### `GET /api/subscribers?search=&status=&planId=&page=&pageSize=`
Lists **users** with their latest subscription summary.
- `search` matches name OR email OR username (ILIKE, prefix).
- `status` one of TRIALING|ACTIVE|PAST_DUE|SUSPENDED|CANCELLED|EXPIRED|NONE
  (NONE = user with no subscription). Optional.
- VIEWER sees `email: null` (no PII in list views per matrix). SUPPORT+ see email.
```json
{ "total": 1, "page": 1, "pageSize": 20,
  "subscribers": [ {
    "user": { "id": "", "name": "", "email": "" },
    "subscription": { "id": "", "status": "ACTIVE", "billing_cycle": "MONTHLY",
      "plan_id": "", "plan_key": "pro", "plan_name": "Pro",
      "current_period_end": null, "trial_ends_at": null,
      "cancel_at_period_end": false },
    "totalOrders": 1, "totalPaid": "299"
  } ] }
```

### `GET /api/subscribers/:userId`  (SUPPORT+)
```json
{ "user": { "id": "", "name": "", "email": "", "username": "", "role": "EDITOR",
    "is_active": true, "created_at": "" },
  "subscriptions": [ { "id": "", "status": "ACTIVE", "billing_cycle": "MONTHLY",
    "plan": { "id": "", "key": "pro", "name": "Pro", "currency": "INR" },
    "current_period_start": null, "current_period_end": null,
    "trial_ends_at": null, "cancel_at_period_end": false, "cancelled_at": null,
    "created_at": "" } ],
  "orders": [ { "id": "", "plan_key": "pro", "plan_name": "Pro", "amount": "299",
    "currency": "INR", "status": "PAID", "payment_method": "MANUAL",
    "created_at": "" } ],
  "invoices": [ { "id": "", "number": "INV-2026-0001", "amount": "299",
    "currency": "INR", "status": "PAID", "issued_at": null, "paid_at": null } ] }
```
404 `{error}` if the user does not exist.

### Lifecycle (all MANAGER+ except refund/void = ADMIN)
Every action 404s when the subscription/order/invoice is missing and logs an
audit row. Use `requirePortalRole('MANAGER')` / `requirePortalRole('ADMIN')`.

- `POST /api/subscriptions/:id/activate` → ACTIVE; clears `cancel_at_period_end`,
  `cancelled_at`; sets `current_period_start=now()`. → `{ ok:true, subscription:{...} }`
- `POST /api/subscriptions/:id/suspend` → SUSPENDED. 409 if already SUSPENDED/CANCELLED.
- `POST /api/subscriptions/:id/cancel` → CANCELLED immediately; sets `cancelled_at=now()`.
  409 if already CANCELLED.
- `POST /api/subscriptions/:id/change-plan` body `{ planId, billingCycle? }`
  (plan must exist; billingCycle default = plan default MONTHLY). Updates
  `plan_id`, `billing_cycle`, resets `current_period_start/end`. → `{ ok:true, subscription:{...} }`
- `POST /api/orders/:id/refund` (ADMIN) → order `REFUNDED`; any linked invoices
  with status ISSUED or PAID become VOID. 409 if order is PENDING/FAILED/VOID.
  → `{ ok:true, order:{...} }`
- `POST /api/invoices/:id/void` (ADMIN) → invoice `VOID`. 409 if already VOID.
  → `{ ok:true, invoice:{...} }`

Subscription responses after a mutation echo the updated subscription row
(use the same shape as in the detail call, `subscription` key).

## Plans admin UI — B4a
Existing `routes/plans.js` already provides:
`GET /api/plans`, `GET /api/plans/:id`, `POST /api/plans` (MANAGER),
`PUT /api/plans/:id` (MANAGER), `DELETE /api/plans/:id` (ADMIN).
Body fields (camelCase in): `key, name, tagline, description, priceMonthly,
priceYearly, currency, billingCycles, trialDays, sortOrder, status, limits, features`.
Plan list rows are snake_case DB columns (`price_monthly`, …). Do NOT change
these endpoints' shapes. `trialDays`/`trial_days` is the **first-recharge
bonus**: extra validity days granted on top of the paid period on the
customer's first paid recharge (Starter +5, Pro +10, Team +15; Free ₹0 /
Enterprise 0/custom have none) — not a free-trial duration. B4a additionally
inserts `logAudit` calls into the
existing POST/PUT/DELETE handlers (action `plans.create|plans.update|plans.delete`,
targetType `plan`, targetRef = plan key, before/after the mutated object minus
`updated_at`).

## Promo codes — B4b (`routes/promoCodes.js`, mounted `/api/promo-codes`)

- `GET /api/promo-codes` (VIEWER+) → `{ promoCodes: [...] }` (snake_case rows)
- `GET /api/promo-codes/:id` (VIEWER+) → `{ promoCode: {...} }`
- `POST /api/promo-codes` (MANAGER) → `201 { promoCode }`. Body camelCase:
  `code, description, discountType ('PERCENT'|'FIXED'), discountValue (number),
  currency?, planId?, maxUses?, active?, startsAt?, expiresAt?`. Store `code`
  uppercased. 409 duplicate code.
- `PUT /api/promo-codes/:id` (MANAGER) → `{ promoCode }` (partial fields same).
- `DELETE /api/promo-codes/:id` (ADMIN) → `{ ok:true, deleted }`. 409 if
  `used_count > 0`.
Rows snake_case: `id, code, description, discount_type, discount_value,
currency, plan_id, max_uses, used_count, active, starts_at, expires_at, created_at, updated_at`.

## Audit trail — B5 (`routes/audit.js`, mounted `/api/audit`)

### `GET /api/audit?action=&actor=&targetType=&from=&to=&page=&pageSize=` (SUPPORT+)
Filters: `action` exact (e.g. `plans.update`), `actor` substring match on
`actor_name`, `targetType` exact, `from`/`to` ISO datetimes on `created_at`.
```json
{ "total": 1, "page": 1, "pageSize": 20,
  "items": [ { "id": "", "actor_user_id": "", "actor_name": "Boss",
    "actor_role": "ADMIN", "action": "plans.update", "target_type": "plan",
    "target_id": null, "target_ref": "pro", "before": {}, "after": {},
    "ip_address": null, "created_at": "" } ] }
```

### `GET /api/audit/export?action=&actor=&targetType=&from=&to=` (ADMIN)
Same filters, no paging. Responds `text/csv` with a
`Content-Disposition: attachment; filename="audit-YYYY-MM-DD-HHmm.csv"` header.
Header row: `id,actor_user_id,actor_name,actor_role,action,target_type,target_id,
target_ref,before,after,ip_address,created_at` (CSV-escape quotes/commas;
before/after as JSON text).

## Frontend routes (Next app router under `portal/frontend/app/manage`)

| Route | Owner | Purpose |
|---|---|---|
| `/manage/login` | B6 | login form (`email`, `password`, `login-submit` testids) |
| `/manage` → redirect `/manage/dashboard` | B6 | shell entry |
| `/manage/dashboard` | B2 | KPI cards + recent subs/orders tables |
| `/manage/subscribers` | B3 | searchable list with status/plan filters |
| `/manage/subscribers/[id]` | B3 | user detail + lifecycle action buttons |
| `/manage/plans` | B4a | plan list + create/edit/publish UI |
| `/manage/promo-codes` | B4b | promo code CRUD |
| `/manage/audit` | B5 | filterable audit table + CSV export (ADMIN) |

Shared chrome (do NOT edit, provided by coordinator):
- `portal/frontend/src/components/manage/ui.tsx` — `PageHead`, `StatCard`,
  `Badge`, `DataTable`-style helpers, `formatMoney`, `formatDate`, `formatDateTime`,
  `statusTone`, `EmptyState`, `LoadingBlock`, `Pager`, `cn`.
- `portal/frontend/app/manage/manage.css` — prefixed classes (`pm-*`).
- `portal/frontend/src/lib/portalApi.ts` — `apiFetch(path, {method, body})`
  (JSON, credentials include, throws `Error(error)` from body), `apiLogout()`.

Auth: after `/api/auth/login`, read `/api/me` → `{ user, portalRole }`.
A user with no `portalRole` is not a Portal B member (403 login message).
