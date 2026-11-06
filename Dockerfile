FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY local-agent/package.json local-agent/package.json
RUN npm ci
COPY frontend frontend
RUN npm run build
FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DB_PATH=/data/rca.sqlite
WORKDIR /app
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY local-agent/package.json local-agent/package.json
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --chown=node:node backend/src backend/src
COPY --from=build --chown=node:node /app/frontend/dist frontend/dist
USER node
EXPOSE 4000
WORKDIR /app/backend
CMD ["node","src/server.js"]
