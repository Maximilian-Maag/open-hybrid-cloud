-- 004_exchange_rates.sql: Exchange rate cache table

CREATE TABLE exchange_rates (
    currency_code TEXT PRIMARY KEY,
    rate          NUMERIC(18,6) NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed EUR base rate
INSERT INTO exchange_rates (currency_code, rate) VALUES ('EUR', 1.0);
