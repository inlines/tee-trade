# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,id=tee-trade-npm,target=/root/.npm,sharing=locked npm ci --prefer-offline --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/tee-trade/browser /usr/share/nginx/html
EXPOSE 80
