# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./

# better-sqlite3 ships prebuilt binaries for common platforms. If the download
# is unavailable, fall back to a local build with tools installed only here.
RUN npm ci --omit=dev \
  || { \
    apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && apt-get purge -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*; \
  }

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
