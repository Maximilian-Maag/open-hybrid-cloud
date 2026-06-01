package handler

import "github.com/porr-ag/infra-webshop/internal/model"

// ProductCardView ist das aufbereitete Produkt für Katalog-Karten.
type ProductCardView struct {
	model.Product
	CategoryName string
	MinPrice     float64
	Currency     string
	EnvCount     int
}

// HomeStats für das Dashboard.
type HomeStats struct {
	PendingOrders int
	TotalOrders   int
	Projects      int
	InfraCount    int
}

// HomeData für die Startseite.
type HomeData struct {
	Stats    HomeStats
	Featured []ProductCardView
}
