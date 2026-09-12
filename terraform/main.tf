# Deliberately simple: one EC2 instance running the exact same
# `docker compose up --build` this project already uses locally, in the
# account's default VPC (no custom VPC/NAT gateway - those are the two
# biggest recurring AWS costs, and this app doesn't need the isolation a
# custom VPC buys). See ../DEPLOYMENT.md for the alternative (ECS Fargate +
# RDS + ALB) if this app ever needs to scale beyond one box.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# A random secret generated once and stored in state - never printed to the
# terminal, never asked of the user. Rotate by tainting this resource.
resource "random_password" "jwt_secret" {
  length  = 44
  special = false
}

resource "tls_private_key" "ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.ssh.private_key_pem
  filename        = "${path.module}/splitfinance-key.pem"
  file_permission = "0600"
}

resource "aws_key_pair" "deploy" {
  key_name   = "splitfinance-deploy"
  public_key = tls_private_key.ssh.public_key_openssh
}

resource "aws_security_group" "app" {
  name        = "splitfinance-app"
  description = "SplitFinance: SSH (restricted) + the apps two public ports"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  ingress {
    description = "Frontend (Vite dev server)"
    from_port   = 5173
    to_port     = 5173
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Backend API"
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "splitfinance-app" }
}

# Allocated standalone (not instance-associated yet) so its address is known
# before the instance exists - the instance's own boot script needs to bake
# this address into CLIENT_URL/VITE_API_URL, which would otherwise be a
# chicken-and-egg problem.
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "splitfinance-app" }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.deploy.key_name
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]

  root_block_device {
    volume_size = 20 # gp3, still within the AWS free tier's 30GB-month
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    eip_address     = aws_eip.app.public_ip
    jwt_secret      = random_password.jwt_secret.result
    cohere_api_key  = var.cohere_api_key
    repo_url        = var.repo_url
    repo_branch     = var.repo_branch
  })
  # Re-run the boot script (and thus redeploy) whenever these inputs change.
  user_data_replace_on_change = true

  tags = { Name = "splitfinance-app" }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
