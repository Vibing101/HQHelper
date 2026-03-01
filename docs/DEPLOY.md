# Deployment Guide — AWS + Cloudflare Tunnel

**Domain:** `HQv2.savvy-des.com`
**Architecture:** Single EC2 instance running the Node.js server + serving the built React client as static files, exposed publicly only through a Cloudflare Tunnel (no open inbound ports required).

---

## TLS Architecture

End-to-end encryption is achieved across three distinct hops:

```
Browser ──HTTPS──► Cloudflare Edge         (Universal SSL — free, auto-managed by Cloudflare)
                        │
              Cloudflare Tunnel             (mTLS authenticated via tunnel credentials)
                        │
              cloudflared daemon
                        │
                    ──HTTPS──►  EC2: localhost:4000  (Cloudflare Origin CA cert — free, 15-year validity)
                                       │
                                  Express + Socket.io
                                       │
                                    MongoDB
```

**Why this is more secure than "Full" mode:**
- The tunnel's `service` points to `https://localhost:4000`, so traffic is TLS-encrypted even on the loopback interface.
- Cloudflare validates the Origin CA certificate against its own CA (`Full (Strict)` mode), preventing any MITM on the origin segment.
- The Origin CA certificate is issued by Cloudflare, free of charge, and valid for up to 15 years — no Let's Encrypt renewals needed.
- The EC2 instance has **no open inbound ports** beyond SSH.

---

## Prerequisites

- AWS account with EC2 access
- Cloudflare account with `savvy-des.com` added as a zone
- MongoDB Atlas cluster **or** plan to run MongoDB on the EC2 instance
- SSH key pair for EC2

---

## Part 1 — Verify the Build Locally

> All code changes required for production (HTTPS support, static file serving, production env URL) are **already committed to the repository**. This part just confirms a clean build before you touch EC2.

### 1.1 Install dependencies and build

```bash
npm install
npm run build        # builds shared → server → client
```

Expected output:
- `shared/dist/types.js` and `shared/dist/types.d.ts` created
- `server/dist/index.js` created
- `client/dist/index.html` + assets created

### 1.2 Smoke-test locally (optional but recommended)

Create a local `server/.env` from the example:

```bash
cp server/.env.example server/.env
```

Start the built server:

```bash
node server/dist/index.js
```

Open `http://localhost:4000` — the React app should load (served as static files by Express).
Hit `http://localhost:4000/health` — should return `{"status":"ok"}`.

Stop the server before proceeding.

---

## Part 2 — Launch an EC2 Instance

### 2.1 AMI & size

| Setting | Value |
|---|---|
| AMI | Ubuntu 24.04 LTS (x86_64) |
| Instance type | `t3.small` (1 vCPU, 2 GB) |
| Storage | 20 GB gp3 |

### 2.2 Security Group — inbound rules

| Port | Source | Purpose |
|---|---|---|
| 22 | Your IP only | SSH |

**Do not open 80, 443, or 4000.** Cloudflare Tunnel creates an outbound-only connection — no inbound ports needed for web traffic.

### 2.3 Allocate an Elastic IP and attach it to the instance

This keeps the IP stable across reboots (needed for SSH; the tunnel does not require a static IP).

---

## Part 3 — Provision the EC2 Instance

SSH in:

```bash
ssh -i your-key.pem ubuntu@<elastic-ip>
```

### 3.1 Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v20.x.x
```

### 3.2 Install PM2 (process manager)

```bash
sudo npm install -g pm2
```

### 3.3 Install MongoDB (skip if using Atlas)

```bash
sudo apt-get install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl enable --now mongod
```

### 3.4 Install `cloudflared`

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
  -o cloudflared.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

---

## Part 4 — Cloudflare Origin CA Certificate (free, 15-year validity)

This is a free TLS certificate issued by Cloudflare's own CA. It is trusted by Cloudflare's edge servers and enables `Full (Strict)` SSL mode, giving you end-to-end encrypted HTTPS without any recurring renewal.

### 4.1 Generate the certificate in the Cloudflare dashboard

1. Go to **Cloudflare Dashboard** → select the `savvy-des.com` zone
2. Navigate to **SSL/TLS** → **Origin Server**
3. Click **Create Certificate**
4. Settings:
   - **Private key type**: RSA (2048) — default
   - **Hostnames**: `HQv2.savvy-des.com` (add it if not pre-filled)
   - **Certificate Validity**: 15 years
5. Click **Create**
6. You will be shown two values — copy them immediately (they are only shown once):
   - **Origin Certificate** — the `.pem` file content
   - **Private Key** — the `.key` file content

### 4.2 Install the certificate on the EC2 instance

```bash
sudo mkdir -p /etc/ssl/hq
sudo chmod 755 /etc/ssl/hq

# Paste the Origin Certificate content when prompted:
sudo nano /etc/ssl/hq/origin.pem

# Paste the Private Key content when prompted:
sudo nano /etc/ssl/hq/origin.key

# Lock down permissions on the private key:
sudo chmod 644 /etc/ssl/hq/origin.pem
sudo chmod 600 /etc/ssl/hq/origin.key

# Allow the ubuntu user (who runs the app) to read the key:
sudo chown ubuntu:ubuntu /etc/ssl/hq/origin.key
```

### 4.3 Set SSL/TLS mode to Full (Strict) in Cloudflare dashboard

1. **SSL/TLS** → **Overview**
2. Set encryption mode to **Full (Strict)**

> With Full (Strict), Cloudflare's edge validates the Origin CA certificate's signature before completing the TLS connection to your origin. This rules out any MITM attack on the origin segment.

---

## Part 5 — Deploy the Application

### 5.1 Copy the repo to EC2

Option A — clone from GitHub (recommended):

```bash
git clone https://github.com/<your-org>/HQ_Companioon_V5.git ~/app
cd ~/app
npm install
npm run build
```

Option B — rsync from your local machine:

```bash
rsync -avz --exclude node_modules --exclude '*/dist' \
  ./ ubuntu@<elastic-ip>:~/app/
# then on EC2:
cd ~/app && npm install && npm run build
```

### 5.2 Create the server environment file

```bash
cat > ~/app/server/.env << 'EOF'
PORT=4000
MONGODB_URI=mongodb://localhost:27017/heroquest
CLIENT_URL=https://HQv2.savvy-des.com
TLS_CERT_PATH=/etc/ssl/hq/origin.pem
TLS_KEY_PATH=/etc/ssl/hq/origin.key
EOF
```

If using MongoDB Atlas, replace `MONGODB_URI` with your Atlas connection string.

### 5.3 Start the server with PM2

```bash
cd ~/app
pm2 start server/dist/index.js --name hq-server
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

Verify it is running:

```bash
pm2 logs hq-server --lines 20

# Health check over HTTPS on the loopback interface (cert is for HQv2.savvy-des.com,
# so pass --resolve to avoid hostname mismatch):
curl --resolve HQv2.savvy-des.com:4000:127.0.0.1 \
     --cacert /etc/ssl/hq/origin.pem \
     https://HQv2.savvy-des.com:4000/health
# Expected: {"status":"ok"}
```

---

## Part 6 — Cloudflare Tunnel

### 6.1 Log in to Cloudflare from the EC2 instance

```bash
cloudflared tunnel login
```

This prints a browser URL — paste it on your local machine, authorise the zone `savvy-des.com`. A certificate is saved to `~/.cloudflared/cert.pem`.

### 6.2 Create the tunnel

```bash
cloudflared tunnel create hq-tunnel
```

Note the **Tunnel ID** printed (a UUID like `abc12345-...`).

### 6.3 Create the tunnel config file

```bash
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: hq-tunnel
credentials-file: /home/ubuntu/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: HQv2.savvy-des.com
    service: https://localhost:4000
    originRequest:
      originServerName: HQv2.savvy-des.com
      caPool: /etc/ssl/hq/origin.pem
      noTLSVerify: false
  - service: http_status:404
EOF
```

Replace `<TUNNEL-ID>` with your actual UUID.

Key options explained:
- `service: https://localhost:4000` — cloudflared connects to the origin over TLS
- `originServerName` — the hostname the Origin CA cert was issued for; must match
- `caPool` — tells cloudflared to trust the Cloudflare Origin CA cert instead of the system CA bundle (Origin CA certs are not in public CA stores)

### 6.4 Create the DNS CNAME in Cloudflare

```bash
cloudflared tunnel route dns hq-tunnel HQv2.savvy-des.com
```

This adds a CNAME `HQv2.savvy-des.com → <TUNNEL-ID>.cfargotunnel.com` in your Cloudflare dashboard. Verify it appears in the **DNS** tab with Proxy status **Proxied (orange cloud)**.

### 6.5 Run the tunnel as a system service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Check the tunnel is live:

```bash
sudo systemctl status cloudflared
cloudflared tunnel info hq-tunnel
```

---

## Part 7 — Verify End-to-End

```bash
# From anywhere on the internet:
curl https://HQv2.savvy-des.com/health
# Expected: {"status":"ok"}
```

Open `https://HQv2.savvy-des.com` in a browser — the React app should load and Socket.io should connect. The padlock in the browser confirms the Universal SSL cert issued by Cloudflare's public CA.

To confirm SSL mode is truly Full (Strict), check the **SSL/TLS** → **Overview** page in the Cloudflare dashboard; it should show a green "Full (Strict)" badge.

---

## Part 8 — Ongoing Operations

### Redeploy after code changes

```bash
cd ~/app
git pull
npm install
npm run build
pm2 restart hq-server
```

### View application logs

```bash
pm2 logs hq-server
```

### View tunnel logs

```bash
sudo journalctl -u cloudflared -f
```

### MongoDB shell (local)

```bash
mongosh heroquest
```

### Certificate renewal

The Cloudflare Origin CA certificate is valid for **15 years** — no renewal action is needed.
The browser-facing Universal SSL certificate is managed automatically by Cloudflare.

---

## Notes & Gotchas

- **Socket.io + Cloudflare Tunnel**: WebSocket connections work natively through Cloudflare Tunnels. No extra configuration is needed.
- **CORS**: `CLIENT_URL` in `server/.env` must be `https://HQv2.savvy-des.com` exactly (no trailing slash). The server uses this for both Express CORS and Socket.io CORS.
- **Origin CA is not a public CA**: The Cloudflare Origin CA certificate is only trusted by Cloudflare's edge. Browsers hitting the EC2 IP directly would see an untrusted cert — but that path is blocked by the security group anyway.
- **Local dev**: Omit `TLS_CERT_PATH` / `TLS_KEY_PATH` from your local `.env` and the server falls back to plain HTTP on port 4000. Run `npm run dev` (not `npm run build` + `node`) for development — it pre-builds `@hq/shared` then starts both servers in watch mode.
- **Editing shared/src/types.ts during development**: `npm run dev` builds shared once at startup. If you change `types.ts` mid-session, run `npm run build --workspace=shared` in a separate terminal to regenerate `shared/dist/` before the server picks it up.
- **MongoDB Atlas**: Add the EC2's Elastic IP to the Atlas IP allowlist.
- **Instance cost**: A `t3.small` runs ~$17/month on-demand. If budget is tight, build locally (`npm run build`) and rsync only the `dist/` folders to a `t3.micro` — this avoids the RAM pressure of running `tsc` on a 1 GB instance.
