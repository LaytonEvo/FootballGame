# API and worker (same image; the Railway service picks the start command).
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile --filter "@ff/api..."
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@ff/api", "start"]
