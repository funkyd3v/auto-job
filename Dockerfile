FROM node:20-slim AS deps
WORKDIR /app
COPY packages/backend/package.json packages/backend/package-lock.json* ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm ci
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
ARG CACHE_BUST=1
COPY packages/backend .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# python3 + python3-pip: produce the exact interpreter that runs the scrapers at runtime.
# pip installs into THIS python — no cross-stage version skew for compiled packages (lxml).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip openssl wget libxml2 libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -r nodejs && useradd -r -g nodejs -m appuser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Install Python scraper dependencies into the runtime python3
COPY packages/backend/scripts/requirements.txt /tmp/requirements.txt
ENV PIP_BREAK_SYSTEM_PACKAGES=1
RUN python3 -m pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt

# Install Playwright Chromium browser + all its system deps automatically
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN python3 -m playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Copy Python scraper scripts
COPY packages/backend/scripts /app/scripts

RUN chown -R appuser:nodejs /app
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]