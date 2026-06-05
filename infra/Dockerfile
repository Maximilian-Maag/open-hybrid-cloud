# Stage 1 — Build CSS
FROM node:20-alpine AS css-builder
WORKDIR /build/src
COPY src/package.json src/package-lock.json* ./
RUN npm ci --prefer-offline
COPY src/input.css src/tailwind.config.js ./
COPY src/ui/comp ./ui/comp
COPY src/ui/pages ./ui/pages
COPY src/ui/templates ./ui/templates
RUN npm run build:css

# Stage 2 — Pull certs and timezone data (reused in scratch image)
FROM alpine:3.20 AS certs
RUN apk add --no-cache ca-certificates tzdata

# Stage 3 — Build Go binary
FROM golang:1.25-alpine AS go-builder
WORKDIR /build
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=css-builder /build/src/ui/static/css/style.css ./src/ui/static/css/style.css
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -trimpath -o server ./src/cmd/server

# Stage 4 — Runtime (scratch: no shell, no package manager, minimal attack surface)
FROM scratch
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=certs /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=go-builder /build/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
