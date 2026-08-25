'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Category, CreateProductRequest, Product } from '@open-hybrid-cloud/types'
import { post, PROXY_PREFIX } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { useLang } from '@/lib/useLang'
import { t, SUPPORTED_LANGUAGES } from '@/lib/i18n'

interface Props {
  categories: Category[]
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function NewProductForm({ categories }: Props) {
  const lang = useLang()
  // All 25, from the single list `SUPPORTED_LANGUAGES` — not the four this used
  // to name. Offering `en`, `de`, `fr` and `es` while the app translates its own
  // UI into 25 made a `pl`-only or `mt`-only product impossible to create, and
  // every read path outside the catalogue then had no name to show for it
  // (#162). Labelled in each language's own name, which is what the language
  // switcher does and what a reader who does not speak the UI language can find.
  const LANGUAGES = SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))
  const router = useRouter()
  const [image, setImage] = useState<File | null>(null)
  const [imageAlt, setImageAlt] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [baseLanguage, setBaseLanguage] = useState('en')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!categoryId) { setError(t('selectCategoryError', lang)); return }
    // Enforced here as well as on the server: an image without a description is
    // what makes every component downstream have to invent one.
    if (image && imageAlt.trim() === '') {
      setError(t('describeImageOrRemove', lang))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body: CreateProductRequest = {
        name: name.trim(),
        description: description.trim(),
        categoryId: Number(categoryId),
        baseLanguage,
      }
      const created = await post<Product>('/api/admin/products', body)

      // The image needs a product to belong to, so it goes up right after
      // creation rather than as part of it. It becomes the first picture of the
      // gallery; the rest are added on the edit page (issue #107). A failure here must not lose the
      // product that was just created — say so and continue to the edit page,
      // where the upload can be retried.
      let imageError: string | null = null
      if (image) {
        const upload = new FormData()
        upload.append('image', image)
        upload.append('alt', imageAlt.trim())
        // Through /api/proxy, which attaches the bearer token server-side — the
        // browser only ever holds the HttpOnly session cookie (#146). Not
        // `apiRequest`, because this needs the raw Response to read the
        // backend's own error message out of a failed upload.
        const res = await fetch(`${PROXY_PREFIX}/api/admin/products/${created.id}/images`, {
          method: 'POST',
          body: upload,
          cache: 'no-store',
        }).catch(() => null)

        if (!res || !res.ok) {
          const payload = res ? await res.json().catch(() => null) : null
          imageError = payload?.error ?? t('imageCouldNotBeUploaded', lang)
        }
      }

      router.push(`/admin/products/${created.id}${imageError ? `?imageError=${encodeURIComponent(imageError)}` : ''}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToCreateProduct', lang))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title={t('productDetails', lang)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert>{error}</Alert>
        )}
        <Select
          label={t('category', lang)}
          required
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          placeholder={t('selectCategoryPlaceholder', lang)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label={t('baseLanguage', lang)}
          value={baseLanguage}
          onChange={(e) => setBaseLanguage(e.target.value)}
          options={LANGUAGES}
        />
        <Input label={t('name', lang)} value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="flex flex-col gap-1">
          <label htmlFor="new-product-description" className="text-sm font-medium text-slate-700">{t('description', lang)}</label>
          <textarea
            id="new-product-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-product-image" className="text-sm font-medium text-slate-700">{t('image', lang)}</label>
          <input
            id="new-product-image"
            type="file"
            accept={IMAGE_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              // Refused here as well as on the server, so a 40 MB file is not
              // uploaded just to be rejected.
              if (file && file.size > MAX_IMAGE_BYTES) {
                setError(`${t('imageTooLargePrefix', lang)} ${(file.size / 1024 / 1024).toFixed(1)} ${t('mbLimitSuffix', lang)}`)
                setImage(null)
                e.target.value = ''
                return
              }
              setError(null)
              setImage(file)
            }}
            className="block text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
          />
          <p className="text-xs text-slate-500">{t('imageHintOptional', lang)}</p>
        </div>
        {image && (
          <Input
            label={t('imageDescriptionLabel', lang)}
            required
            value={imageAlt}
            maxLength={300}
            onChange={(e) => setImageAlt(e.target.value)}
            hint={t('imageDescriptionHint', lang)}
          />
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? t('creating', lang) : t('createProductButton', lang)}</Button>
        </div>
      </form>
    </Card>
  )
}
