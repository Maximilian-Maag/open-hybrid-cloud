# Stage 1 — Build CSS
FROM node:20-alpine AS css-builder
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline
COPY input.css tailwind.config.js ./
COPY ui/templates ./ui/templates
RUN npm run build:css

# Stage 2 — Build Go binary
FROM golang:1.25-alpine AS go-builder
WORKDIR /build
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=css-builder /build/ui/static/css/style.css ./ui/static/css/style.css
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Stage 3 — Runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=go-builder /build/server .
EXPOSE 8080
USER nobody
ENTRYPOINT ["/app/server"]
