// Who is signed in, via Clerk. The app receives this as a dependency so tests can supply a fake.
import { clerkMiddleware, createClerkClient, getAuth } from '@clerk/express'
import { config, configured } from '../config.js'

/** Name, email and phone from a Clerk user (the phone number is kept in unsafeMetadata at sign-up). */
export function profileFromClerk(user) {
  if (!user) return {}
  const first = user.firstName ?? user.first_name ?? ''
  const last = user.lastName ?? user.last_name ?? ''
  const meta = user.unsafeMetadata ?? user.unsafe_metadata ?? {}
  const emails = user.emailAddresses ?? user.email_addresses ?? []
  const primaryEmailId = user.primaryEmailAddressId ?? user.primary_email_address_id
  const email = emails.find((e) => e.id === primaryEmailId) ?? emails[0]
  const phones = user.phoneNumbers ?? user.phone_numbers ?? []
  const phone = typeof meta.phone === 'string' && meta.phone ? meta.phone : phones[0]?.phoneNumber ?? phones[0]?.phone_number ?? ''
  return {
    fullName: [first, last].filter(Boolean).join(' ').trim() || (typeof meta.fullName === 'string' ? meta.fullName : ''),
    email: email?.emailAddress ?? email?.email_address ?? '',
    phone,
  }
}

export function clerkIdentity() {
  if (!configured.clerk()) {
    return {
      enabled: false,
      middleware: (_req, _res, next) => next(),
      userId: () => null,
      getUser: async () => null,
      updateUser: async () => null,
      deleteUser: async () => null,
    }
  }
  const client = createClerkClient({ secretKey: config.clerk.secretKey, publishableKey: config.clerk.publishableKey })
  return {
    enabled: true,
    middleware: clerkMiddleware({
      secretKey: config.clerk.secretKey,
      publishableKey: config.clerk.publishableKey,
      // Only session tokens issued to our own frontend are accepted.
      authorizedParties: config.allowedOrigins,
    }),
    userId: (req) => getAuth(req)?.userId ?? null,
    getUser: (id) => client.users.getUser(id),
    updateUser: (id, data) => client.users.updateUser(id, data),
    deleteUser: (id) => client.users.deleteUser(id),
  }
}
