FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# BACKEND_HOST: host:port only, http:// is added automatically (internal networks)
# BACKEND_URL:  full URL with scheme, takes precedence over BACKEND_HOST (external/HTTPS)
ENV BACKEND_HOST=backend:8000
ENV BACKEND_URL=

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
