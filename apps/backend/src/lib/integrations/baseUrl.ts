import { z } from 'zod'

/**
 * What an integration's base URL is allowed to be.
 *
 * `z.string().url()` is not enough here for two separate reasons, and both of
 * them bite:
 *
 *   - **Userinfo.** `https://svc:hunter2@foreman.example.com` is a valid URL.
 *     The base URL is stored, returned by every read path, and interpolated into
 *     the audit label — so accepting one puts a password in the API response and
 *     in the audit log, which is the exact failure the encrypted `credential`
 *     column exists to avoid.
 *   - **Query and fragment.** The probe builds its target by concatenation, not
 *     `new URL(path, base)`, because the health paths are absolute and the
 *     two-argument form would discard a base's own path. So a base carrying
 *     `?foo=1` turns `…?foo=1/api/v2/status` into part of the query string and
 *     the probe silently checks the wrong thing.
 *
 * Rejected here rather than normalised away: an operator who pasted credentials
 * into the URL should be told, not quietly corrected into a URL that no longer
 * authenticates.
 */
export const integrationBaseUrl = () =>
  z
    .string()
    .url()
    .superRefine((value, ctx) => {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        return // z.string().url() already reported it
      }
      const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message })

      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        add(`Base URL must be http or https, not ${url.protocol.replace(':', '')}`)
      }
      if (url.username !== '' || url.password !== '') {
        add('Base URL must not embed credentials — use the credential field, which is encrypted')
      }
      if (url.search !== '') add('Base URL must not carry a query string')
      if (url.hash !== '') add('Base URL must not carry a fragment')
    })
