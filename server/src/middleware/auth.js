import { connectDatabase } from '../db.js'
import { profileFromClerk } from '../lib/identity.js'
import { User } from '../models/User.js'
import { HttpError } from './errors.js'

/**
 * Requires a signed-in user and loads (or creates) their record as req.user. The record is normally
 * created by Clerk's user.created webhook; creating it here too means a slow webhook never blocks anyone.
 */
export function requireUser(identity) {
  return async (req, _res, next) => {
    try {
      if (!identity.enabled) throw new HttpError(503, 'Sign-in is not configured on this server yet.')
      const clerkId = identity.userId(req)
      if (!clerkId) {
        // A token was sent but not accepted (expired, wrong origin, wrong key) is not the same as no sign-in at all.
        if (/^Bearer\s+\S+/i.test(req.headers?.authorization ?? '')) {
          const reason = await identity.diagnose?.(req.headers.authorization.replace(/^Bearer\s+/i, '')).catch(() => 'diagnosis failed')
          console.warn('[auth] a session token was sent but not accepted (origin: %s) reason: %s', req.headers?.origin ?? 'none', reason ?? 'not available')
          throw new HttpError(401, "We couldn't verify your sign-in. Refresh the page; if it keeps happening, sign out and back in.")
        }
        throw new HttpError(401, 'Please sign in to continue.')
      }
      await connectDatabase()
      let user = await User.findOne({ clerkId })
      if (!user) {
        const profile = profileFromClerk(await identity.getUser(clerkId).catch(() => null))
        try {
          user = await User.findOneAndUpdate(
            { clerkId },
            { $setOnInsert: { clerkId, ...profile } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
        } catch (error) {
          // A first page load fires several requests at once; one of them may create the record a moment before this
          // one tries to (MongoDB reports a duplicate key). The record exists then, so use it instead of failing.
          if (error?.code !== 11000) throw error
          user = await User.findOne({ clerkId })
          if (!user) throw error
        }
      }
      // Record activity at most once a minute, without making the request wait for the write.
      if (Date.now() - (user.lastActiveAt?.getTime() ?? 0) > 60_000) {
        const now = new Date()
        User.updateOne({ _id: user._id }, { $set: { lastActiveAt: now } }).catch(() => undefined)
        user.lastActiveAt = now
      }
      req.user = user
      req.clerkId = clerkId
      next()
    } catch (error) {
      next(error)
    }
  }
}
