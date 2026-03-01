locals {
  tags = {
    Project     = "HQ_CompanionApp"
    Environment = "dev"
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "amazon_linux_2" {
  most_recent = true

  owners = [
    # Amazon
    "137112412989"
  ]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_security_group" "dev" {
  name        = "hq-dev-sg"
  description = "HTTP from Cloudflare; all egress"
  vpc_id      = data.aws_vpc.default.id

  # Cloudflare proxies inbound traffic — EC2 only needs port 80
  ingress {
    description = "HTTP from Cloudflare proxy"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

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

resource "aws_iam_instance_profile" "ec2_ssm_instance_profile" {
  name = "hq-dev-ec2-ssm-profile"
  role = aws_iam_role.ec2_ssm_role.name
}

resource "aws_iam_role_policy_attachment" "ec2_ssm_attachment" {
  role       = aws_iam_role.ec2_ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_instance" "dev" {
  ami           = data.aws_ami.amazon_linux_2.id
  instance_type = var.instance_type

  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.dev.id]
  associate_public_ip_address = true

  hibernation = true

  root_block_device {
    encrypted   = true
    volume_size = 20
  }

  iam_instance_profile = aws_iam_instance_profile.ec2_ssm_instance_profile.name

  # Full bootstrap: installs Node 20, MongoDB 7, clones the app, builds it,
  # runs it as a systemd service, and puts nginx in front.
  # user_data runs asynchronously — the instance reports healthy ~3-5 min
  # before the app is fully up. CF will retry until it responds.
  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # ── System ──────────────────────────────────────────────────────────────
    yum update -y
    yum install -y git

    # ── Node.js 20 ──────────────────────────────────────────────────────────
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs

    # ── MongoDB 7 ───────────────────────────────────────────────────────────
    cat > /etc/yum.repos.d/mongodb-org-7.0.repo <<'MONGOREPO'
    [mongodb-org-7.0]
    name=MongoDB Repository
    baseurl=https://repo.mongodb.org/yum/amazon/2/mongodb-org/7.0/x86_64/
    gpgcheck=1
    enabled=1
    gpgkey=https://www.mongodb.org/static/pgp/server-7.0.asc
    MONGOREPO
    yum install -y mongodb-org
    systemctl enable mongod
    systemctl start mongod

    # ── App ─────────────────────────────────────────────────────────────────
    git clone https://github.com/${var.github_repo}.git /opt/hq
    cd /opt/hq
    npm install
    npm run build --workspace=@hq/shared
    npm run build --workspace=@hq/server

    printf 'PORT=4000\nMONGODB_URI=mongodb://localhost:27017/heroquest\nCLIENT_URL=https://hqv2.${var.cf_zone_name}\n' \
      > /opt/hq/app/server/.env

    # ── Systemd service ─────────────────────────────────────────────────────
    cat > /etc/systemd/system/hq-server.service <<'SERVICE'
    [Unit]
    Description=HQ Companion Server
    After=network.target mongod.service
    Wants=mongod.service

    [Service]
    Type=simple
    WorkingDirectory=/opt/hq/app/server
    ExecStart=/usr/bin/node dist/index.js
    Restart=always
    RestartSec=5
    Environment=NODE_ENV=production

    [Install]
    WantedBy=multi-user.target
    SERVICE
    systemctl daemon-reload
    systemctl enable hq-server
    systemctl start hq-server

    # ── nginx ────────────────────────────────────────────────────────────────
    yum install -y nginx
    sed -i 's/ default_server//g' /etc/nginx/nginx.conf
    cat > /etc/nginx/conf.d/hq.conf <<'NGINX'
    server {
      listen 80 default_server;
      location / {
        proxy_pass         http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
      }
    }
    NGINX
    systemctl enable nginx
    systemctl start nginx
  EOF

  tags = merge(local.tags, {
    Name = "hq-dev"
  })
}

# Elastic IP so the DNS A record never needs updating after stop/start
resource "aws_eip" "dev" {
  instance = aws_instance.dev.id
  domain   = "vpc"

  tags = merge(local.tags, {
    Name = "hq-dev-eip"
  })
}
