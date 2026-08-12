# syntax=docker/dockerfile:1.7
FROM node:24.18.0-bookworm-slim AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.0.6 --activate
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
RUN pnpm install --frozen-lockfile

FROM node:24.18.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.0.6 --activate
WORKDIR /workspace
COPY --from=dependencies /workspace /workspace
COPY apps ./apps
COPY packages ./packages
COPY docker ./docker
COPY docs/assistant-public ./docs/assistant-public
RUN pnpm --filter @easygenerator/contracts build \
 && pnpm --filter @easygenerator/web build \
 && pnpm --filter @easygenerator/api build \
 && pnpm --filter @easygenerator/api deploy --legacy --prod /out/api \
 && test -d /out/api/node_modules \
 && test -f /out/api/package.json

FROM node:24.18.0-bookworm-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_HOME=/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN apt-get update \
 && apt-get install --no-install-recommends -y tini \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@11.0.6 --activate \
 && chmod -R a+rX /corepack \
 && groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /workspace/package.json ./package.json
COPY --from=build --chown=app:app /workspace/docker/pnpm-workspace.runtime.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=app:app /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build --chown=app:app /out/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /workspace/apps/web/dist ./apps/api/public
COPY --from=build --chown=app:app /out/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=app:app /workspace/packages/contracts/dist ./apps/api/node_modules/@easygenerator/contracts/dist
COPY --from=build --chown=app:app /workspace/packages/contracts/package.json ./apps/api/node_modules/@easygenerator/contracts/package.json
COPY --from=build --chown=app:app /workspace/docs/assistant-public /app/docs/assistant-public
USER 10001:10001
WORKDIR /app/apps/api
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
