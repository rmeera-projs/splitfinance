# Lets GitHub Actions assume an AWS role via OIDC instead of using a
# long-lived IAM user access key stored as a GitHub secret - the deploy job
# in .github/workflows/ci.yml authenticates with a short-lived token minted
# per workflow run instead, which can't be stolen from a secrets dump and
# leak indefinitely the way a static key pair can.
#
# The splitfinance-deploy IAM user (used for local `terraform apply`) is
# untouched by this - this only replaces what GitHub Actions itself uses.

data "aws_caller_identity" "current" {}

# GitHub's own OIDC provider - one per AWS account, not per project. If a
# different project in this account already created one, this resource
# would conflict; there isn't one yet here.
resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # GitHub's OIDC token-signing certificate thumbprint. AWS validates this
  # against the provider's actual TLS chain at creation time regardless, but
  # the argument itself is still required.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Trusts only this repo's own workflow runs on pushes to main - matches
# ci.yml's deploy job condition (github.event_name == 'push' &&
# github.ref == 'refs/heads/main') exactly, so the role can't be assumed
# from a PR build, a fork, or any other repo.
resource "aws_iam_role" "github_actions_deploy" {
  name = "splitfinance-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}

# Exactly the two AWS API calls the deploy step actually makes (see
# ci.yml) - describe-instances to find the running instance by tag, then
# SSM to run the deploy script on it. Nothing else; this role can't touch
# any other AWS resource or service in the account.
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "splitfinance-github-actions-deploy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ec2:DescribeInstances"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*",
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "ssm:GetCommandInvocation"
        Resource = "*"
      },
    ]
  })
}

output "github_actions_role_arn" {
  description = "Set as the role-to-assume in .github/workflows/ci.yml's configure-aws-credentials step."
  value       = aws_iam_role.github_actions_deploy.arn
}
