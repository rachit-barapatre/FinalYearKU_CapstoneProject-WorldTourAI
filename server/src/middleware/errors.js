import { ZodError } from 'zod'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Parse a request part with a zod schema, or answer 400 with the first problem in plain words. */
export function parse(schema, value) {
  const result = schema.safeParse(value ?? {})
  if (!result.success) throw result.error
  return result.data
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found.' })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    const issue = error.issues[0]
    const field = issue?.path?.join('.') || 'request'
    return res.status(400).json({ error: `${field}: ${issue?.message ?? 'invalid value'}` })
  }
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' })
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' })
  if (error?.name === 'CastError') return res.status(404).json({ error: 'Not found.' })
  const status = Number(error?.status) || 500
  // 503 means "not configured / database unreachable": expected until keys are set, so no stack trace.
  if (status >= 500 && status !== 503) console.error('[server]', error)
  else if (status === 503) console.warn('[server]', error.message)
  res.status(status).json({ error: status >= 500 && status !== 503 ? 'Something went wrong on our side. Please try again.' : error.message })
}
