# Staff console: static build served by a tiny Node server. VITE_API_URL is baked in at build time.
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile --filter "@ff/admin..."
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @ff/admin build
CMD ["node", "deploy/static-server.mjs", "apps/admin/dist"]
