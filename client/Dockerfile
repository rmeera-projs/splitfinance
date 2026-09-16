# node:24-alpine, not 20: Node 20 reached end of life in April 2026, and
# the frontend toolchain will not run on it either - vitest 5 declares
# ^22.12 || ^24 || >=26 and jsdom 28 needs >=22.22. Keeping CI and the
# images on the same major is what stops "passes locally, fails in CI".
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
# npm ci, not npm install: it installs exactly what package-lock.json
# pins and fails if the lockfile and package.json disagree. `npm install`
# is free to resolve newer versions at build time, which would mean the
# tree running in production is not the tree CI linted, tested and audited
# (see .github/workflows/security.yml).
RUN npm ci

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
