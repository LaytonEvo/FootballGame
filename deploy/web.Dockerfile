# Browser preview of the mobile app (expo export --platform web). EXPO_PUBLIC_API_URL is baked in at build time.
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile --filter "@ff/mobile..."
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN cd apps/mobile && npx expo export --platform web --output-dir dist
CMD ["node", "deploy/static-server.mjs", "apps/mobile/dist"]
