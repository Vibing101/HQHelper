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

  iam_instance_profile = aws_iam_instance_profile.ec2_ssm_instance_profile.name

  # Install nginx and reverse-proxy port 80 → Node.js on 4000
  # WebSocket upgrade headers are forwarded so Socket.io works correctly.
  # The sed removes `default_server` from the stock Amazon Linux 2 nginx.conf
  # so our conf.d block becomes the sole default and handles all requests.
  user_data = <<-EOF
    #!/bin/bash
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
