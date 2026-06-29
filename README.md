# SchowlBot

Express + TypeScript backend and Discord bot for Schowl operations.

## What It Does

- Receives website leads at `POST /client/leads/`.
- Keeps legacy `POST /client/submit-form/` compatible.
- Validates lead data, verifies Turnstile when configured, dedupes spam, and stores leads in Supabase.
- Posts Discord lead embeds with WhatsApp click-to-send links.
- Supports teacher onboarding, approval, course responsibility, availability, time off, scheduling, material requests, and system health commands.
- Sends transactional email with Resend when configured.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill Supabase, Discord, and optional Resend/Turnstile values.
3. Run the SQL migration in `supabase/migrations/001_schowlbot.sql`.
4. Install dependencies with `npm install`.
5. Deploy slash commands with `npm run commands:deploy`.
6. Start local dev with `npm run dev`.

## API

```http
POST /client/leads/
```

```json
{
  "lead_type": "free_trial",
  "parent_name": "Parent Name",
  "child_name": "Child Name",
  "child_age": 12,
  "phone": "201012345678",
  "country_iso": "EG",
  "country_name": "Egypt",
  "language": "en",
  "landing_page": "/",
  "preferred_contact": "phone",
  "consent_contact": true,
  "privacy_policy_accepted": true
}
```

Success:

```json
{ "lead_id": "uuid", "status": "received" }
```

Validation:

```json
{ "errors": { "child_age": "Age must be between 8 and 18" } }
```
