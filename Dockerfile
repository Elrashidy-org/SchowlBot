# Multi-stage build for SchowlBot (Discord bot + Express API + worker).
# Works on any container host: Koyeb, Render, Fly.io, Railway, a VPS, etc.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The app reads PORT from the environment (hosts inject it); 3001 is the local default.
EXPOSE 3001
CMD ["node", "dist/index.js"]
