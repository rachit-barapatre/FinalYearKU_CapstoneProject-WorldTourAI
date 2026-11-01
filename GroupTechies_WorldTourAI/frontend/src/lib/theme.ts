import { useSyncExternalStore } from 'react'
import { useAccount } from './account'

/**
 * The light/dark theme lives on <html class="dark"> (set before React loads, see index.html), so
 * every part of the page reads that one source and stays in sync: the header button, the toasts,
 * the settings page and the preference saved on the account.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const isDark = () => document.documentElement.classList.contains('dark')

export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false)
}

/** Switch theme now, remember it on this device, and on the account when signed in. */
export function setTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem('wt-theme', dark ? 'dark' : 'light')
  } catch {
    /* applies for this visit */
  }
  const account = useAccount.getState()
  if (account.profile) void account.update({ preferences: { theme: dark ? 'dark' : 'light' } }).catch(() => undefined)
}
