FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY lib ./lib
COPY tests ./tests
COPY README.md ./
COPY ARCHITETTURA.md ./
COPY data ./data

ENV NODE_ENV=production
ENV PORT=3000

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
