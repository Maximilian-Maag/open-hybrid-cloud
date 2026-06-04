package exchange

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

// Service fetches and caches currency exchange rates.
// Rates are relative to EUR (base). All rates expressed as "1 EUR = X currency".
type Service struct {
	apiURL string
	apiKey string
	mu     sync.RWMutex
	rates  map[string]float64
}

func NewService(apiURL, apiKey string) *Service {
	return &Service{
		apiURL: apiURL,
		apiKey: apiKey,
		rates:  map[string]float64{"EUR": 1.0},
	}
}

// LoadRates sets the in-memory rates from DB-stored values (called at startup).
func (s *Service) LoadRates(rates map[string]float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range rates {
		s.rates[k] = v
	}
}

// Refresh fetches fresh rates from the exchange rate API and updates the in-memory cache.
// Returns the new rates map so the caller can persist them to the DB.
func (s *Service) Refresh(ctx context.Context) (map[string]float64, error) {
	apiURL := s.apiURL
	if s.apiKey != "" {
		apiURL += "?access_key=" + s.apiKey
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange rate API: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var result struct {
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse exchange rates: %w", err)
	}

	s.mu.Lock()
	for k, v := range result.Rates {
		s.rates[k] = v
	}
	s.mu.Unlock()

	return result.Rates, nil
}

// Convert converts amount from baseCurrency to targetCurrency.
// If the rate is unknown or currencies are equal, returns the original amount unchanged.
func (s *Service) Convert(amount float64, from, to string) float64 {
	if from == to || to == "" {
		return amount
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	// rates are "1 EUR = X currency", so to convert:
	// EUR -> to: amount * rates[to]
	// from -> EUR: amount / rates[from]
	// from -> to: (amount / rates[from]) * rates[to]
	fromRate, okFrom := s.rates[from]
	toRate, okTo := s.rates[to]
	if !okFrom || !okTo || fromRate == 0 {
		return amount
	}
	return (amount / fromRate) * toRate
}

// RatesSnapshot returns a copy of the current in-memory rates.
func (s *Service) RatesSnapshot() map[string]float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]float64, len(s.rates))
	for k, v := range s.rates {
		out[k] = v
	}
	return out
}

// LocaleCurrency maps a BCP-47 language code to the primary currency used in that locale.
// Languages in the Eurozone map to EUR. Unknown codes default to USD.
func LocaleCurrency(lang string) string {
	switch lang {
	case "de", "fr", "it", "es", "pt", "nl", "el", "fi", "sk", "sl", "mt",
		"et", "lv", "lt", "ga", "hr", "at":
		return "EUR"
	case "bg":
		return "BGN"
	case "cs":
		return "CZK"
	case "da":
		return "DKK"
	case "hu":
		return "HUF"
	case "pl":
		return "PLN"
	case "ro":
		return "RON"
	case "sv":
		return "SEK"
	case "ru":
		return "RUB"
	default:
		return "USD"
	}
}
