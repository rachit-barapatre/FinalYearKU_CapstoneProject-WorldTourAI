import { Router } from 'express'
import { z } from 'zod'
import { requireUser } from '../middleware/auth.js'
import { HttpError, parse } from '../middleware/errors.js'
import { profileFromClerk } from '../lib/identity.js'
import { avatarUrl, photoPrefix } from '../lib/photos.js'
import { Trip } from '../models/Trip.js'
import { User } from '../models/User.js'

const phone = z
  .string()
  .trim()
  .max(20)
  .regex(/^$|^\+?[0-9][0-9\s-]{6,18}$/, 'enter a valid phone number, e.g. +91 98765 43210')

const profileUpdate = z.object({
  fullName: z.string().trim().min(2, 'enter your full name').max(120).optional(),
  phone: phone.optional(),
  preferences: z
    .object({
      homeCity: z.string().trim().max(80).optional(),
      currency: z.string().trim().regex(/^$|^[A-Za-z]{3}$/, 'use a 3-letter code such as INR').optional(),
      language: z.enum(['en', 'hi', 'gu', 'mr']).optional(),
      theme: z.enum(['system', 'light', 'dark']).optional(),
      readAloud: z.boolean().optional(),
    })
    .optional(),
})

const photoUpdate = z.object({ publicId: z.string().min(3).max(200), url: z.url().max(500) })

export function meRoutes({ identity, photos }) {
  const router = Router()
  router.use(requireUser(identity))

  router.get('/', (req, res) => res.json({ user: req.user.toPublic(), photos: photos.enabled }))

  router.patch('/', async (req, res) => {
    const body = parse(profileUpdate, req.body)
    const user = req.user
    if (body.fullName !== undefined && body.fullName !== user.fullName) {
      user.fullName = body.fullName
      // Keep the name on the Clerk account in step (best effort).
      const [firstName, ...rest] = body.fullName.split(/\s+/)
      await identity.updateUser(req.clerkId, { firstName, lastName: rest.join(' ') }).catch(() => undefined)
    }
    if (body.phone !== undefined) user.phone = body.phone
    for (const [key, value] of Object.entries(body.preferences ?? {})) user.preferences[key] = key === 'currency' ? value.toUpperCase() : value
    await user.save()
    res.json({ user: user.toPublic() })
  })

  // After a change made through Clerk (e.g. a new email address), copy the name and email again.
  router.post('/refresh', async (req, res) => {
    const profile = profileFromClerk(await identity.getUser(req.clerkId).catch(() => null))
    if (profile.email) req.user.email = profile.email
    if (profile.fullName) req.user.fullName = profile.fullName
    await req.user.save()
    res.json({ user: req.user.toPublic() })
  })

  router.post('/onboarding', async (req, res) => {
    req.user.onboarded = true
    await req.user.save()
    res.json({ user: req.user.toPublic() })
  })

  // ---------------------------------------------------------------- profile photo (Cloudinary)
  router.post('/photo/sign', (req, res) => {
    if (!photos.enabled) throw new HttpError(503, 'Photo uploads are not configured on this server yet.')
    res.json(photos.sign(req.clerkId))
  })

  router.patch('/photo', async (req, res) => {
    if (!photos.enabled) throw new HttpError(503, 'Photo uploads are not configured on this server yet.')
    const { publicId, url } = parse(photoUpdate, req.body)
    if (!publicId.startsWith(photoPrefix(req.clerkId)) || !photos.ownsUrl(url, publicId)) {
      throw new HttpError(400, 'That photo does not belong to your account.')
    }
    const previous = req.user.photo?.publicId
    req.user.photo = { url: avatarUrl(url), publicId }
    req.user.onboarded = true
    await req.user.save()
    if (previous && previous !== publicId) await photos.destroy(previous)
    res.json({ user: req.user.toPublic() })
  })

  router.delete('/photo', async (req, res) => {
    const previous = req.user.photo?.publicId
    req.user.photo = { url: '', publicId: '' }
    await req.user.save()
    await photos.destroy(previous)
    res.json({ user: req.user.toPublic() })
  })

  // ---------------------------------------------------------------- delete the account and everything in it
  router.delete('/', async (req, res) => {
    const user = req.user
    await photos.destroy(user.photo?.publicId)
    await Trip.deleteMany({ user: user._id })
    await User.deleteOne({ _id: user._id })
    await identity.deleteUser(req.clerkId).catch((error) => {
      // Already removed in Clerk (e.g. deleted from the Clerk dashboard) is fine.
      if (error?.status !== 404) throw error
    })
    res.json({ deleted: true })
  })

  return router
}
