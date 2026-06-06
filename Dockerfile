# Backstage Docker image for air-gapped OKD deployment
# Build on internet-connected machine (iac-control), push to Harbor
#
# Build: DOCKER_BUILDKIT=1 docker build -t harbor.208.haist.farm/sentinel/backstage:v1.0.0 .
# Push:  docker push harbor.208.haist.farm/sentinel/backstage:v1.0.0
# Sign:  cosign sign --key cosign.key harbor.208.haist.farm/sentinel/backstage:v1.0.0

# ============================================================
# Stage 1: Extract package.json files for dependency resolution
# ============================================================
FROM node:22-bookworm-slim AS packages

WORKDIR /app
COPY backstage.json package.json yarn.lock ./
COPY .yarn ./.yarn
COPY .yarnrc.yml ./
COPY packages packages

# Remove everything except package.json files for efficient caching
RUN find packages \! -name "package.json" -mindepth 2 -maxdepth 2 -exec rm -rf {} \+

# ============================================================
# Stage 2: Install deps, compile TypeScript, build backend bundle
# ============================================================
FROM node:22-bookworm-slim AS build

ARG http_proxy
ARG https_proxy

ENV PYTHON=/usr/bin/python3

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends \
      python3 g++ build-essential python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

# Install dependencies (cached layer - only rebuilds if package.json/yarn.lock change)
COPY --from=packages --chown=node:node /app .
RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn install --immutable

# Copy full source and build
COPY --chown=node:node . .
RUN yarn tsc
RUN yarn --cwd packages/backend build

# Extract skeleton (package.json tree) and bundle (compiled code)
RUN mkdir packages/backend/dist/skeleton packages/backend/dist/bundle \
    && tar xzf packages/backend/dist/skeleton.tar.gz -C packages/backend/dist/skeleton \
    && tar xzf packages/backend/dist/bundle.tar.gz -C packages/backend/dist/bundle

# ============================================================
# Stage 3: Production image (minimal, air-gapped ready)
# ============================================================
FROM node:22-bookworm-slim

ENV PYTHON=/usr/bin/python3

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv curl && \
    rm -rf /var/lib/apt/lists/*

# TechDocs: Install mkdocs for local doc generation (air-gapped - no Docker-in-Docker)
RUN python3 -m venv /opt/techdocs && \
    /opt/techdocs/bin/pip install --no-cache-dir \
      mkdocs \
      mkdocs-techdocs-core
ENV PATH="/opt/techdocs/bin:$PATH"

USER node
WORKDIR /app

# Install production dependencies only from skeleton
COPY --from=build --chown=node:node /app/.yarn ./.yarn
COPY --from=build --chown=node:node /app/.yarnrc.yml ./
COPY --from=build --chown=node:node /app/backstage.json ./
COPY --from=build --chown=node:node /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton/ ./

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# Copy compiled backend bundle
COPY --from=build --chown=node:node /app/packages/backend/dist/bundle/ ./

# Copy app-config files (will be overridden by ConfigMap mount in OKD)
COPY --chown=node:node app-config.yaml app-config.production.yaml ./

# Runtime configuration
ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-node-snapshot"
EXPOSE 7007

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
