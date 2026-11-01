import clsx from 'clsx'
import { Check, Copy, Globe2, Link2, Lock, Loader2, Share2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { server } from '../lib/account'
import { toast } from '../lib/toast'

interface ShareState {
  enabled: boolean
  url: string | null
  canShare?: boolean
}

/**
 * "Share trip" box, like sharing a chat in ChatGPT: a preview of what others will see, then a
 * public link to copy. Anyone with the link sees the whole itinerary on a read-only page (no
 * conversation, notes or account details). The link stays the same if sharing is turned off and on.
 */
export function ShareDialog({
  tripId,
  title,
  subtitle,
  onClose,
  onChange,
}: {
  tripId: string
  title: string
  subtitle?: string
  onClose: () => void
  /** Called when sharing is turned on or off, so lists can update their badge. */
  onChange?: (enabled: boolean) => void
}) {
  const [share, setShare] = useState<ShareState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const linkRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    server<{ share: ShareState }>(`/api/trips/${tripId}/share`)
      .then(({ share }) => setShare(share))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the sharing settings.'))
  }, [tripId])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard blocked (e.g. an insecure page): select the text so Ctrl+C works.
      linkRef.current?.select()
      toast.info('Press Ctrl+C to copy the selected link.')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    toast.success('Link copied. Anyone with it can view this trip.')
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const { share: next } = await server<{ share: ShareState }>(`/api/trips/${tripId}/share`, { method: 'POST' })
      setShare(next)
      onChange?.(true)
      if (next.url) await copy(next.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be created.')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    setError(null)
    try {
      const { share: next } = await server<{ share: ShareState }>(`/api/trips/${tripId}/share`, { method: 'DELETE' })
      setShare({ ...next, canShare: true })
      onChange?.(false)
      toast.info('Sharing turned off. The old link no longer opens this trip.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sharing could not be turned off.')
    } finally {
      setBusy(false)
    }
  }

  const nativeShare = async (url: string) => {
    try {
      await navigator.share({ title: `${title} · WorldTour`, text: `My trip plan: ${title}`, url })
    } catch {
      /* closed by the user */
    }
  }

  const url = share?.enabled ? share.url : null
  const whatsapp = url ? `https://wa.me/?text=${encodeURIComponent(`My trip plan: ${title}\n${url}`)}` : ''

  return createPortal(
    <div className="fixed inset-0 z-[3000] flex items-end justify-center p-4 sm:items-center" role="presentation">
      <div className="absolute inset-0 animate-[fade-in_0.15s_ease-out] bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="share-title" className="relative w-full max-w-lg animate-fade-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-800">
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-6">
          <div>
            <h2 id="share-title" className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><Share2 size={18} /> Share trip</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {url ? 'Anyone with this link can view the full itinerary.' : 'Create a public link to this itinerary. Your chat, notes and account details stay private.'}
            </p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="-mr-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"><X size={18} /></button>
        </div>

        {/* What other people will see */}
        <div className="mx-5 overflow-hidden rounded-xl border border-slate-200 sm:mx-6 dark:border-white/10">
          <div className="bg-gradient-to-br from-brand-800 to-brand-950 px-4 py-5 text-white">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">WorldTour itinerary</div>
            <div className="mt-1 line-clamp-2 font-display text-lg font-bold">{title}</div>
            {subtitle && <div className="mt-0.5 truncate text-sm text-white/75">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">
            {url ? <Globe2 size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Lock size={14} />}
            {url ? 'Public · read-only · nobody can edit it' : 'Private · only you can see this trip'}
          </div>
        </div>

        <div className="px-5 pb-5 pt-4 sm:px-6">
          {error && <p className="mb-3 text-sm font-medium text-rose-600 dark:text-rose-300">{error}</p>}
          {!share && !error ? (
            <div className="flex h-12 items-center justify-center text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /></div>
          ) : url ? (
            <>
              <label htmlFor="share-link" className="sr-only">Share link</label>
              <div className="flex items-center gap-2 rounded-full border border-slate-300 bg-white p-1.5 pl-4 focus-within:border-brand-500 dark:border-white/15 dark:bg-ink-900">
                <Link2 size={16} className="shrink-0 text-slate-400" />
                <input id="share-link" ref={linkRef} readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-slate-800 outline-none dark:text-slate-100" />
                <button
                  onClick={() => void copy(url)}
                  className={clsx('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white transition', copied ? 'bg-emerald-600' : 'bg-brand-700 hover:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-400')}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">WhatsApp</a>
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">Preview</a>
                {typeof navigator.share === 'function' && (
                  <button onClick={() => void nativeShare(url)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">More…</button>
                )}
                <button onClick={() => void stop()} disabled={busy} className="ml-auto text-sm font-semibold text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-300">Stop sharing</button>
              </div>
            </>
          ) : share ? (
            <button
              onClick={() => void create()}
              disabled={busy || share.canShare === false}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-700 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
              {share.canShare === false ? 'Plan the trip first, then share it' : busy ? 'Creating link…' : 'Create link'}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
