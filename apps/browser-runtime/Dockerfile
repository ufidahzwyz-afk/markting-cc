# syntax=docker/dockerfile:1.7
# Portable local build: Debian supplies native arm64/amd64 Chromium. See infra/README.md for the compatibility gate.
FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium BROWSER_RUNTIME_BIND=0.0.0.0
RUN --mount=type=secret,id=proxy_ca,required=false \
    apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --strict-ssl=true
RUN mkdir -p /var/lib/boran/browser-profiles && chown -R node:node /app /var/lib/boran
USER node
EXPOSE 3003
CMD ["npm", "run", "start", "--workspace", "@boran/browser-runtime"]
