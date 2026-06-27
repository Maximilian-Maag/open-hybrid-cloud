import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { auditLog, users } from '@/lib/db/schema'
import { eq, and, gte, lte, ilike, sql } from 'drizzle-orm'
import PDFDocument from 'pdfkit'

interface AuditRow {
  id: number | null
  userId: number | null
  userName: string | null
  action: string | null
  entityId: number | null
  details: string | null
  createdAt: Date | null
}

async function fetchRows(req: NextRequest): Promise<AuditRow[]> {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const action = searchParams.get('action')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const conditions = []
  if (userId) conditions.push(eq(auditLog.userId, Number(userId)))
  if (action) conditions.push(ilike(auditLog.action, `%${action}%`))
  if (from) {
    const d = new Date(from)
    if (!isNaN(d.getTime())) conditions.push(gte(auditLog.createdAt, d))
  }
  if (to) {
    const d = new Date(`${to}T23:59:59Z`)
    if (!isNaN(d.getTime())) conditions.push(lte(auditLog.createdAt, d))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  return db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      userName: users.name,
      action: auditLog.action,
      entityId: auditLog.entityId,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(where)
    .orderBy(sql`${auditLog.createdAt} ASC`)
}

function buildCsv(rows: AuditRow[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const header = ['id', 'userId', 'userName', 'action', 'entityId', 'details', 'createdAt']
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        escape(r.id),
        escape(r.userId),
        escape(r.userName),
        escape(r.action),
        escape(r.entityId),
        escape(r.details),
        escape(r.createdAt?.toISOString()),
      ].join(','),
    ),
  ]
  return lines.join('\n')
}

async function buildPdf(rows: AuditRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Header
    doc.fontSize(16).font('Helvetica-Bold').text('Audit Log Export', { align: 'center' })
    doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toISOString()}`, { align: 'center' })
    doc.moveDown()

    // Column layout for landscape A4 (width ~762 usable at 40px margins)
    const cols = [
      { label: 'ID',       width: 40 },
      { label: 'User',     width: 100 },
      { label: 'Action',   width: 130 },
      { label: 'Entity',   width: 50 },
      { label: 'Details',  width: 280 },
      { label: 'Date',     width: 130 },
    ]

    const rowHeight = 18
    const startX = doc.page.margins.left

    const drawRow = (values: string[], y: number, isHeader: boolean) => {
      let x = startX
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
      if (isHeader) {
        doc.rect(startX, y - 2, cols.reduce((s, c) => s + c.width, 0), rowHeight).fill('#e2e8f0').stroke('#e2e8f0')
        doc.fillColor('black')
      }
      for (let i = 0; i < cols.length; i++) {
        doc.text(values[i] ?? '', x + 2, y, { width: cols[i].width - 4, lineBreak: false, ellipsis: true })
        x += cols[i].width
      }
    }

    let y = doc.y
    drawRow(cols.map((c) => c.label), y, true)
    y += rowHeight

    for (const row of rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
        y = doc.page.margins.top
        drawRow(cols.map((c) => c.label), y, true)
        y += rowHeight
      }
      const date = row.createdAt ? new Date(row.createdAt).toLocaleString('en-GB') : ''
      drawRow([
        String(row.id ?? ''),
        row.userName ?? (row.userId ? `#${row.userId}` : 'System'),
        row.action ?? '',
        String(row.entityId ?? ''),
        row.details ?? '',
        date,
      ], y, false)
      y += rowHeight
    }

    doc.end()
  })
}

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const format = new URL(req.url).searchParams.get('format') ?? 'csv'
  const rows = await fetchRows(req)

  if (format === 'pdf') {
    const pdf = await buildPdf(rows)
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="audit.pdf"',
      },
    })
  }

  return new NextResponse(buildCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="audit.csv"',
    },
  })
}
