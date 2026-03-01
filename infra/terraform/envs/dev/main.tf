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
  description = "No ingress; allow all egress"
  vpc_id      = data.aws_vpc.default.id

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

  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.dev.id]

  iam_instance_profile = aws_iam_instance_profile.ec2_ssm_instance_profile.name

  tags = merge(local.tags, {
    Name = "hq-dev"
  })
}

output "dev_instance_id" {
  description = "EC2 instance ID (use with SSM start-session --target)"
  value       = aws_instance.dev.id
}
