locals {
  tags = {
    Project     = "HQ_CompanionApp"
    Environment = "dev"
  }
  hostname = "HQv2.${var.cf_zone_name}"
}

# ── AMI: Ubuntu 24.04 LTS (Canonical) ────────────────────────────────────────

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_vpc" "default" {
  default = true
}

# ── SSH Key Pair ──────────────────────────────────────────────────────────────

resource "aws_key_pair" "admin" {
  key_name   = "hq-dev-admin"
  public_key = var.ssh_public_key
  tags       = local.tags
}

# ── Security Group: SSH only ──────────────────────────────────────────────────
# No port 80/443/4000 — cloudflared creates an outbound-only tunnel.

resource "aws_security_group" "dev" {
  name        = "hq-dev-sg"
  description = "SSH from admin only; all egress. Web traffic via Cloudflare Tunnel (outbound)."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# ── IAM: SSM access (optional but handy for browser-based shell) ──────────────

resource "aws_iam_role" "ec2_ssm_role" {
  name = "hq-dev-ec2-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_instance_profile" "ec2_ssm" {
  name = "hq-dev-ec2-ssm-profile"
  role = aws_iam_role.ec2_ssm_role.name
}

resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2_ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# ── EC2 Instance ──────────────────────────────────────────────────────────────

resource "aws_instance" "dev" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  key_name      = aws_key_pair.admin.key_name

  vpc_security_group_ids      = [aws_security_group.dev.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.ec2_ssm.name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  # user_data bootstraps the full stack on first boot.
  # Terraform interpolates ${...} before sending to EC2.
  # Shell $ signs inside inner heredocs are safe — Terraform only looks for ${...}.
  user_data = <<-USERDATA
    #!/bin/bash
    set -euo pipefail
    exec > /var/log/user-data.log 2>&1

    # ── System ────────────────────────────────────────────────────────────────
    apt-get update -y
    apt-get install -y git curl gnupg

    # ── Node.js 20 ────────────────────────────────────────────────────────────
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs

    # ── MongoDB 8 (Ubuntu 24.04 / Noble) ──────────────────────────────────────
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
      gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] \
      https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
      tee /etc/apt/sources.list.d/mongodb-org-8.0.list
    apt-get update -y
    apt-get install -y mongodb-org
    systemctl enable --now mongod

    # ── cloudflared ───────────────────────────────────────────────────────────
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
      -o /tmp/cloudflared.deb
    dpkg -i /tmp/cloudflared.deb

    # ── Clone + build app ─────────────────────────────────────────────────────
    git clone https://github.com/${var.github_repo}.git /opt/hq
    cd /opt/hq

    # Write client production env BEFORE building (baked in by Vite at build time)
    printf 'VITE_SERVER_URL=https://${local.hostname}\n' \
      > /opt/hq/app/client/.env.production

    # Write server runtime env
    cat > /opt/hq/app/server/.env <<DOTENV
PORT=4000
MONGODB_URI=mongodb://localhost:27017/heroquest
CLIENT_URL=https://${local.hostname}
DOTENV

    npm install
    npm run build

    # ── systemd service for the Node.js app ───────────────────────────────────
    cat > /etc/systemd/system/hq-server.service <<SVCEOF
[Unit]
Description=HQ Companion Server
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
WorkingDirectory=/opt/hq
ExecStart=/usr/bin/node app/server/dist/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/hq/app/server/.env

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload
    systemctl enable --now hq-server

    # ── Cloudflare Tunnel ─────────────────────────────────────────────────────
    # 'cloudflared service install <TOKEN>' installs cloudflared as a systemd
    # service. It reads ingress config from the Cloudflare API (managed by
    # cloudflare_tunnel_config in cloudflare.tf) — no local config.yml needed.
    cloudflared service install ${cloudflare_tunnel.hq.tunnel_token}
    systemctl enable --now cloudflared
  USERDATA

  # Tunnel token is known only after cloudflare_tunnel is created,
  # so Terraform will create the tunnel before this instance.
  depends_on = [cloudflare_tunnel.hq]

  tags = merge(local.tags, {
    Name = "hq-dev"
  })
}

# ── Elastic IP (stable address for SSH; tunnel doesn't need a static IP) ─────

resource "aws_eip" "dev" {
  instance = aws_instance.dev.id
  domain   = "vpc"

  tags = merge(local.tags, {
    Name = "hq-dev-eip"
  })
}
