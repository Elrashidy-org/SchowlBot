# SchowlBot Runbook

## Deployment Checklist

- Create Discord application and bot.
- Enable bot gateway intents for guilds.
- Add bot to Schowl Discord server.
- Create a leads channel and copy the channel ID into `DISCORD_LEADS_CHANNEL_ID`.
- Add owner Discord IDs to `DISCORD_OWNER_IDS`.
- Run `npm run commands:deploy`.
- Run `supabase/migrations/001_schowlbot.sql` in Supabase SQL Editor.
- Set `NEXT_PUBLIC_LEAD_ENDPOINT=https://api.schowl.com/client/leads/` in the frontend.

## RLS Model

- Public users never insert directly into Supabase.
- Website users call the Express API.
- The Express API uses the Supabase service role key server-side.
- Discord permissions are checked by `bot_user` and `bot_user_role`.

## Teacher Flow

1. Teacher runs `/init teacher`.
2. Bot opens a modal for name, email, phone, and timezone.
3. Teacher becomes pending.
4. Admin/team lead runs `/teacher approve`.
5. Admin/team lead assigns course responsibilities.
6. Teacher adds availability and time off.

## Scheduling Flow

1. Lead arrives from website.
2. Sales clicks WhatsApp link and contacts parent.
3. Sales runs `/trial suggest` or `/trial schedule`.
4. If no teacher is supplied, SchowlBot calls `pick_trial_teacher`.
5. Bot creates a lesson and queues confirmation/reminder jobs.

## WhatsApp Policy

SchowlBot does not send WhatsApp messages. It only generates `wa.me` links with pre-filled templates for staff to send manually.
