# erp-api local/dev image. No env file is baked in; Compose injects env/local/api.env (ADR-0014).
# bookworm-slim, not alpine: Prisma 6's query engine links against OpenSSL 3.
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
&& rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
# packages/ before install: the root manifest declares `workspaces: ["packages/*"]`, so the install
# resolves the workspace manifests and --immutable fails outright when they are absent.
COPY packages ./packages
# prisma/ before install: package.json's postinstall runs "prisma generate", which needs the schema.
COPY prisma ./prisma
# configs/ before install: package.json links @erp/configs to ./configs, and tsconfig.json extends it.
COPY configs ./configs
RUN corepack yarn install --immutable
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
# The label font (plan 04.2-17, OFL-1.1): server-side PDFs embed it
COPY assets ./assets
# Generates the client for linux-x64 inside the image (no database needed), then compiles
# and copies the engine into dist/ (scripts/copy-generated-runtime.mjs). `yarn build` starts with
# `build:contracts`, so packages/contracts/dist exists before tsc resolves @erp/contracts.
# The build passes Node's default heap; 3 GB fits Docker Desktop's 4 GB VM. An ARG, not an ENV:
# this image is one stage, and an ENV would stay set in the running api.
ARG NODE_OPTIONS=--max-old-space-size=3072
RUN corepack yarn db:generate && corepack yarn build
ENV NODE_ENV=development PORT=3000
EXPOSE 3000
CMD ["node", "dist/main.js"]
