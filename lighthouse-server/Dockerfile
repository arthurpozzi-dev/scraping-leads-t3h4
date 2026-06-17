# Worker Lighthouse self-hosted.
# Usa a imagem oficial do Playwright (já traz o Chromium + libs do sistema), então
# o chrome-launcher acha o binário via chromium.executablePath() sem download extra.
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# Instala só as deps de produção (lighthouse, chrome-launcher, express, playwright).
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

# Código do worker.
COPY lighthouse-server ./lighthouse-server

ENV LH_PORT=3001
EXPOSE 3001

CMD ["node", "lighthouse-server/server.js"]
