import { ClerkProvider } from '@clerk/clerk-react'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { CLERK_KEY, ClerkBridge } from './lib/account'

/** Clerk (sign-in) when a publishable key is configured; without one the site runs guest-only. */
function Accounts({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  if (!CLERK_KEY) return <>{children}</>
  return (
    <ClerkProvider
      publishableKey={CLERK_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
    >
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Accounts>
        <App />
      </Accounts>
    </BrowserRouter>
  </StrictMode>,
)
