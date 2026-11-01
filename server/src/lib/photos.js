// Profile photos on Cloudinary. The browser uploads straight to Cloudinary with a short-lived signature
// from this server, so the API secret never leaves the server and photos never pass through it.
import { v2 as cloudinary } from 'cloudinary'
import { config, configured } from '../config.js'

export function cloudinaryPhotos() {
  if (!configured.cloudinary()) {
    return { enabled: false, sign: () => null, destroy: async () => undefined, ownsUrl: () => false }
  }
  cloudinary.config({ cloud_name: config.cloudinary.cloudName, api_key: config.cloudinary.apiKey, api_secret: config.cloudinary.apiSecret, secure: true })
  return {
    enabled: true,
    /** Signed parameters for one upload, to a public id that belongs to this user only. */
    sign(clerkId) {
      const timestamp = Math.round(Date.now() / 1000)
      const publicId = `${config.cloudinary.folder}/${safe(clerkId)}-${timestamp}`
      const params = { public_id: publicId, timestamp, overwrite: true }
      const signature = cloudinary.utils.api_sign_request(params, config.cloudinary.apiSecret)
      return {
        uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/image/upload`,
        cloudName: config.cloudinary.cloudName,
        apiKey: config.cloudinary.apiKey,
        timestamp,
        publicId,
        signature,
        overwrite: true,
      }
    },
    async destroy(publicId) {
      if (!publicId) return
      try {
        await cloudinary.uploader.destroy(publicId, { invalidate: true })
      } catch (error) {
        console.warn('[photos] could not delete', publicId, error?.message)
      }
    },
    ownsUrl(url, publicId) {
      return typeof url === 'string' && url.startsWith(`https://res.cloudinary.com/${config.cloudinary.cloudName}/image/upload/`) && url.includes(publicId)
    },
  }
}

/** The public id prefix every photo of this user must have. */
export function photoPrefix(clerkId) {
  return `${config.cloudinary.folder}/${safe(clerkId)}-`
}

/** A square, face-centred, compressed version of an uploaded photo for avatars. */
export function avatarUrl(url) {
  return url.replace('/image/upload/', '/image/upload/c_fill,g_face,w_256,h_256,q_auto,f_auto/')
}

const safe = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '')
