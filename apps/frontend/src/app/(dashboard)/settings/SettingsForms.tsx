'use client'

import { useState } from 'react'
import type { UpdateProfileRequest, ChangePasswordRequest } from '@open-hybrid-cloud/types'
import { put } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface Props {
  token: string
  initialName: string
  email: string
}

export function SettingsForms({ token, initialName, email }: Props) {
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
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.')
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
      setPwError(err instanceof Error ? err.message : 'Failed to change password.')
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Profile">
        <form onSubmit={handleProfileSave} className="space-y-4">
          {profileError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{profileError}</div>
          )}
          {profileSuccess && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Profile updated.</div>
          )}
          <Input label="Email" type="email" value={email} disabled />
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex justify-end">
            <Button type="submit" disabled={profileSaving}>
              {profileSaving ? 'Saving…' : 'Save Profile'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Change Password">
        <form onSubmit={handlePasswordChange} className="space-y-4">
          {pwError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{pwError}</div>
          )}
          {pwSuccess && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Password changed successfully.</div>
          )}
          <Input
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={pwSaving}>
              {pwSaving ? 'Changing…' : 'Change Password'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
