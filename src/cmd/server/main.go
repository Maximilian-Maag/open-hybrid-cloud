package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/app"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/config"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/db"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/migrations"
)

func main() {
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := migrations.Run(ctx, pool); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}

	h, err := app.New(ctx, cfg, pool)
	if err != nil {
		slog.Error("app init failed", "err", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      h,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("starting server", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	stop()

	slog.Info("shutting down...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}
