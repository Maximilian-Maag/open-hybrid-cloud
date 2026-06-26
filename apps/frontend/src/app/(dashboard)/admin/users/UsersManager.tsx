'use client'

import { useState, useEffect, useCallback } from 'react'
import type { User, Role, CreateUserRequest, UpdateUserRequest } from '@open-hybrid-cloud/types'
import { get, post, put, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface Props { token: string }

const ROLES: { value: Role; label: string }[] = [
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'root', label: 'Root' },
]

const roleBadge: Record<Role, string> = {
  project_manager: 'bg-slate-100 text-slate-600',
  admin: 'bg-blue-100 text-blue-700',
  root: 'bg-purple-100 text-purple-700',
}

export function UsersManager({ token }: Props) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [formEmail, setFormEmail] = useState('')
  const [formName, setFormName] = useState('')
  const [formRole, setFormRole] = useState<Role>('project_manager')
  const [formPassword, setFormPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers((await get<User[]>('/api/admin/users', token)) ?? [])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setFormEmail(''); setFormName(''); setFormRole('project_manager'); setFormPassword(''); setFormError(null); setAddOpen(true)
  }

  function openEdit(user: User) {
    setFormName(user.name); setFormRole(user.role); setFormPassword(''); setFormError(null); setEditTarget(user)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setFormError(null)
    try {
      const body: CreateUserRequest = {
        email: formEmail.trim(),
        name: formName.trim(),
        role: formRole,
        password: formPassword,
      }
      await post('/api/admin/users', body, token)
      setAddOpen(false); load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setSaving(true); setFormError(null)
    try {
      const body: UpdateUserRequest = { name: formName.trim(), role: formRole }
      await put(`/api/admin/users/${editTarget.id}`, body, token)
      setEditTarget(null); load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await del(`/api/admin/users/${deleteTarget.id}`, token)
      setDeleteTarget(null); load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user: User) {
    try {
      await put(`/api/admin/users/${user.id}`, { active: !user.active } satisfies UpdateUserRequest, token)
      load()
    } catch { /* ignore */ }
  }

  return (
    <>
      <Card title="Users" action={<Button size="sm" onClick={openAdd}>Add User</Button>}>
        {loading ? (
          <div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" /></div>
        ) : users.length === 0 ? (
          <p className="text-center py-6 text-slate-400">No users yet.</p>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2 w-2 rounded-full ${user.active ? 'bg-green-500' : 'bg-slate-300'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">{user.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge[user.role]}`}>
                        {user.role.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(user)}>
                    {user.active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(user)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(user)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add User" size="md">
        <form onSubmit={handleAdd} className="space-y-4">
          {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
          <Input label="Email" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} required />
          <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} required />
          <Select label="Role" value={formRole} onChange={(e) => setFormRole(e.target.value as Role)} options={ROLES} />
          <Input label="Password" type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} required />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit User" size="md">
        <form onSubmit={handleEdit} className="space-y-4">
          {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
          <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} required />
          <Select label="Role" value={formRole} onChange={(e) => setFormRole(e.target.value as Role)} options={ROLES} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete User" size="sm">
        <p className="text-sm text-slate-600 mb-6">Delete user <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email})?</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </Modal>
    </>
  )
}
