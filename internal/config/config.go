package config

import (
	"os"
)

type Config struct {
	Port string

	AppName     string
	AppSubtitle string

	DatabaseURL string

	SessionSecret string

	AdminEmail    string
	AdminPassword string

	EntraTenantID     string
	EntraClientID     string
	EntraClientSecret string
	EntraRedirectURL  string

	SMTPHost     string
	SMTPPort     string
	SMTPFrom     string
	SMTPUsername string
	SMTPPassword string
	SMTPTLS      bool

	ExchangeRateAPIURL string
	ExchangeRateAPIKey string
}

func Load() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		AppName:     getEnv("APP_NAME", "Infra Webshop"),
		AppSubtitle: getEnv("APP_SUBTITLE", "Infrastructure Self-Service"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/infrawebshop?sslmode=disable"),

		SessionSecret: mustGetEnv("SESSION_SECRET"),

		AdminEmail:    getEnv("ADMIN_EMAIL", "admin@example.com"),
		AdminPassword: mustGetEnv("ADMIN_PASSWORD"),

		EntraTenantID:     os.Getenv("ENTRA_TENANT_ID"),
		EntraClientID:     os.Getenv("ENTRA_CLIENT_ID"),
		EntraClientSecret: os.Getenv("ENTRA_CLIENT_SECRET"),
		EntraRedirectURL:  os.Getenv("ENTRA_REDIRECT_URL"),

		SMTPHost:     getEnv("SMTP_HOST", "localhost"),
		SMTPPort:     getEnv("SMTP_PORT", "1025"),
		SMTPFrom:     getEnv("SMTP_FROM", "noreply@infra-webshop.local"),
		SMTPUsername: os.Getenv("SMTP_USERNAME"),
		SMTPPassword: os.Getenv("SMTP_PASSWORD"),
		SMTPTLS:      os.Getenv("SMTP_TLS") == "true",

		ExchangeRateAPIURL: getEnv("EXCHANGE_RATE_API_URL", "https://api.exchangerate.host/latest"),
		ExchangeRateAPIKey: os.Getenv("EXCHANGE_RATE_API_KEY"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic("required environment variable not set: " + key)
	}
	return v
}
