FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_API_URL must be a build ARG so Vite bakes it into the JS bundle
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
# Re-declare ARG so the value is available in this stage for ENV
ARG VITE_API_URL=http://backend:8000
# BACKEND_URL is the runtime value nginx uses for proxy_pass.
# Defaults to VITE_API_URL build arg; can be overridden at container start.
ENV BACKEND_URL=$VITE_API_URL
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf.template
EXPOSE 80
CMD ["sh", "-c", "envsubst '$BACKEND_URL' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
