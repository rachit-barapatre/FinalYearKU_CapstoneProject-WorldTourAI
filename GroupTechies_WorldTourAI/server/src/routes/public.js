import { Router } from 'express'
import { Webhook } from 'svix'
import { config, configured } from '../config.js'
import { connectDatabase, databaseState } from '../db.js'
import { profileFromClerk } from '../lib/identity.js'
import { HttpError } from '../middleware/errors.js'
import { Trip } from '../models/Trip.js'
import { User } from '../models/User.js'

/** GET /api/health: which services are configured and whether the database answers (never the keys). */
export function healthRoute() {
  const router = Router()
  router.get('/', async (_req, res) => {
    let database = configured.database() ? 'connecting' : 'not configured'
    if (configured.database()) {
      try {
        await connectDatabase()
        database = databaseState()
      } catch {
        database = 'unreachable'
      }
    }
    res.json({
      status: 'ok',
      database,
      clerk: configured.clerk(),
      clerkWebhook: configured.webhook(),
      cloudinary: configured.cloudinary(),
      allowedOrigins: config.allowedOrigins,
    })
  })
  return router
}

/** GET /api/share/:shareId: a trip someone chose to share, read-only. No conversation, no account details. */
export function shareRoute() {
  const router = Router()
  router.get('/:shareId', async (req, res) => {
    await connectDatabase()
    const trip = await Trip.findOne({ 'share.id': String(req.params.shareId), 'share.enabled': true }).populate('user', 'fullName photo')
    if (!trip || !trip.versions.length) throw new HttpError(404, 'This shared trip is no longer available.')
    const latest = trip.versions.at(-1)
    res.json({
      trip: {
        title: trip.title,
        sharedBy: (trip.user?.fullName || 'A WorldTour traveler').split(/\s+/)[0],
        sharedByPhoto: trip.user?.photo?.url || '',
        plan: latest.plan,
        selection: trip.selection,
        plannedAt: latest.createdAt,
      },
    })
  })
  return router
}

/**
 * POST /api/webhooks/clerk: Clerk tells us when an account is created, changed or deleted.
 * The signature is checked with the signing secret, so nobody else can call it.
 */
export function clerkWebhookRoute({ photos }) {
  const router = Router()
  router.post('/', async (req, res) => {
    if (!configured.webhook()) throw new HttpError(503, 'CLERK_WEBHOOK_SIGNING_SECRET is not set.')
    let event
    try {
      const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {})
      event = new Webhook(config.clerk.webhookSecret).verify(payload, {
        'svix-id': req.get('svix-id') ?? '',
        'svix-timestamp': req.get('svix-timestamp') ?? '',
        'svix-signature': req.get('svix-signature') ?? '',
      })
    } catch {
      throw new HttpError(400, 'Invalid webhook signature.')
    }
    await connectDatabase()
    const data = event?.data ?? {}
    if (event.type === 'user.created' || event.type === 'user.updated') {
      const profile = profileFromClerk(data)
      const update = { fullName: profile.fullName, email: profile.email }
      // The phone typed at sign-up arrives with the account; later edits are made in Settings.
      const existing = await User.findOne({ clerkId: data.id })
      if (!existing?.phone && profile.phone) update.phone = profile.phone
      await User.findOneAndUpdate({ clerkId: data.id }, { $set: update, $setOnInsert: { clerkId: data.id } }, { upsert: true, setDefaultsOnInsert: true })
    } else if (event.type === 'user.deleted' && data.id) {
      const user = await User.findOne({ clerkId: data.id })
      if (user) {
        await photos.destroy(user.photo?.publicId)
        await Trip.deleteMany({ user: user._id })
        await user.deleteOne()
      }
    }
    res.json({ received: true })
  })
  return router
}
