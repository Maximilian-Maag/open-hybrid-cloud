'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Branding, UpdateBrandingRequest } from '@open-hybrid-cloud/types'
import { put, apiRequest } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface Props {
  initial: Branding
  token: string
}

export function BrandingForm({ initial, token }: Props) {
  const router = useRouter()
  const [shopName, setShopName] = useState(initial.shopName)
  const [shopSubtitle, setShopSubtitle] = useState(initial.shopSubtitle)
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor)
  const [secondaryColor, setSecondaryColor] = useState(initial.secondaryColor)
  const [imprintText, setImprintText] = useState(initial.imprintText)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setLogoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setSuccess(false)
    try {
      const body: UpdateBrandingRequest = {
        shopName: shopName.trim(),
        shopSubtitle: shopSubtitle.trim(),
        primaryColor,
        secondaryColor,
        imprintText: imprintText.trim(),
      }
      await put('/api/admin/branding', body, token)

      if (logoFile) {
        const fd = new FormData()
        fd.append('logo', logoFile)
        await apiRequest('/api/admin/branding/logo', { method: 'PUT', body: fd, token, isFormData: true })
      }

      setSuccess(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save branding.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Branding Settings">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Branding saved.</div>}

        <div className="grid grid-cols-2 gap-4">
          <Input label="Shop Name" value={shopName} onChange={(e) => setShopName(e.target.value)} required />
          <Input label="Subtitle" value={shopSubtitle} onChange={(e) => setShopSubtitle(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Primary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-14 rounded border border-slate-300 cursor-pointer p-0.5" />
              <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Secondary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)}
                className="h-9 w-14 rounded border border-slate-300 cursor-pointer p-0.5" />
              <input type="text" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">Logo</label>
          {logoPreview && (
            <div className="mb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoPreview} alt="Logo preview" className="h-16 object-contain rounded border border-slate-200 p-1" />
            </div>
          )}
          <input type="file" accept="image/*" onChange={handleLogoChange}
            className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">Imprint Text</label>
          <textarea value={imprintText} onChange={(e) => setImprintText(e.target.value)} rows={4}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Branding'}</Button>
        </div>
      </form>
    </Card>
  )
}
