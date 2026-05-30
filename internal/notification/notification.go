package notification

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"text/template"

	"github.com/porr-ag/infra-webshop/internal/config"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

// Service sends transactional email notifications via SMTP.
type Service struct {
	cfg   *config.Config
	users repository.UserRepository
}

func NewService(cfg *config.Config, users repository.UserRepository) *Service {
	return &Service{cfg: cfg, users: users}
}

type emailData struct {
	OrderID     int64
	ElementID   int64
	ProductName string
	EnvName     string
	Note        string
	OrdEmail    string
}

func renderTmpl(tmplStr string, data any) (string, error) {
	t, err := template.New("").Parse(tmplStr)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// sendHTML sends an HTML email. Returns nil silently if SMTP is not configured.
func (s *Service) sendHTML(to []string, subject, body string) error {
	if s.cfg.SMTPHost == "" || s.cfg.SMTPFrom == "" {
		return nil
	}
	addr := s.cfg.SMTPHost + ":" + s.cfg.SMTPPort

	msg := "From: " + s.cfg.SMTPFrom + "\r\n" +
		"To: " + strings.Join(to, ", ") + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=utf-8\r\n" +
		"\r\n" + body

	if s.cfg.SMTPTLS {
		return s.sendTLS(addr, to, []byte(msg))
	}

	var auth smtp.Auth
	if s.cfg.SMTPUsername != "" {
		auth = smtp.PlainAuth("", s.cfg.SMTPUsername, s.cfg.SMTPPassword, s.cfg.SMTPHost)
	}
	return smtp.SendMail(addr, auth, s.cfg.SMTPFrom, to, []byte(msg))
}

func (s *Service) sendTLS(addr string, to []string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: s.cfg.SMTPHost})
	if err != nil {
		return fmt.Errorf("smtp tls dial: %w", err)
	}
	client, err := smtp.NewClient(conn, s.cfg.SMTPHost)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Close()
	if s.cfg.SMTPUsername != "" {
		if err := client.Auth(smtp.PlainAuth("", s.cfg.SMTPUsername, s.cfg.SMTPPassword, s.cfg.SMTPHost)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := client.Mail(s.cfg.SMTPFrom); err != nil {
		return err
	}
	for _, r := range to {
		if err := client.Rcpt(r); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	return w.Close()
}

func (s *Service) findAdminEmails(ctx context.Context) []string {
	var emails []string
	for _, role := range []model.Role{model.RoleAdmin, model.RoleShopAdmin} {
		users, err := s.users.FindByRole(ctx, role)
		if err != nil {
			continue
		}
		for _, u := range users {
			emails = append(emails, u.Email)
		}
	}
	return emails
}

// dialAddr opens a plain TCP connection for SMTP (used in sendHTML non-TLS path fallback).
func dialAddr(addr string) (net.Conn, error) {
	return net.Dial("tcp", addr)
}

// OrderCreated notifies the orderer and, if isProjectLeader, all admins.
func (s *Service) OrderCreated(ctx context.Context, order *model.Order, ordererEmail string, isProjectLeader bool) error {
	data := emailData{OrderID: order.ID, OrdEmail: ordererEmail}

	var tmplStr, subject string
	if isProjectLeader {
		tmplStr = orderCreatedOrdTmpl
		subject = fmt.Sprintf(subjectOrderCreated, order.ID)
	} else {
		tmplStr = orderCreatedDirectTmpl
		subject = fmt.Sprintf(subjectOrderCreatedDirect, order.ID)
	}

	body, err := renderTmpl(tmplStr, data)
	if err != nil {
		return err
	}
	if err := s.sendHTML([]string{ordererEmail}, subject, body); err != nil {
		return err
	}

	if isProjectLeader {
		adminBody, err := renderTmpl(adminApprovalTmpl, data)
		if err != nil {
			return err
		}
		adminSubject := fmt.Sprintf(subjectAdminApprovalNeeded, order.ID)
		admins := s.findAdminEmails(ctx)
		if len(admins) > 0 {
			_ = s.sendHTML(admins, adminSubject, adminBody)
		}
	}
	return nil
}

// OrderApproved notifies the orderer that their order was approved.
func (s *Service) OrderApproved(ctx context.Context, order *model.Order, ordererEmail string) error {
	body, err := renderTmpl(orderApprovedTmpl, emailData{OrderID: order.ID})
	if err != nil {
		return err
	}
	return s.sendHTML([]string{ordererEmail}, fmt.Sprintf(subjectOrderApproved, order.ID), body)
}

// OrderRejected notifies the orderer with the rejection reason.
func (s *Service) OrderRejected(ctx context.Context, order *model.Order, ordererEmail, note string) error {
	body, err := renderTmpl(orderRejectedTmpl, emailData{OrderID: order.ID, Note: note})
	if err != nil {
		return err
	}
	return s.sendHTML([]string{ordererEmail}, fmt.Sprintf(subjectOrderRejected, order.ID), body)
}

// ProvisioningCompleted notifies the orderer on successful provisioning.
func (s *Service) ProvisioningCompleted(ctx context.Context, order *model.Order, ordererEmail string) error {
	body, err := renderTmpl(provisioningDoneTmpl, emailData{OrderID: order.ID})
	if err != nil {
		return err
	}
	return s.sendHTML([]string{ordererEmail}, fmt.Sprintf(subjectProvisioningDone, order.ID), body)
}

// ProvisioningFailed notifies the orderer and all admins.
func (s *Service) ProvisioningFailed(ctx context.Context, order *model.Order, ordererEmail string) error {
	body, err := renderTmpl(provisioningFailedTmpl, emailData{OrderID: order.ID})
	if err != nil {
		return err
	}
	recipients := append([]string{ordererEmail}, s.findAdminEmails(ctx)...)
	return s.sendHTML(recipients, fmt.Sprintf(subjectProvisioningFailed, order.ID), body)
}

// Decommissioned notifies the orderer that decommissioning completed.
func (s *Service) Decommissioned(ctx context.Context, elementID int64, ordererEmail string) error {
	body, err := renderTmpl(decommissionedTmpl, emailData{ElementID: elementID})
	if err != nil {
		return err
	}
	return s.sendHTML([]string{ordererEmail}, fmt.Sprintf(subjectDecommissioned, elementID), body)
}
