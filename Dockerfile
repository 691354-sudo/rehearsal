FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=8787 \
    DATABASE_PATH=/data/rehearsal.sqlite \
    BACKUP_DIR=/backups
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY contracts ./contracts
COPY server ./server
COPY scripts ./scripts
COPY tsconfig.server.json ./
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
