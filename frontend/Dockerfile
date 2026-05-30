FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf.template
# Default: Docker Compose network name. Override with the actual backend URL in cloud deployments.
ENV BACKEND_URL=http://backend:8000
EXPOSE 80
# envsubst replaces only ${BACKEND_URL}, leaving nginx variables ($host, $uri, etc.) untouched
CMD ["sh", "-c", "envsubst '$BACKEND_URL' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
