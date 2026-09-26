# Dockerfile（リポジトリルート・言語非依存のデプロイ資産。src/ でも tests/ でも harness 所有 scaffold でもない）
# deployment_setup.md §2.9 の雛形に準拠しつつ、emit は runbook どおり build:server（tsconfig.build.json → dist/）を用いる。
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build:server

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# public/ は実行時に CWD 直下から静的配信される（src/main.ts CLIENT_ASSET_DIR）ため runtime へ同梱する。
COPY public ./public
# 非 root 実行（Copilot PR#5 指摘）。/data は named volume 初回作成時に本権限がコピーされるため事前に chown する。
RUN mkdir -p /data && chown -R node:node /data /app
USER node
# PUBLIC_BASE_URL / JOIN_ACCESS_MODE / DATABASE_URL / STORE_BACKEND / DATA_DIR / ADMIN_* はデプロイ時注入（§2.4）。
CMD ["node", "dist/main.js"]
