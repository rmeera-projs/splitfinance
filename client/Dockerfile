FROM node:20-alpine

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
