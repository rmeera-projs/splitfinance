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

# EBS volumes must live in the same AZ as whatever they attach to - looked
# up here so aws_ebs_volume.postgres_data below can match the instance's AZ
# without a dependency cycle (the instance doesn't exist yet at plan time).
data "aws_subnet" "selected" {
  id = data.aws_subnets.default.ids[0]
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

# Replaces the docker-compose.yml default (postgres/postgres) once the
# instance is deployed - see docker-compose.override.yml in
# user_data.sh.tpl. Special characters excluded so it's always safe to drop
# straight into a Postgres connection URL and a shell-quoted `ALTER USER`
# without escaping.
resource "random_password" "postgres_password" {
  length  = 32
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

  # Restricted to the same trusted IP as SSH, not the public internet - now
  # that Caddy/HTTPS (below) fronts both apps, these direct ports only
  # exist as a debugging fallback for whoever runs `terraform apply`.
  # Publicly open, they'd let anyone submit login/signup credentials in
  # plaintext, bypassing the TLS this project otherwise provides.
  ingress {
    description = "Frontend production build (served by serve) - direct access for debugging only"
    from_port   = 4173
    to_port     = 4173
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  ingress {
    description = "Backend API - direct access for debugging only"
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  ingress {
    description = "HTTP (Caddy - ACME challenge + redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (Caddy)"
    from_port   = 443
    to_port     = 443
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

# Lets AWS Systems Manager run commands on the instance (used by the GitHub
# Actions deploy job) without ever needing an open SSH port reachable from
# CI - SSM's control-plane traffic goes out over the instance's normal
# internet egress (already unrestricted in the security group above), not
# through any inbound port. The Canonical Ubuntu AMI ships with the SSM
# agent pre-installed and running, so attaching this role is the only setup
# needed.
resource "aws_iam_role" "ec2_ssm" {
  name = "splitfinance-ec2-ssm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# SecureString parameters holding the app's actual secrets - written once
# by Terraform (so they still pass through state once, same as
# random_password.jwt_secret/postgres_password already did), but no longer
# baked directly into the EC2 instance's user-data. That distinction
# matters: user-data is readable in plaintext by anyone in the account with
# ec2:DescribeInstanceAttribute permission - a wider audience than whoever
# can read Terraform state - and it persists as part of the instance's
# launch configuration for the instance's whole lifetime. The instance
# fetches these fresh at boot instead (see user_data.sh.tpl), via the IAM
# policy below.
locals {
  ssm_secrets = {
    cohere_api_key       = var.cohere_api_key
    resend_api_key       = var.resend_api_key
    jwt_secret           = random_password.jwt_secret.result
    postgres_password    = random_password.postgres_password.result
    zerossl_eab_key_id   = var.zerossl_eab_key_id
    zerossl_eab_hmac_key = var.zerossl_eab_hmac_key
  }
}

# The AWS-managed SSM key's actual key ARN - needed because kms:Decrypt
# permission checks don't reliably resolve through an alias ARN the way
# some other KMS actions do; resolving it via data source here avoids
# hardcoding the key id, which isn't something Terraform otherwise knows
# ahead of time and could differ per account/region.
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

resource "aws_ssm_parameter" "secrets" {
  for_each = local.ssm_secrets

  name  = "/splitfinance/${each.key}"
  type  = "SecureString"
  value = each.value
}

# ssm:GetParameter alone isn't enough for a SecureString with
# --with-decryption - the caller also needs kms:Decrypt on whichever key
# encrypted it. These parameters use the AWS-managed alias/aws/ssm key
# (the default when no custom key is specified), which - unlike a
# customer-managed key - doesn't get its own resource policy to attach to,
# so this permission has to be granted here instead, scoped to that
# specific alias rather than every KMS key in the account.
resource "aws_iam_role_policy" "ec2_ssm_parameters" {
  name = "splitfinance-ec2-ssm-parameters"
  role = aws_iam_role.ec2_ssm.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/splitfinance/*"
      },
      {
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = data.aws_kms_alias.ssm.target_key_arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_ssm" {
  name = "splitfinance-ec2-ssm"
  role = aws_iam_role.ec2_ssm.name
}

# Allocated standalone (not instance-associated yet) so its address is known
# before the instance exists - the instance's own boot script needs to bake
# this address into CLIENT_URL/VITE_API_URL, which would otherwise be a
# chicken-and-egg problem.
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "splitfinance-app" }
}

# Postgres's data lives here, not on the instance's own root volume - the
# root volume is deleted every time the instance is replaced (which
# user_data_replace_on_change triggers on nearly any config change), which
# would otherwise wipe every user account each time. This volume is a
# separate resource with its own lifecycle, reattached to whichever
# instance exists via aws_volume_attachment below.
#
# prevent_destroy is a deliberate guardrail: removing this resource from
# config (or renaming it) would normally make Terraform destroy it exactly
# like the disposable root volume it's meant to be independent from. If
# this ever needs to be actually destroyed, that has to be a deliberate,
# separate step (temporarily drop this block or use -target), never a side
# effect of an unrelated change.
resource "aws_ebs_volume" "postgres_data" {
  availability_zone = data.aws_subnet.selected.availability_zone
  size              = var.postgres_volume_size_gb
  type              = "gp3"
  tags              = { Name = "splitfinance-postgres-data" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "postgres_data" {
  # AWS honors this as a hint, not a guarantee - t3 instances are
  # Nitro-based, so the volume actually shows up to the OS as an NVMe
  # device, not literally /dev/sdf. user_data.sh.tpl finds the real device
  # via the stable /dev/disk/by-id symlink AWS derives from the volume ID.
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.postgres_data.id
  instance_id = aws_instance.app.id
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.deploy.key_name
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_ssm.name

  root_block_device {
    volume_size = 20 # gp3, still within the AWS free tier's 30GB-month
    volume_type = "gp3"
  }

  # Secrets (Cohere/Resend/JWT/Postgres/ZeroSSL) are deliberately NOT passed
  # here - user_data.sh.tpl fetches them from SSM Parameter Store at boot
  # instead, via this instance's own IAM role (aws_iam_role_policy.
  # ec2_ssm_parameters), so they never appear in this instance's user-data
  # in plaintext. Only non-sensitive config (domain names, the repo to
  # clone, etc.) is templated directly.
  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    eip_address         = aws_eip.app.public_ip
    aws_region          = var.aws_region
    resend_from_address = var.resend_from_address
    domain_name         = var.domain_name
    api_domain_name     = var.api_domain_name
    postgres_volume_id  = aws_ebs_volume.postgres_data.id
    repo_url            = var.repo_url
    repo_branch         = var.repo_branch
  })
  # Re-run the boot script (and thus redeploy) whenever these inputs change.
  user_data_replace_on_change = true

  # Not otherwise implied by any argument above - user_data.sh.tpl fetches
  # from SSM Parameter Store by a hardcoded name/path at boot, which
  # Terraform can't see as a reference the way it would a templated value,
  # so the ordering has to be spelled out explicitly. Without this, the
  # instance could boot and start fetching before the parameters (or the
  # IAM policy granting it permission to read them) exist yet.
  depends_on = [aws_ssm_parameter.secrets, aws_iam_role_policy.ec2_ssm_parameters]

  tags = { Name = "splitfinance-app" }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
