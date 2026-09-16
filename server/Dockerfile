# node:24-alpine, not 20: Node 20 reached end of life in April 2026, and
# the frontend toolchain will not run on it either - vitest 5 declares
# ^22.12 || ^24 || >=26 and jsdom 28 needs >=22.22. Keeping CI and the
# images on the same major is what stops "passes locally, fails in CI".
FROM node:24-alpine

# postgresql16-client matches the postgres:16-alpine server in
# docker-compose.yml. pg_dump refuses to dump from a server newer than
# itself, so this pin has to move whenever the database image does.
# scripts/migrate-and-start.sh uses pg_isready, pg_dump and psql.
RUN apk add --no-cache openssl postgresql16-client

WORKDIR /app

COPY package*.json ./
# npm ci, not npm install: it installs exactly what package-lock.json
# pins and fails if the lockfile and package.json disagree. `npm install`
# is free to resolve newer versions at build time, which would mean the
# tree running in production is not the tree CI linted, tested and audited
# (see .github/workflows/security.yml).
RUN npm ci

COPY . .
RUN npx prisma generate

# Git on Windows does not preserve the executable bit, so set it here
# rather than depending on how the repo happens to be checked out.
RUN chmod +x scripts/*.sh

EXPOSE 5000
# Was `npx prisma migrate deploy && npm start`. The script does the same
# thing with a dump taken first and an automatic restore if the migration
# fails - see server/scripts/migrate-and-start.sh.
CMD ["./scripts/migrate-and-start.sh"]
