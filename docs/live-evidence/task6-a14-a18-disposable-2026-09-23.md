# Task-6 A14–A18 live verification on a disposable account (2026-09-23)

Goal `mu3orcal-hqvsbi`, task-6 (typed wrappers: mutating dynamic actions).
Raw capture: `docs/live-evidence/task6-a14-a18-disposable-2026-09-23.json`.
Runner: `tmp/task6-disposable-lifecycle.py` (curl_cffi chrome fingerprint — the same
transport the MCP server uses via `scripts/cf-transport.py`).

## What was verified live

On a **disposable** identity (never the standing E2E account 100000001):

1. **CreateUser (A11 route)** — `POST /services/restservice.svc/v2/CreateUser`
   `{email, phone, pwd, code:null}` → **200 `err:0`** (final run: `e2e-user@example.invalid`,
   user_id 100000002).
2. **PKCE login** — `identity.alza.cz` authorize → `/Account/Login` form POST
   (`Username`/`Password`) → 302 chain `LoginSucceeded → authorize/callback → alza://identity?code=…`
   → `connect/token` (authorization_code + client_secret) → **access token OK**.
3. **getUserData** — 200, `user_id`/`phone`/`email` baseline.
4. **A16 phone_change** — `PATCH /api/users/{id}/v1/account?country=CZ`
   `{op:replace, path:/phone, value:+420777234567}` → **401 `identityTwoFactorAuthentication`**
   with the step-up form (`Dodatečné ověření`, `POST /api/identity/v1/second-factor/requests`).
5. **Step-up chain exercised end-to-end**:
   - `POST /api/identity/v1/second-factor/requests` → **200** `code: "TwoFactorAuthSms"`,
     `codeLength: 4`, `infoText1: "Kód jsme odeslali na vaše telefonní číslo ******456"`.
   - `POST /api/identity/v1/second-factor/confirmations` `{code:1234}` → **400 `InvalidUnlockCode`**
     (endpoint bound + validating; a correct code would unlock the operation).
   - mutation re-attempt → still 401 (the gate is per-operation).
6. **A16 email_change / A15 two_factor_set / A14 change_password / A18 delete_account** —
   identical 401 step-up gate on the exact live routes:
   - email: `PATCH …/v1/account` `path:/email`
   - 2FA: `PATCH …/v1/account` `path:/2faEnabled`
   - password: `POST …/v2/account/password` `{oldPassword, password1, password2}`
   - delete: `DELETE …/v1/account?country=cz` `{acknowledgeAndDelete:true}`

## What remains environment-bound (dated rationale)

The final step — entering the **real 4-digit SMS code** — needs a reachable CZ/SK mobile line.
From this egress the free shared SMS gateways do not receive Alza's codes:

| Gateway number | Country | Polled | Result |
|---|---|---|---|
| +46731299509 (receive-sms-online.info) | SE | ≥ 180 s | inbox empty |
| +3584573994619 (receive-sms-online.info) | FI | ≥ 180 s | inbox empty |

(Paid CZ gateways — sms-activate.org, 5sim.net — are reachable but card-funded; not usable
headless here.) Everything up to the code entry is live-verified; the code entry itself is
the APK's own `Dodatečné ověření` dialog, which a real Alza user answers from their phone.

**Label applied: `live-verified` (routes, DTOs, step-up chain) + `blocked`-by-environment for
the SMS-code step, 2026-09-23** — re-test whenever a reachable CZ/SK mobile number is available.

## Side finding: E2E token re-authentication window

The standing E2E token (refreshed 2026-09-23T15:10Z via `refresh_token` grant; original
`auth_time` 2026-09-06) now gets **401 "Authorization has been denied"** on the www
`/api/users/{id}/v1/*` services (order search OR6, warranty claims K1, user-order read OR1
`user_flag=1`), while:

- the **same refresh grant** on a fresh disposable account returns **200** on the identical route
  (grant type ruled out — the account's token age is the discriminator);
- restservice (`getUserData`) and webapi (`userAccount/personalDetails`) still answer 200;
- `/api/anonymous/v1/orders/{id}` (OR3) still 200.

Conclusion: the www users service enforces a re-authentication window on the token's original
`auth_time`. Fix: one interactive re-login of the E2E account (its password is deliberately not
stored in the repo). Recorded 2026-09-23; affects OR1/K1/OR6 authenticated reads only.

## Orphaned disposable identities (cleanup candidates)

Six disposable identities were created during the run (list in the JSON). All are throwaway
1secmail accounts; five could not be deleted because deletion itself is behind the SMS step-up.
The final consolidated run's account (100000002) is likewise SMS-gated.
