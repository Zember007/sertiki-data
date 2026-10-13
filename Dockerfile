FROM node:20-bookworm-slim

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "api"]

