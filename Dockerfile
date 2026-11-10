# PryingEyes website image. Self-contained: the database (PGlite) and cache are built in, and the
# app applies database migrations and runs its background jobs itself when it starts.
# Data lives in /app/var: mount a volume there and back it up together with .env.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx next build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --uid 10001 app && mkdir -p var/data var/anchors var/log var/uploads && chown -R app var
COPY --from=build --chown=app /app ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Settings come from the environment (compose: env_file: .env), not from a file in the image.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
