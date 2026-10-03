# syntax=docker/dockerfile:1.7
FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --strict-ssl=true
RUN mkdir -p /app/.local/media && chown -R node:node /app

FROM dependencies AS development
ENV NODE_ENV=development
USER node
CMD ["npm", "run", "dev", "--workspace", "@boran/ops"]

FROM dependencies AS build
ARG APP=ops
RUN if [ "$APP" = "ops" ] || [ "$APP" = "public-site" ]; then npm run build --workspace "@boran/$APP"; fi

FROM build AS production
ENV NODE_ENV=production
ARG APP=ops
ENV BORAN_APP=$APP
USER node
CMD ["sh", "-c", "exec npm run start --workspace @boran/$BORAN_APP"]
