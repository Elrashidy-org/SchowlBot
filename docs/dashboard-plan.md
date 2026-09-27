# Schowl Admin Dashboard — Access-Control & Login Spec

Status: design (v1.2). Scope: **staff + teachers** internal dashboard. Parent portal is a later phase.
This is the plan the SchowlBot session designed; it was previously only a published Artifact, now written to disk for review.

---

## 1. Principle — one identity, two front-ends

The dashboard is a second view over the **same backend and the same accounts** the Discord bot uses. There is no second user store.

- An account is a row in `bot_user` (has `email`, an optional `teacher_id`, `active`).
- Roles live in `bot_user_role`.
- Owners come from the `DISCORD_OWNER_IDS` env var (surfaced as `owner` even without a role row).

The dashboard authenticates a person, resolves them to that same `bot_user` + roles, and gates every screen/API call with the same logic the bot's `requireBotRole()` already enforces. A teacher approved in Discord can sign in immediately.

---

## 2. Roles

| Role | Summary |
|---|---|
| `owner` | Full control incl. granting/revoking roles. From `DISCORD_OWNER_IDS`. |
| `admin` | Everything operational: teachers, students, finance, camps, channel config. Can't grant roles. |
| `team_lead` | Day-to-day ops: leads, trials, students, teacher payroll. No account admin. |
| `sales` | Leads, trials, students, camps. Revenue read-only. |
| `teacher` | Read-only, own students/groups only, no financial data (see §5). |

A person can hold multiple roles; access is the union.

---

## 3. Authentication & account linking

Plain **email + password** is the login (Supabase Auth). Discord is for reminders/management, **not** the sign-in. The bridge between a person and their `bot_user` is the **email**.

**Login**
- Email + password. After a one-time bootstrap, every sign-in is a normal password login.
- Account we created: first login uses an emailed **one-time code (OTP)**; then the person sets their own password.
- Discord-first person: they run `/account` in Discord → get a **magic link** → set a password on first visit.
- **No self-signup.** Accounts are created by staff or bootstrapped from a Discord role grant. Roles are still granted only in Discord.

**Linking Discord ⇄ account — two directions**
- A · account first: dashboard settings → **Connect Discord** shows a short OTP → run `/connect <otp>` in Discord → linked.
- B · Discord first: email is **required when a role is granted**, so `/account` emails a magic link and the account is created already linked.

**The join:** one `auth.users` row (login) ↔ one `bot_user` row (roles + Discord) via a new `bot_user.auth_user_id`. `bot_user.email` stays required and unique.

---

## 4. Authorization — capability matrix

Enforcement is Postgres **row-level security** (see §5) with a `requireRole()` API guard as defense in depth.

| Capability | owner | admin | team_lead | sales | teacher |
|---|---|---|---|---|---|
| Leads & funnel, trials | full | full | full | full | — |
| Students — profile, level, progress | full | full | full | full | own, read-only, no $ |
| Packages / renewals / prices / payments | full | full | full | view | hidden |
| Revenue & sales reports | full | full | full | view | hidden |
| Lessons & recordings | all | all | all | all | own |
| Camp groups & members | all | all | all | all | own |
| Teachers, payroll, rates | full | full | full | — | own payout |
| Config — channels | full | full | — | — | — |
| Config — grant/revoke roles | full | — | — | — | — |

---

## 5. Enforcement model — RLS, not just the API

Today the backend uses the Supabase **service-role key** (bypasses RLS), so the API is the only guard. The dashboard changes that:

- **User requests go through the Express API, acting as the signed-in person** — the API carries the person's Supabase JWT so **Postgres RLS** decides which rows they can touch, keyed on `auth.uid()` + roles.
- Roles reach RLS via a **Supabase auth hook** that stamps the person's roles into their JWT (fallback: a `security definer` `current_roles()` function policies call).
- The **service-role key is used only by the bot and worker** (system actors, no user).
- RLS is row-level. **Teacher column limits** (see a student but not the price) are done with **teacher-safe views** that expose only the safe columns, not RLS.

Decision on record: for user requests the dashboard talks **through the Express API acting as the user** (keeps business logic/validation/audit in one place), not the browser hitting Supabase directly.

---

## 6. Teacher access (detail)

Two rules combine: row scoping, then field projection.

**Which students a teacher sees:** union of students where `assigned_teacher_id` = them, students in lessons they teach, and members of camp groups where `camp_group.teacher_id` = them. Everything else is invisible.

**Visible:** name, age, course, track, **level**, learning notes; **progress** (session history, ratings, recordings, attendance); their camp groups (name, chat link, members).

**Removed (never leaves the API for a teacher):** packages & lessons remaining, renewal status, prices paid, payments/receipts, sales/leads/funnel/revenue, **parent contact (name/phone/email)**, any other teacher's data.

Enforced by a `studentViewFor("teacher")` projection (after row scoping) — via teacher-safe views under RLS. Teacher endpoints: `/me/students`, `/me/groups`, `/me/groups/:id`, `/me/schedule`.

Decision on record: **teachers get no parent contact details** — they coordinate through the group chat link.

---

## 7. Recordings & delivery

Recordings are **uploaded after a lesson and sent to the client as a link on request** — no streaming, no self-serve portal.

- Teacher/staff uploads the recording and attaches its link to the lesson (`lesson.recording_url`), via `/lesson complete` or the dashboard.
- When a parent asks, staff trigger **Send recording** (email/WhatsApp). Deliberate action, not an open portal.
- Teachers attach/see links only for their own lessons; staff can send to any client.

**Where files live — recommendation: Google Drive (Workspace).** Teachers upload to a shared Drive folder and paste the share link; Google carries storage, durability, and bandwidth. Keep the 200 GB server for the app and backups (a lesson is 0.5–1.5 GB and would fill it fast). Alternative: host on the server (full control + revocable links, but plan for storage growth / download bandwidth). For children's recordings, share to the specific parent or a revocable link — not a permanent "anyone with the link" URL.

---

## 8. API surface

Extend the existing Express app.

```
// Auth — Supabase Auth issues the token; the API maps it to bot_user + roles
POST /auth/login          email + password → Supabase session
POST /auth/otp            first-login one-time code (account we created)
POST /auth/logout         end the session
GET  /auth/me             identity + roles (drives what the UI shows)
POST /auth/discord/otp    "Connect Discord" → returns an OTP to type in Discord

// Discord commands
/account                  email a magic link to set up / reset the account
/connect <otp>            link this Discord user to the dashboard account

// Request path (RLS enforces; requireRole is defense in depth)
authMiddleware   verify session → req.user = { botUserId, roles, teacherId }
                 → the API queries Postgres AS this user, so RLS applies
requireRole([…]) 403 guard on top; service-role is bot/worker only

// Data (staff routes carry requireRole; teacher routes hit teacher-safe views)
GET/POST /leads · /trials · /students · /payments · /camps · /teachers · /config
GET      /me/students · /me/groups · /me/schedule   (teacher-scoped)
GET      /recordings/:lessonId/url   role check → link
```

Write endpoints mirror the slash commands (enroll, renew, record payment, mark a lesson, reroute a trial, grant a role), sharing the same service functions and guards.

---

## 9. Front end & deployment

- **Next.js** on `dashboard.schowl.com`, calling the SchowlBot API. No new database, no new identity store.
- Add the dashboard origin to `CORS_ALLOWED_ORIGINS`.
- Session cookie on the `.schowl.com` domain (httpOnly, SameSite) so it works across the subdomain.
- Same host/Nginx as the bot API.

---

## 10. Security rules

- The **database enforces access** — user requests run under the person's identity with RLS on; service-role only for bot/worker.
- **Column limits via views** — teachers reach students through a teacher-safe view that omits financial + contact columns.
- **No self-signup** — roles granted only through Discord.
- **Sessions** — Supabase Auth sessions (httpOnly, SameSite), short access token with refresh; CSRF on writes.
- **Recordings** — delivered by deliberate staff action; teachers attach only their own lessons'; prefer per-parent/revocable links for children's content.
- **Rate limiting** on auth + write endpoints.

---

## 11. Phased rollout

- **P1 — Auth + read-only.** Email login, `/auth/me`, `requireRole`, read-only screens (leads, students, lessons + recordings, analytics for staff; own schedule/students/groups/recordings for teachers). Lowest risk, immediately useful.
- **P2 — Write actions.** Mirror the bot commands: enroll, renew, record payment, mark lessons, manage trials + reroute, camps/groups, role grants.
- **P3 — Parent portal (later).** Guardians sign in by email to see their own child's recordings, ratings, and package balance. Same auth mechanism, a different account type.

---

## 12. Config checklist

- Enable Supabase Auth — email + password, OTP, magic link — sending through Resend.
- Add `bot_user.auth_user_id` (→ `auth.users`); keep `bot_user.email` unique; backfill staff/owner emails.
- Add a Supabase auth hook that stamps each person's roles into their JWT.
- Write RLS policies for every table, plus teacher-safe views for column limits.
- Have the API act as the signed-in user (forward their JWT); keep service-role for bot/worker only.
- Add `/connect` and `/account` Discord commands.
- Set up the Google Drive (Workspace) recordings folder; store share links on `lesson.recording_url`; add a "Send recording" action.
- Add `dashboard.schowl.com` to `CORS_ALLOWED_ORIGINS`; session cookie domain `.schowl.com`.

---

## Open items / likely "what's missing" for review

These were **not** fully specified and are the most likely gaps Belal will want decided:

1. **Package pricing model in the dashboard** — the price book (`package_plan`) + per-sale discount tracking exists in the bot; the dashboard needs screens for it, and the real tiers/prices still need to be set.
2. **Audit log** — who did what in the dashboard (esp. finance + role grants). Not yet designed.
3. **Notifications** — does the dashboard surface the same alerts the bot posts to Discord (SLA breaches, abandoned bookings, low-balance), or stay read-focused?
4. **Analytics/dashboard-proper** — the "funnel/retention numbers" view was discussed but not specced in detail (metrics, date ranges, per-rep breakdowns).
5. **Recording upload UX** — Drive link paste vs. an in-dashboard uploader; who can send to the parent and the exact send flow.
6. **Parent portal (P3)** — auth path exists in concept (email), but the data model for parent↔student linking isn't designed.
7. **Password reset / account recovery** for dashboard accounts beyond the initial OTP/magic-link bootstrap.
8. **Session/permission edge cases** — deactivating a `bot_user`, revoking a role mid-session, owner who has no `bot_user` row yet.
