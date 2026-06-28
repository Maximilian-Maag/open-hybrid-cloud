import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['postgres', 'nodemailer', 'bcryptjs', 'pdfkit'],
}

export default nextConfig
