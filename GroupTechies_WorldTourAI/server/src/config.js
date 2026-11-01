// Settings from environment variables (server/.env locally, Vercel → Environment Variables in production).
// Nothing here is ever sent to the browser.

const list = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean)

export const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || '',
  clerk: {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || '',
    secretKey: process.env.CLERK_SECRET_KEY || '',
    webhookSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET || '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: (process.env.CLOUDINARY_FOLDER || 'worldtour/avatars').replace(/^\/+|\/+$/g, ''),
  },
  allowedOrigins: list(process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173'),
  appUrl: (process.env.APP_URL || 'https://worldtour-xi.vercel.app').replace(/\/$/, ''),
  // Limits that keep one trip document well under MongoDB's 16 MB.
  maxMessages: 400,
  maxVersions: 15,
}

export const configured = {
  database: () => !!config.mongoUri,
  clerk: () => !!config.clerk.secretKey && !!config.clerk.publishableKey,
  webhook: () => !!config.clerk.webhookSecret,
  cloudinary: () => !!(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret),
}
