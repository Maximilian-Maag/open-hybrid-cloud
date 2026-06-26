'use client'

import { useState } from 'react'
import type { AiConfig, UpdateAiConfigRequest, AiProviderType } from '@open-hybrid-cloud/types'
import { put } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

const PROVIDERS: { value: AiProviderType; label: string }[] = [
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure_openai', label: 'Azure OpenAI' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'localai', label: 'LocalAI' },
]

interface Props {
  initial: AiConfig | null
  token: string
}

export function AiConfigForm({ initial, token }: Props) {
  const [provider, setProvider] = useState<AiProviderType>(initial?.provider ?? 'claude')
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? '')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(initial?.model ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setSuccess(false)
    try {
      const body: UpdateAiConfigRequest = {
        provider, endpoint: endpoint.trim(), model: model.trim(),
        ...(apiKey ? { apiKey } : {}),
      }
      await put('/api/admin/config/ai', body, token)
      setSuccess(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save AI config.')
    } finally {
      setSaving(false)
    }
  }

  const modelPlaceholder: Record<AiProviderType, string> = {
    claude: 'claude-opus-4-5',
    openai: 'gpt-4o',
    azure_openai: 'gpt-4o',
    ollama: 'llama3',
    localai: 'gpt-4',
  }

  return (
    <Card title="AI Provider Settings">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">AI configuration saved.</div>}

        <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value as AiProviderType)} options={PROVIDERS} />

        <Input label="API Endpoint" type="url" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://api.anthropic.com"
          hint="Leave blank to use the default endpoint for the selected provider" />

        <Input label="API Key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          hint={initial ? 'Leave blank to keep existing key' : undefined} />

        <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} required
          placeholder={modelPlaceholder[provider]} />

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Configuration'}</Button>
        </div>
      </form>
    </Card>
  )
}
