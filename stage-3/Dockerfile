# Stage 1: fetch fonts and icons from npm (network is available at build time only).
FROM node:22-slim AS assets
WORKDIR /assets
RUN npm init -y >/dev/null \
 && npm install --no-audit --no-fund @fontsource-variable/shantell-sans@5.3.0 @fontsource-variable/hanken-grotesk@5.3.0 @phosphor-icons/core@2.1.1
COPY scripts/vendor.sh /assets/vendor.sh
RUN sh /assets/vendor.sh /assets /out

# Stage 2: the service. No dependencies; runs TypeScript directly on Node 22.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY --from=assets /out ./public/vendor
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
