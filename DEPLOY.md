# Deploying SchowlBot

SchowlBot is a **persistent process** (Discord gateway + Express API + automation
worker), so it needs an always-on host — not a serverless platform like Vercel.
The website can stay on Vercel; point its lead form at this service's URL.

A `Dockerfile` and `docker-compose.yml` are included and work on any host.

## Contabo VPS (recommended for full control)

A cheap always-on Linux box — ideal for this bot. One-time setup:

### 1. Point a subdomain at the VPS
The website is HTTPS, so browsers can't POST leads to a plain `http://<ip>`
(mixed content is blocked). You need HTTPS on the API, which means a domain.
In your DNS, create an **A record**: `api.schowl.com → <your VPS IP>`.

### 2. Install Docker (SSH into the VPS as root)
```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Get the code and configure
```bash
git clone <your-repo-url> schowlbot && cd schowlbot
cp .env.example .env
nano .env   # fill in all values (see the list at the bottom)
```
Set `PUBLIC_API_BASE_URL=https://api.schowl.com` and
`CORS_ALLOWED_ORIGINS=https://schowl.com,https://www.schowl.com`.

### 4. Start it
```bash
docker compose up -d --build
docker compose logs -f          # should show "listening" + "logged in as ..."
```
`restart: unless-stopped` keeps it running across crashes and reboots.

### 5. Put HTTPS in front (Nginx + Let's Encrypt)
```bash
apt update && apt install -y nginx certbot python3-certbot-nginx
```
Create `/etc/nginx/sites-available/schowlbot`:
```nginx
server {
    server_name api.schowl.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/schowlbot /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.schowl.com     # issues + wires up the HTTPS cert
ufw allow 'Nginx Full' && ufw allow OpenSSH && ufw --force enable
```

### 6. Point the website at it
Set the frontend's `NEXT_PUBLIC_LEAD_ENDPOINT=https://api.schowl.com/client/leads/`
and redeploy the site. Verify: `curl https://api.schowl.com/health`.

### Updating later
```bash
cd schowlbot && git pull && docker compose up -d --build
```

## Recommended: Koyeb (free, always-on)

1. Push this repo to GitHub.
2. On <https://www.koyeb.com> → **Create Service → GitHub** → pick the repo.
3. Build: **Dockerfile** (auto-detected). Instance: **Free / nano**.
4. Set the environment variables (see list below) in the Koyeb dashboard.
5. Health check path: `/health`. Deploy.

Koyeb injects `PORT`; the app already reads it.

## Alternatives

- **Fly.io** — `fly launch` (detects the Dockerfile), set secrets with
  `fly secrets set KEY=value`, then `fly deploy`. Small free allowance.
- **Render** — uses `render.yaml`, but the free tier **sleeps when idle** and
  drops the bot connection; only good on a paid instance.
- **Oracle Cloud Always Free** — most powerful free option, but it's a VM:
  install Node 22, clone the repo, `npm ci && npm run build`, and run under
  `pm2` or a systemd service.

## Required environment variables

```
NODE_ENV=production
PORT=                       # injected by the host
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=  # the secret / service_role key (never the anon key)
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_OWNER_IDS=          # your Discord user id(s), comma-separated
CORS_ALLOWED_ORIGINS=       # your website origin(s)
PUBLIC_API_BASE_URL=        # this service's public URL
DEFAULT_TIMEZONE=Africa/Cairo
RESEND_API_KEY=             # optional
RESEND_FROM_EMAIL=Schowl <noreply@schowl.com>
TURNSTILE_SECRET_KEY=       # optional
```

## One-time setup after first deploy

1. Run the SQL migrations in `supabase/migrations/` (001 → 004) in the Supabase SQL Editor.
2. Register global slash commands once (locally, with prod env, or via a one-off job):
   `npm run commands:deploy`  (global — works across all servers).
3. In Discord: `/config channel set purpose:leads` in your leads channel, and
   `/config role grant` to give staff access.
