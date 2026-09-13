# Deploying to Railway

This deploys three services from this one repo: the Postgres database, the
`server` API, and the `client` frontend. Railway builds each from the
Dockerfiles already in this repo, so there's very little platform-specific
config - the same Dockerfiles would work on Render or Fly.io with minor
adjustments to these steps.

**Time**: ~15 minutes. **Cost**: free trial credit covers this comfortably to
start; Railway is usage-based after that (no fixed monthly minimum).

## 1. Create the project and database

1. Sign up at [railway.app](https://railway.app) and connect your GitHub account.
2. **New Project → Deploy from GitHub repo** → select `splitfinance`.
3. Railway will try to auto-detect a service from the repo root; delete
   whatever it creates automatically - we're going to add the three services
   by hand instead so each one points at the right subdirectory.
4. In the project, click **+ New → Database → Add PostgreSQL**. Nothing else
   needed here - Railway provisions it and exposes a `DATABASE_URL` you'll
   reference below.

## 2. Deploy the backend (`server`)

1. **+ New → GitHub Repo** → select `splitfinance` again (a project can have
   multiple services from the same repo).
2. In that service's **Settings**:
   - **Root Directory**: `server`
   - **Dockerfile Path**: `Dockerfile` (the existing one - it already runs
     `prisma migrate deploy` before `npm start`, so migrations apply
     automatically on every deploy)
3. In **Variables**, add:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Click "Add Reference" → select the Postgres service's `DATABASE_URL` (don't hardcode it - Railway keeps it in sync if the DB ever moves) |
   | `JWT_SECRET` | A long random string - generate one with `openssl rand -base64 32` **on your own machine** and paste the result; don't reuse any example value you've seen in chat or docs |
   | `COHERE_API_KEY` | Your Cohere key (optional - omit it and auto-categorization just falls back to "Other") |
   | `CLIENT_URL` | Leave unset for now - you'll come back and set this in step 4 once the frontend has a URL |
4. **Settings → Networking → Generate Domain** to get a public URL like
   `https://splitfinance-server-production.up.railway.app`. Copy it - the
   frontend needs it next.
5. Deploy. Check the build logs for `Server running on http://localhost:$PORT`
   and confirm `https://<your-server-domain>/health` returns `{"status":"ok"}`.

## 3. Deploy the frontend (`client`)

1. **+ New → GitHub Repo** → `splitfinance` again.
2. In that service's **Settings**:
   - **Root Directory**: `client`
   - **Dockerfile Path**: `Dockerfile.prod` (**not** the default `Dockerfile`
     - that one runs Vite's dev server, which isn't meant for production;
     `Dockerfile.prod` builds a static bundle and serves it with `serve`)
3. In **Variables**, add:
   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | `https://<your-server-domain-from-step-2>/api` |

   This **must** be marked as a build-time variable (Railway calls this a
   "Build Variable" in the service's Variables tab, alongside the normal
   runtime ones) - Vite bakes `VITE_API_URL` into the compiled JS at build
   time, so setting it as a plain runtime env var has no effect.
4. **Settings → Networking → Generate Domain** to get the frontend's public
   URL, e.g. `https://splitfinance-client-production.up.railway.app`.
5. Deploy.

## 4. Close the loop: tell the backend about the frontend's URL

Now that the frontend has a real URL, go back to the **server** service →
**Variables** → set `CLIENT_URL` to the frontend's domain from step 3
(e.g. `https://splitfinance-client-production.up.railway.app` - no trailing
slash). This is what the server's CORS check allows requests from
(`server/src/app.js`); without it, the deployed frontend's API calls will be
blocked by the browser. Redeploy the server service for the change to take
effect.

## 5. Verify

Open the frontend's URL, sign up, create a group, add an expense. If
anything fails, check in this order:

- **Frontend loads but API calls fail / CORS errors in the browser console**
  → `CLIENT_URL` on the server doesn't match the frontend's actual URL
  exactly (check for a trailing slash or `http` vs `https` mismatch).
- **"Failed to fetch" / network error** → `VITE_API_URL` was set as a runtime
  variable instead of a build variable, or wasn't set before the frontend's
  last build - fix it and trigger a redeploy (a variable change alone
  doesn't rebuild the frontend, since it's baked in at build time).
- **500 errors from the API** → check the server's deploy logs; usually a
  missing `DATABASE_URL` reference or `JWT_SECRET`.

## Updating the deployment later

Every push to the branch each service is connected to (typically `main`)
triggers an automatic redeploy on Railway - migrations, category list
changes, everything ships automatically. The one exception is
`VITE_API_URL`: because it's baked in at build time, changing it requires a
new frontend build, not just a redeploy of the existing one (Railway does
this automatically on a redeploy, since a redeploy rebuilds the image).

# Continuous Deployment via GitHub Actions (AWS only)

This section only applies if you're running the [Terraform/AWS](terraform/)
deployment instead of Railway - Railway already auto-deploys on push (see
above) with no GitHub Actions setup needed.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs backend
(Jest) and frontend (Vitest + build) tests on every push and pull request to
`main`. On a **push** to `main` - i.e. after a PR merges - and only if both
test jobs pass, a third job deploys via **AWS Systems Manager**: it runs the
same update you'd otherwise do by hand (pull the latest code,
`docker compose up -d --build`) as a command sent to the instance through
AWS's API, not over SSH.

This is deliberate, not incidental: the instance's security group only
allows SSH from one trusted IP (`allowed_ssh_cidr` in
`terraform/variables.tf`) - a GitHub-hosted runner's IP changes on every run
and will never match it, so an SSH-based deploy step would always fail at
the network level regardless of any secret. SSM sidesteps this entirely -
no inbound port needs to open for it, ever. This works because
`terraform/main.tf` attaches an IAM role
(`aws_iam_instance_profile.ec2_ssm`) to the instance with the
`AmazonSSMManagedInstanceCore` policy, and the Canonical Ubuntu AMI ships
with the SSM agent already installed and running.

To turn the deploy job on, add two repository secrets (**Settings → Secrets
and variables → Actions → New repository secret**) - the same AWS access
key you used for `aws configure` when setting up Terraform:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | Your IAM user's access key ID |
| `AWS_SECRET_ACCESS_KEY` | Your IAM user's secret access key |

Both values are sensitive - paste them directly into GitHub's secret form,
never into a commit, a PR description, or chat. The workflow looks up the
instance by its `Name=splitfinance-app` tag at deploy time, so there's no
host/IP secret to keep in sync if the instance is ever replaced.

Without these two secrets set, the `deploy` job simply fails (nothing to
authenticate to AWS with) while `backend`/`frontend` still run
normally - CI keeps working as pure CI until you're ready to turn on
auto-deploy.

Once both secrets are set, every merge to `main` deploys automatically -
check progress under the repo's **Actions** tab. Manual deploys (SSH still
works fine for troubleshooting, using `terraform/splitfinance-key.pem` from
your own trusted IP) work alongside this; the workflow just automates the
routine case.
