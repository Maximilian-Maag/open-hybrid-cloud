'use client'

import { useState } from 'react'
import type { OrderComment, CreateOrderCommentRequest } from '@open-hybrid-cloud/types'
import { post, put, del } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { t } from '@/lib/i18n'

interface Props {
  orderId: number
  initialComments: OrderComment[]
  /** Id of the signed-in user — only an author may edit or delete their own comment. */
  currentUserId: number
  /** Whether the signed-in user may mark a comment internal. */
  canWriteInternal: boolean
  token: string
  lang: string
}

const MAX_LENGTH = 4000

/**
 * Comment thread on an order (issue #34).
 *
 * The list is seeded from the server render and then maintained locally, so
 * posting does not cost a round trip through the whole page. Internal notes are
 * already absent from `initialComments` for a caller who may not see them — the
 * API filters them out — so nothing here has to hide anything.
 */
export function OrderComments({
  orderId,
  initialComments,
  currentUserId,
  canWriteInternal,
  token,
  lang,
}: Props) {
  const [comments, setComments] = useState(initialComments)
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editBody, setEditBody] = useState('')

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setPosting(true)
    setError(null)
    try {
      const payload: CreateOrderCommentRequest = { body: body.trim(), ...(internal ? { internal: true } : {}) }
      const created = await post<OrderComment>(`/api/orders/${orderId}/comments`, payload, token)
      setComments((prev) => [...prev, created])
      setBody('')
      setInternal(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post the comment.')
    } finally {
      setPosting(false)
    }
  }

  async function handleSaveEdit(commentId: number) {
    if (!editBody.trim()) return
    setError(null)
    try {
      const updated = await put<OrderComment>(
        `/api/orders/${orderId}/comments/${commentId}`,
        { body: editBody.trim() },
        token,
      )
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)))
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the comment.')
    }
  }

  async function handleDelete(commentId: number) {
    setError(null)
    try {
      await del(`/api/orders/${orderId}/comments/${commentId}`, token)
      setComments((prev) => prev.filter((c) => c.id !== commentId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the comment.')
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {comments.length === 0 ? (
        <p className="text-sm text-slate-600">{t('noComments', lang)}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              data-testid={`comment-${comment.id}`}
              className={`rounded-lg border p-3 ${
                comment.internal ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-900">
                    {comment.userName ?? `User #${comment.userId}`}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(comment.createdAt).toLocaleString(lang)}
                  </span>
                  {comment.edited && (
                    <span className="text-xs italic text-slate-500">({t('edited', lang)})</span>
                  )}
                  {comment.internal && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {t('internalNote', lang)}
                    </span>
                  )}
                </div>
                {/* Only the author gets these — the server enforces it too. */}
                {comment.userId === currentUserId && editingId !== comment.id && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditingId(comment.id); setEditBody(comment.body) }}
                    >
                      {t('edit', lang)}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(comment.id)}>
                      {t('delete', lang)}
                    </Button>
                  </div>
                )}
              </div>

              {editingId === comment.id ? (
                <div className="space-y-2">
                  <label className="sr-only" htmlFor={`edit-${comment.id}`}>{t('edit', lang)}</label>
                  <textarea
                    id={`edit-${comment.id}`}
                    value={editBody}
                    maxLength={MAX_LENGTH}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSaveEdit(comment.id)} disabled={!editBody.trim()}>
                      {t('saveChanges', lang)}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                      {t('cancel', lang)}
                    </Button>
                  </div>
                </div>
              ) : (
                // pre-wrap so a multi-line comment reads as written; React escapes
                // the text, so this cannot render markup.
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{comment.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handlePost} className="space-y-2 border-t border-slate-100 pt-4">
        <label htmlFor="new-comment" className="text-sm font-medium text-slate-700">
          {t('addComment', lang)}
        </label>
        <textarea
          id="new-comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('commentPlaceholder', lang)}
          rows={3}
          maxLength={MAX_LENGTH}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {canWriteInternal && (
          <div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="comment-internal"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="comment-internal" className="text-sm font-medium text-slate-700">
                {t('internalNote', lang)}
              </label>
            </div>
            <p className="mt-1 ml-6 text-xs text-slate-500">{t('internalNoteHint', lang)}</p>
          </div>
        )}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={posting || !body.trim()}>
            {posting ? t('posting', lang) : t('addComment', lang)}
          </Button>
        </div>
      </form>
    </div>
  )
}
