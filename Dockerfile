# Bun Alpine Builder
FROM oven/bun:1.3.11-alpine AS builder

WORKDIR /app

# Install system dependencies required for Bun
RUN apk add --no-cache wget curl bash

# Copy package files first for caching
COPY package.json bun.lock ./

# Install dependencies
RUN bun install

# Copy project files
COPY . .

# Build the project
RUN bun run build

# Nginx Server Stage
FROM nginx:1.28.2-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 4173

CMD ["nginx", "-g", "daemon off;"]
