export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; status: number; message: string }
export type Result<T> = Ok<T> | Err
export const ok = <T>(data: T): Ok<T> => ({ ok: true, data })
export const err = (status: number, message: string): Err => ({ ok: false, status, message })
