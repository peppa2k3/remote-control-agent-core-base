
# ==========================================
# Stage 1: Build Frontend
# ==========================================
FROM node:24.19.0-bookworm-slim AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json

RUN npm ci --workspace=frontend

COPY frontend/ frontend/

RUN npm run build --workspace=frontend


# ==========================================
# Stage 2: Install Backend dependencies
# ==========================================
FROM node:24.19.0-bookworm-slim AS backend-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json

RUN npm ci --omit=dev --workspace=backend


# ==========================================
# Stage 3: Production
# ==========================================
FROM node:24.19.0-bookworm-slim AS production

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DB_PATH=/data/rca.sqlite

WORKDIR /app

COPY --from=backend-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-deps --chown=node:node /app/backend/node_modules ./backend/node_modules

COPY --chown=node:node package.json ./
COPY --chown=node:node backend/package.json backend/package.json
COPY --chown=node:node backend/src backend/src

COPY --from=frontend-build --chown=node:node /app/frontend/dist frontend/dist

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 4000

WORKDIR /app/backend

CMD ["node", "src/server.js"]
