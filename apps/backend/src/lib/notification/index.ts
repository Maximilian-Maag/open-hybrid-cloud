import nodemailer from 'nodemailer'
import { db } from '@/lib/db/client'
import { appConfig } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

interface SmtpSettings {
  host: string
  port: number
  from: string
  user: string
  pass: string
  tls: boolean
}

let transporterCache: nodemailer.Transporter | null = null
let smtpSettingsCache: SmtpSettings | null = null

const getSmtpSettings = async (): Promise<SmtpSettings | null> => {
  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_FROM
  ) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      from: process.env.SMTP_FROM,
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
      tls: process.env.SMTP_TLS !== 'false',
    }
  }

  if (smtpSettingsCache) return smtpSettingsCache

  const rows = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1)
  if (!rows.length || !rows[0].smtpHost || !rows[0].smtpPort || !rows[0].smtpFrom) return null

  const cfg = rows[0]
  smtpSettingsCache = {
    host: cfg.smtpHost ?? '',
    port: cfg.smtpPort ?? 0,
    from: cfg.smtpFrom ?? '',
    user: cfg.smtpUser ?? '',
    pass: cfg.smtpPass ?? '',
    tls: cfg.smtpTls ?? true,
  }
  return smtpSettingsCache
}

const getTransporter = async (): Promise<nodemailer.Transporter | null> => {
  if (transporterCache) return transporterCache

  const settings = await getSmtpSettings()
  if (!settings) return null

  transporterCache = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.tls,
    auth: settings.user
      ? { user: settings.user, pass: settings.pass }
      : undefined,
  })
  return transporterCache
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const send = async (to: string, subject: string, html: string): Promise<void> => {
  try {
    const transporter = await getTransporter()
    if (!transporter) return
    const settings = await getSmtpSettings()
    if (!settings) return
    await transporter.sendMail({ from: settings.from, to, subject, html })
  } catch (err) {
    console.error('[notification] Failed to send email:', err)
  }
}

export const sendOrderCreated = async (
  to: string,
  productName: string,
  orderId: number,
): Promise<void> =>
  send(
    to,
    `Order #${orderId} Created — ${escapeHtml(productName)}`,
    `<p>Your order <strong>#${orderId}</strong> for <strong>${escapeHtml(productName)}</strong> has been created and is pending approval.</p>`,
  )

export const sendApprovalRequest = async (
  to: string,
  productName: string,
  orderId: number,
  ordererName: string,
): Promise<void> =>
  send(
    to,
    `Approval Required: Order #${orderId} — ${escapeHtml(productName)}`,
    `<p><strong>${escapeHtml(ordererName)}</strong> has placed order <strong>#${orderId}</strong> for <strong>${escapeHtml(productName)}</strong> and it requires your approval.</p><p>Please log in to review and approve or reject the order.</p>`,
  )

export const sendOrderApproved = async (
  to: string,
  productName: string,
  orderId: number,
): Promise<void> =>
  send(
    to,
    `Order #${orderId} Approved — ${escapeHtml(productName)}`,
    `<p>Your order <strong>#${orderId}</strong> for <strong>${escapeHtml(productName)}</strong> has been approved and provisioning has started.</p>`,
  )

export const sendOrderRejected = async (
  to: string,
  productName: string,
  orderId: number,
  note: string,
): Promise<void> =>
  send(
    to,
    `Order #${orderId} Rejected — ${escapeHtml(productName)}`,
    `<p>Your order <strong>#${orderId}</strong> for <strong>${escapeHtml(productName)}</strong> has been rejected.</p><p><strong>Reason:</strong> ${escapeHtml(note)}</p>`,
  )

export const sendProvisioningCompleted = async (
  to: string,
  productName: string,
  infraId: number,
): Promise<void> =>
  send(
    to,
    `Provisioning Completed — ${escapeHtml(productName)}`,
    `<p>Provisioning of <strong>${escapeHtml(productName)}</strong> has completed successfully. Infrastructure element ID: <strong>${infraId}</strong>.</p>`,
  )

export const sendProvisioningFailed = async (
  to: string,
  productName: string,
  orderId: number,
): Promise<void> =>
  send(
    to,
    `Provisioning Failed — ${escapeHtml(productName)}`,
    `<p>Provisioning for order <strong>#${orderId}</strong> of <strong>${escapeHtml(productName)}</strong> has failed. Please contact your administrator.</p>`,
  )

export const sendDecommissioned = async (
  to: string,
  productName: string,
  infraId: number,
): Promise<void> =>
  send(
    to,
    `Resource Decommissioned — ${escapeHtml(productName)}`,
    `<p>The infrastructure element <strong>${infraId}</strong> (<strong>${escapeHtml(productName)}</strong>) has been decommissioned successfully.</p>`,
  )
