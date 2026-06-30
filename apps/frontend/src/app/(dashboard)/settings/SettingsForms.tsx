'use client'

import { useState } from 'react'
import type { UpdateProfileRequest, ChangePasswordRequest } from '@open-hybrid-cloud/types'
import { put } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

interface Props {
  token: string
  initialName: string
  email: string
}

export function SettingsForms({ token, initialName, email }: Props) {
  const lang = useLang()
  const [name, setName] = useState(initialName)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    setProfileSaving(true)
    setProfileError(null)
    setProfileSuccess(false)
    try {
      const body: UpdateProfileRequest = { name: name.trim() }
      await put('/api/users/me', body, token)
      setProfileSuccess(true)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : t('failedToUpdateProfile', lang))
    } finally {
      setProfileSaving(false)
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setPwError(t('passwordsDoNotMatch', lang))
      return
    }
    setPwSaving(true)
    setPwError(null)
    setPwSuccess(false)
    try {
      const body: ChangePasswordRequest = { currentPassword, newPassword }
      await put('/api/users/me/password', body, token)
      setPwSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPwError(err instanceof Error ? err.message : t('failedToChangePassword', lang))
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card title={t('profileTitle', lang)}>
        <form onSubmit={handleProfileSave} className="space-y-4">
          {profileError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{profileError}</div>
          )}
          {profileSuccess && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{t('profileUpdated', lang)}</div>
          )}
          <Input label={t('email', lang)} type="email" value={email} disabled />
          <Input label={t('name', lang)} value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex justify-end">
            <Button type="submit" disabled={profileSaving}>
              {profileSaving ? t('saving', lang) : t('saveProfile', lang)}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={t('changePassword', lang)}>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          {pwError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{pwError}</div>
          )}
          {pwSuccess && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{t('passwordChanged', lang)}</div>
          )}
          <Input
            label={t('currentPassword', lang)}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            label={t('newPassword', lang)}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <Input
            label={t('confirmNewPassword', lang)}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={pwSaving}>
              {pwSaving ? t('changing', lang) : t('changePassword', lang)}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
