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
	BaseCurrency       string

	AIProvider string
	AIEndpoint string
	AIAPIKey   string
	AIModel    string
}

func Load() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		AppName:     getEnv("APP_NAME", "Open Hybrid Cloud"),
		AppSubtitle: getEnv("APP_SUBTITLE", "Infrastructure Self-Service"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/openhybridcloud?sslmode=disable"),

		SessionSecret: mustGetEnv("SESSION_SECRET"),

		AdminEmail:    getEnv("ADMIN_EMAIL", "admin@example.com"),
		AdminPassword: mustGetEnv("ADMIN_PASSWORD"),

		EntraTenantID:     os.Getenv("ENTRA_TENANT_ID"),
		EntraClientID:     os.Getenv("ENTRA_CLIENT_ID"),
		EntraClientSecret: os.Getenv("ENTRA_CLIENT_SECRET"),
		EntraRedirectURL:  os.Getenv("ENTRA_REDIRECT_URL"),

		SMTPHost:     getEnv("SMTP_HOST", "localhost"),
		SMTPPort:     getEnv("SMTP_PORT", "1025"),
		SMTPFrom:     getEnv("SMTP_FROM", "noreply@open-hybrid-cloud.local"),
		SMTPUsername: os.Getenv("SMTP_USERNAME"),
		SMTPPassword: os.Getenv("SMTP_PASSWORD"),
		SMTPTLS:      os.Getenv("SMTP_TLS") == "true",

		ExchangeRateAPIURL: getEnv("EXCHANGE_RATE_API_URL", "https://api.exchangerate.host/latest"),
		ExchangeRateAPIKey: os.Getenv("EXCHANGE_RATE_API_KEY"),
		BaseCurrency:       getEnv("BASE_CURRENCY", "EUR"),

		AIProvider: getEnv("AI_PROVIDER", "claude"),
		AIEndpoint: os.Getenv("AI_ENDPOINT"),
		AIAPIKey:   os.Getenv("AI_API_KEY"),
		AIModel:    getEnv("AI_MODEL", "claude-haiku-4-5-20251001"),
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
