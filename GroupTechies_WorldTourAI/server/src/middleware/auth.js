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
      if (!clerkId) throw new HttpError(401, 'Please sign in to continue.')
      await connectDatabase()
      let user = await User.findOne({ clerkId })
      if (!user) {
        const profile = profileFromClerk(await identity.getUser(clerkId).catch(() => null))
        user = await User.findOneAndUpdate(
          { clerkId },
          { $setOnInsert: { clerkId, ...profile } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
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
