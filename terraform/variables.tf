variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type. t3.micro is free-tier eligible on a new AWS account."
  type        = string
  default     = "t3.micro"
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH into the instance (your own IP, /32). Never leave this as 0.0.0.0/0."
  type        = string
}

variable "cohere_api_key" {
  description = "Cohere API key for auto-categorization. Optional - leave empty and expenses just fall back to \"Other\"."
  type        = string
  default     = ""
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend API key for password reset emails. Optional - leave empty and reset links are only logged to the instance's console instead of emailed."
  type        = string
  default     = ""
  sensitive   = true
}

variable "resend_from_address" {
  description = "\"From\" address for password reset emails, e.g. \"SplitFinance <noreply@splitfinance.org>\". Optional - requires a domain verified in Resend; leave empty and emails send from the shared onboarding@resend.dev testing address instead."
  type        = string
  default     = ""
}

variable "postgres_volume_size_gb" {
  description = "Size in GB of the separate, persistent EBS volume Postgres data lives on (independent of the instance's own root volume, which gets destroyed on every instance replacement)."
  type        = number
  default     = 10
}

variable "domain_name" {
  description = "Domain the frontend is served on over HTTPS (via the Caddy reverse proxy). Must have an A record pointing at this instance's Elastic IP before boot, or Caddy's automatic Let's Encrypt cert issuance will fail its ACME challenge and retry until it does."
  type        = string
  default     = "splitfinance.org"
}

variable "api_domain_name" {
  description = "Domain the backend API is served on over HTTPS (via the Caddy reverse proxy). Same DNS requirement as domain_name."
  type        = string
  default     = "api.splitfinance.org"
}

# Optional - when set, Caddy issues certs via ZeroSSL instead of Let's
# Encrypt (its default). Both are free, browser-trusted CAs with
# independent rate limits, so this is the escape hatch for when Let's
# Encrypt's limit (5 certs per exact domain set per 7 days) is exhausted -
# get a free account + these credentials at https://app.zerossl.com under
# Developer/API Access > EAB Credentials. Leave both blank to use Let's
# Encrypt (the normal default).
variable "zerossl_eab_key_id" {
  description = "ZeroSSL EAB Key ID. Optional - see comment above."
  type        = string
  default     = ""
}

variable "zerossl_eab_hmac_key" {
  description = "ZeroSSL EAB HMAC Key. Optional - see comment above."
  type        = string
  default     = ""
  sensitive   = true
}

variable "repo_url" {
  description = "Git URL the instance clones on boot."
  type        = string
  default     = "https://github.com/rmeera-projs/splitfinance.git"
}

variable "github_repo" {
  description = "owner/repo (github_oidc.tf) - scopes the GitHub Actions deploy role's trust policy so only this repo's own main-branch workflow runs can assume it."
  type        = string
  default     = "rmeera-projs/splitfinance"
}

variable "repo_branch" {
  description = "Branch to deploy."
  type        = string
  default     = "main"
}
