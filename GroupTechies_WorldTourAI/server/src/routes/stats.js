import { Router } from 'express'
import { requireUser } from '../middleware/auth.js'
import { Trip } from '../models/Trip.js'

/** GET /api/stats: numbers for the profile page. */
export function statsRoutes({ identity }) {
  const router = Router()
  router.use(requireUser(identity))
  router.get('/', async (req, res) => {
    const userId = req.user._id
    const since = new Date()
    since.setMonth(since.getMonth() - 5, 1)
    since.setHours(0, 0, 0, 0)
    const [counts, places, spend, recent, months] = await Promise.all([
      Trip.aggregate([
        { $match: { user: userId } },
        {
          $group: {
            _id: null,
            trips: { $sum: 1 },
            planned: { $sum: { $cond: [{ $gt: [{ $size: '$versions' }, 0] }, 1, 0] } },
            favorites: { $sum: { $cond: ['$favorite', 1, 0] } },
            plansGenerated: { $sum: { $size: '$versions' } },
            prompts: { $sum: { $size: { $filter: { input: '$messages', cond: { $eq: ['$$this.role', 'user'] } } } } },
            days: { $sum: { $ifNull: ['$durationDays', 0] } },
            shared: { $sum: { $cond: [{ $eq: ['$share.enabled', true] }, 1, 0] } },
          },
        },
      ]),
      Trip.aggregate([
        { $match: { user: userId, destination: { $nin: ['', null, 'Multi-city'] } } },
        { $group: { _id: '$destination', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Trip.aggregate([
        { $match: { user: userId, estimatedCost: { $ne: null }, currency: { $ne: '' } } },
        { $group: { _id: '$currency', amount: { $sum: '$estimatedCost' } } },
        { $sort: { amount: -1 } },
      ]),
      Trip.find({ user: userId, status: { $ne: 'archived' } }).sort({ updatedAt: -1 }).limit(4).select('-session -selection -versions.plan -messages.content -notes'),
      // Trips started per month, last 6 months (the activity chart on the profile).
      Trip.aggregate([
        { $match: { user: userId, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, trips: { $sum: 1 } } },
      ]),
    ])
    const perMonth = Object.fromEntries(months.map((m) => [m._id, m.trips]))
    const activity = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(since.getFullYear(), since.getMonth() + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { month: key, trips: perMonth[key] ?? 0 }
    })
    const totals = counts[0] ?? { trips: 0, planned: 0, favorites: 0, plansGenerated: 0, prompts: 0, days: 0, shared: 0 }
    res.json({
      stats: {
        trips: totals.trips,
        planned: totals.planned,
        favorites: totals.favorites,
        plansGenerated: totals.plansGenerated,
        prompts: totals.prompts,
        daysPlanned: totals.days,
        destinations: places.length,
        topDestination: places[0]?._id ?? null,
        budgetPlanned: spend.map((row) => ({ currency: row._id, amount: row.amount })),
        shared: totals.shared,
        places: places.slice(0, 12).map((row) => ({ name: row._id, trips: row.count })),
        activity,
      },
      recent: recent.map((t) => t.toSummary()),
    })
  })
  return router
}
