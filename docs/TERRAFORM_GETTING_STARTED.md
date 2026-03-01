# Terraform Getting Started (Beginner Guide)

This guide is for your exact setup:
- You already have GitHub + AWS accounts.
- You have AI coding assistants connected.
- You are new to Infrastructure as Code (IaC).

It focuses on creating a **safe first Terraform workflow** for this project, then growing toward full deployment automation.

---

## 1) What Terraform does (in simple terms)

Terraform is a tool that lets you define cloud resources in code (files), then create/update them consistently.

You write files like:
- “Create an EC2 instance”
- “Create a security group”
- “Create an IAM role”

Terraform then:
1. Reads your desired setup.
2. Compares with current AWS state.
3. Shows a plan (`terraform plan`).
4. Applies changes (`terraform apply`).

---

## 2) Recommended learning path for this repo

Do this in phases instead of automating everything at once.

### Phase 1 (best first milestone)
Use Terraform to provision only:
- VPC networking (or default VPC usage if you want simpler)
- Security group
- EC2 instance
- IAM role/profile for EC2
- Optional Elastic IP

Keep app build/deploy steps manual at first (SSH + npm build), because this makes debugging easier while learning.

### Phase 2
Automate app installation/bootstrap on EC2:
- `user_data` script, cloud-init, or Ansible
- install Node, PM2, cloudflared
- clone repo and build

### Phase 3
Add CI/CD from GitHub Actions:
- Terraform checks (`fmt`, `validate`, `plan`)
- Controlled `apply` to dev/staging

---

## 3) One-time local setup (your machine)

Install:
1. **Terraform** (latest stable)
2. **AWS CLI**
3. **Git** (already present for you)

Then configure AWS credentials:

```bash
aws configure
```

Provide:
- Access key ID
- Secret access key
- Region (for example `us-east-1`)
- Output format (`json`)

Quick check:

```bash
aws sts get-caller-identity
```

If this returns your account/user info, AWS auth is working.

---

## 4) Create a Terraform folder structure in this repo

Inside the project root, create:

```text
infra/
  terraform/
    environments/
      dev/
        main.tf
        variables.tf
        terraform.tfvars.example
        outputs.tf
        versions.tf
    modules/
      ec2_app/
        main.tf
        variables.tf
        outputs.tf
```

Why this structure:
- `modules/` = reusable building blocks
- `environments/dev` = concrete settings for one environment

Later you can add `staging` and `prod` with minimal duplication.

---

## 5) Use remote state early (important)

Terraform state is critical. Do not keep important state only on a laptop.

Use:
- S3 bucket for state file
- DynamoDB lock table for state locking

Example backend block (in `environments/dev/main.tf`):

```hcl
terraform {
  backend "s3" {
    bucket         = "YOUR-TERRAFORM-STATE-BUCKET"
    key            = "hq-companion/dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-state-locks"
    encrypt        = true
  }
}
```

> Tip: Bootstrap these backend resources once (manually or with a tiny separate Terraform stack).

---

## 6) Minimal first resources to codify

Start with these resources only:

1. `aws_security_group`
   - inbound: SSH (port 22) from your IP only
   - no public inbound for app ports if using Cloudflare Tunnel
2. `aws_iam_role` + `aws_iam_instance_profile`
   - least privilege, attach only what EC2 needs
3. `aws_instance`
   - Ubuntu 24.04 AMI
   - instance type `t3.small`
4. Optional: `aws_eip` + association

This matches your current deployment approach in `DEPLOY.md` while transitioning to IaC gradually.

---

## 7) Safe Terraform command workflow (every change)

From your selected environment folder (example `infra/terraform/environments/dev`):

```bash
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out tfplan
terraform apply tfplan
```

For destroy in a learning/dev environment only:

```bash
terraform destroy
```

Golden rule: **never run `apply` without reviewing `plan` first**.

---

## 8) GitHub workflow you should use

### Branching
- Create a feature branch for each infra change.
- Open PRs for review (even if only you review at first).

### Commit style
Use clear commit messages, for example:
- `infra(terraform): add initial dev EC2 module`
- `infra(terraform): add S3 backend and DynamoDB lock`

### In PR description include
- What resources are added/changed
- Copy/paste of key `terraform plan` output
- Risk/rollback notes

---

## 9) Secrets and safety checklist

- Never commit AWS credentials.
- Add `.gitignore` entries:
  - `.terraform/`
  - `*.tfstate`
  - `*.tfstate.*`
  - `*.tfvars` (except `*.example`)
- Use least-privilege IAM users/roles.
- Start in a dedicated **dev AWS account** or isolated dev environment when possible.
- Add budget alerts in AWS Billing before large experiments.

---

## 10) Suggested first-week execution plan

### Day 1
- Install Terraform + AWS CLI
- Verify auth with `aws sts get-caller-identity`
- Create `infra/terraform` folder structure

### Day 2
- Write minimal EC2 module
- Provision dev EC2 + security group using Terraform

### Day 3
- Move Terraform state to S3 + DynamoDB lock
- Re-run plan/apply to verify no drift

### Day 4
- Add outputs (instance IP, instance ID)
- Document `apply` and `destroy` runbook in repo

### Day 5
- Add GitHub Actions for `terraform fmt` + `validate` + `plan` (PR only)

By end of week 1, you will already be using real IaC safely.

---

## 11) How your AI agents can help effectively

When prompting Codex/Claude, use a specific request format:

> “Create Terraform files for a dev EC2 deployment using module structure `infra/terraform/environments/dev` and `infra/terraform/modules/ec2_app`. Include `versions.tf`, variables, outputs, and a sample `terraform.tfvars.example`. Do not include hardcoded secrets.”

Then ask follow-up prompts:
- “Explain this file line-by-line for a beginner.”
- “What can break if I apply this?”
- “How do I roll back safely?”

Use AI for speed, but keep `terraform plan` as the final source of truth.

---

## 12) Next step in this repository

When you are ready, the practical next step is:
1. Add `infra/terraform` scaffolding.
2. Implement a small `ec2_app` module for dev.
3. Validate with `terraform plan`.
4. Keep app deployment manual initially (from existing deployment process).

This gives you immediate progress without overwhelming complexity.
