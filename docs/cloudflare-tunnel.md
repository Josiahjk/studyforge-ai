# Temporary Public Sharing With Cloudflare Tunnel

Use this only for short local demos and testing. It is not a production deployment setup.

## 1. Install cloudflared

Install from Cloudflare's official downloads or your package manager:

```bash
winget install --id Cloudflare.cloudflared
```

## 2. Run the app locally

```bash
npm install
npm run db:generate
npm run db:apply
npm run db:seed
npm run dev
```

Confirm the app opens at:

```text
http://localhost:3000
```

## 3. Start the tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the generated `trycloudflare.com` link from the terminal.

If your machine has an old named tunnel config that returns a Cloudflare 404, bypass it with an empty temp config:

```powershell
New-Item -ItemType File -Force "$env:TEMP\studyforge-empty-cloudflared.yml"
cloudflared --config "$env:TEMP\studyforge-empty-cloudflared.yml" tunnel --no-autoupdate --protocol quic --edge-ip-version auto --url http://127.0.0.1:3000
```

## 4. Share temporarily

Open the generated URL and log in. Deck share links use relative paths, so they work behind the temporary Cloudflare URL.

Stop the tunnel when testing is done. Do not use `trycloudflare.com` tunnels for production.
