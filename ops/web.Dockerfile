ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:stable-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
COPY extensions/clipper/package.json extensions/clipper/package-lock.json ./extensions/clipper/
RUN npm --prefix extensions/clipper ci --ignore-scripts
COPY extensions/clipper/ ./extensions/clipper/
WORKDIR /app/frontend
ARG RELEASE_REVISION=unreleased
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm --prefix ../extensions/clipper run build && npm run build \
    && printf '{"revision":"%s"}\n' "$RELEASE_REVISION" > dist/revision.json

FROM ${NGINX_IMAGE}
COPY ops/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
