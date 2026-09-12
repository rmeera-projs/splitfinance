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

variable "repo_url" {
  description = "Git URL the instance clones on boot."
  type        = string
  default     = "https://github.com/rmeera-projs/splitfinance.git"
}

variable "repo_branch" {
  description = "Branch to deploy."
  type        = string
  default     = "main"
}
