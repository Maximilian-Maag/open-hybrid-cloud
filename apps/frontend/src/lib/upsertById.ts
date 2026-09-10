/**
 * Put a just-created or just-updated record into a list, by identity.
 *
 * The obvious `[...prev, created]` is wrong whenever the same list is also
 * loaded by a fetch that REPLACES it, and both are true of every list in
 * `ProductEditForm`: a `useEffect` on mount does `.then(setStacks)`, and the
 * create handler appends. Nothing orders those two against each other.
 *
 * The losing interleaving is not exotic. The create commits on the server, the
 * mount fetch is served after it and so comes back already containing the new
 * record, its `.then` replaces the list — and only then does the POST's own
 * `.then` run and append the same record a second time. The row is drawn twice,
 * both copies sharing a React `key`, until something reloads the page (#384).
 *
 * It takes a slow first paint to lose that race, which is precisely what
 * `next dev` serves on a cold route: CI hit it on a 1298 ms mount fetch, and a
 * warm browser essentially never does. That asymmetry is the reason to fix it
 * by construction rather than to wait for a reproduction.
 *
 * Replacing in place rather than appending also keeps the server's ordering:
 * the list a fetch just installed is the order the backend returns, and moving
 * a record to the end because it happened to be the one edited would reshuffle
 * the page under the reader.
 */
export const upsertById = <T extends { id: number }>(list: readonly T[], record: T): T[] =>
  list.some((item) => item.id === record.id)
    ? list.map((item) => (item.id === record.id ? record : item))
    : [...list, record]
