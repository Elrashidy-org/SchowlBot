# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SchowlBot is the operations backend for **Schowl** (online coding courses for kids, ages 8–18, Egypt/MENA market, bilingual EN/AR). A single Node process runs three things together (`src/index.ts`):

1. **Express HTTP API** — ingests website leads (`POST /client/leads/`, legacy `POST /client/submit-form/`).
2. **Discord bot** — the staff control panel (leads, teachers, trials, recurring lessons, config, analytics).
3. **Automation worker** — a `setInterval` loop draining a DB job queue.

Because the bot holds a persistent Discord gateway socket and the worker runs forever, this **cannot run on serverless** (Vercel). It needs an always-on host — see `DEPLOY.md` (Contabo VPS / Koyeb).

## Commands

```bash
npm run dev              # tsx watch — runs API + bot + worker with reload
npm run typecheck        # tsc --noEmit — run this after any change
npm test                 # vitest run (unit tests, no DB needed)
npm run test:watch
npx vitest run tests/leadSchemas.test.ts      # single test file
npx vitest run -t "computeNextFollowUp"       # single test by name
npm run build && npm start                     # compile to dist/ then run
npm run commands:deploy            # register slash commands GLOBALLY (all servers, ~1h to propagate)
npm run commands:deploy -- --guild # instant register to DISCORD_GUILD_ID (fast for testing)
```

**Any change to a slash command's shape (name/subcommand/options in `src/bot/commands.ts`) requires re-running `commands:deploy`** or it won't appear/work in Discord.

To create a lead locally when Turnstile is configured, run with it disabled: `TURNSTILE_SECRET_KEY= npm run dev` (dotenv won't override an already-set empty var).

## Architecture (the parts that span multiple files)

**Data layer / Supabase.** All DB access uses the Supabase **service-role/secret key** (`SUPABASE_SERVICE_ROLE_KEY`), which bypasses RLS — the public never touches Supabase directly. Critically, **some tables are pre-existing from the main Schowl app** (`courses`, `teacher`, `lesson`, `client`) — SchowlBot's migrations only *add columns/tables* and enable RLS on them. Migrations in `supabase/migrations/` are **idempotent** (`if not exists`, `on conflict do update`) and must be pasted into the Supabase SQL Editor in order — you cannot run DDL through the service-role API key.

**Slash command flow.** Command JSON schemas live in `src/bot/commands.ts`; `deployCommands.ts` registers them; `discordService.ts` routes `interactionCreate` by command name to `handle*Command` functions. `commandCatalog.ts` is a hand-maintained mirror of which roles can use each command, used only by `/help` — **its `roles` must be kept in sync with the `requireBotRole(...)` calls in the handlers** (there's no single source of truth; drift is silent).

**Auth/roles.** `bot_user` + `bot_user_role` tables. Owners come from the `DISCORD_OWNER_IDS` env var (not the DB). `requireBotRole()` in `botUserService.ts` gates commands; `hasAnyRole()` treats env owners as `owner`.

**The job queue is the automation backbone.** `workerService.ts` polls `automation_job` every 60s, **atomically claims** each job (conditional `pending→running` update so multiple instances can't double-process), then dispatches by payload shape: `{sla:true}` → SLA nudge, `{dm_discord_user_id, message}` → DM, `{template, context}` → email. Jobs are enqueued by `followUpService.ts` (no-response + SLA) and `scheduleService.ts` (trial/lesson confirmations + reminders). Terminal/permanent failures post to the `system_alerts` channel. The worker also fires the once-daily digest.

**Lead lifecycle** (`leadService.ts`). `createLead()` (called from the HTTP route or `/lead new` with `skipTurnstile`) → validate (zod, `leadSchemas.ts`) → verify Turnstile → normalize phone → 24h dedupe → insert → **auto-assign** round-robin to a sales rep, **falling back to the owner** when there are no sales reps → enqueue no-response + SLA jobs → send confirmation email. `notifyLeadCreated()` (in `discordService.ts`, called after) posts the embed to the `leads` channel(s) and DMs the assignee. Status changes recompute `next_follow_up_at` and cancel pending follow-up/SLA jobs.

**Dynamic, multi-server config.** SchowlBot runs in multiple Schowl servers. Channels are **not** hardcoded — `/config channel set <purpose>` writes `discord_channel_config` (per guild), and notifications resolve channels by purpose (`leads`, `teacher_applications`, `trial_alerts`, `system_alerts`, `daily_digest`) via `channelConfigService.ts`. Env vars like `DISCORD_LEADS_CHANNEL_ID` are only legacy fallbacks.

**Communications are bilingual and template-driven.** Message *content* lives in the `communication_template` table as **base keys** (e.g. `lead_received`) with `_en`/`_ar` variants. Code calls `renderForLead(baseKey, language, context)` (`templateService.ts`), which picks the language variant and falls back to `_en`. Emails then wrap the rendered body in a branded HTML shell (`src/utils/emailTemplate.ts`, Schowl colors + owl logo + Cairo font, RTL-aware) and append a live course-upsell block. **WhatsApp is links-only** — the bot generates `wa.me` links with prefilled templates for staff to send manually; it never sends WhatsApp automatically.

**Optional integrations degrade gracefully.** Discord, Resend (email), Turnstile, and Google Meet (`meetService.ts`, Calendar API, gated by `GOOGLE_*` env) all no-op cleanly when their env vars are unset — the bot boots and core flows work regardless. When Google is configured, `scheduleTrial`/`scheduleRecurringLessons` auto-generate a Meet link and invite the teacher + parent so the lesson lands in their real calendars.

## Conventions

- **ESM + NodeNext**: relative imports MUST use `.js` extensions (e.g. `import { x } from "./foo.js"`) even though the files are `.ts`. Vitest/Vite resolve `.js`→`.ts` automatically.
- Tests target **pure logic only** (schemas, template rendering, role filtering, follow-up dates, phone/search utils); `tests/setup.ts` injects dummy Supabase env so DB-touching modules import without a connection. Don't write tests that hit Supabase/Discord.
- Prefer command replies as **embeds** via the `okEmbed(title, description?)` helper in `discordService.ts`, not plain `content` strings.
- User-supplied search text must go through `sanitizeSearchTerm()` before building a PostgREST `.or(...)` filter (injection guard).
