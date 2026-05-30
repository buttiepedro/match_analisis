FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf.template

# BACKEND_HOST: host:port only, http:// is added automatically
#   Use for internal/private networking (e.g. Railway internal DNS)
#   Example: matchanalisis.railway.internal:8000
# BACKEND_URL: full URL with scheme, takes precedence over BACKEND_HOST
#   Use for external/public backends
#   Example: https://api.miapp.com
ENV BACKEND_HOST=backend:8000
ENV BACKEND_URL=

EXPOSE 80
CMD ["sh", "-c", "\
  if [ -n \"$BACKEND_URL\" ]; then \
    PROXY_URL=\"$BACKEND_URL\"; \
  else \
    PROXY_URL=\"http://$BACKEND_HOST\"; \
  fi && \
  envsubst '$PROXY_URL' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && \
  nginx -g 'daemon off;'"]
