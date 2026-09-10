/**
 * Guard for a PUT/PATCH body that names no fields at all.
 *
 * Every admin update schema is all-optional — which is right, since a partial
 * update should not have to resend the fields it is not changing — so a
 * well-formed `{}` passes Zod and reaches Drizzle's `.set({})`. `mapUpdateSet`
 * throws "No values to set" there, which escapes the route as an unhandled 500.
 * `PUT /api/projects/{id}` with `{}` was reachable by any project manager on
 * their own project (issue #143).
 *
 * `undefined` values count as absent: `{ name: undefined }` is what a caller
 * that spreads an optional field produces, and Drizzle drops those too, so the
 * same empty `.set()` is what would reach the database.
 */
export const isEmptyUpdate = (input: object): boolean =>
  Object.values(input).every((value) => value === undefined)

/** The message every empty-update rejection uses, so they read alike. */
export const EMPTY_UPDATE_MESSAGE = 'No fields to update'
