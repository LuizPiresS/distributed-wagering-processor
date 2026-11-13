FROM oven/bun:alpine AS builder

WORKDIR /app

# Copy dependency definition files
COPY package.json bun.lock tsconfig.json tsconfig.build.json ./

# Install all dependencies
RUN bun install --frozen-lockfile

# Copy source code and scripts
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build TypeScript
RUN bun run build

# Production Runner Stage
FROM oven/bun:alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]

