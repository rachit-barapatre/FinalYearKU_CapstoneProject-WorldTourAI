import clsx from 'clsx'
import { AlertTriangle, CalendarDays, Check, RefreshCw, Sparkles, Volume2, VolumeX, WifiOff, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useActivePlan, useStore } from '../store'
import { Composer } from './Composer'
import { DatePicker } from './DatePicker'
import { MessageContent } from './MessageContent'
import { Select } from './Select'
import { LANGUAGES, packageLabel, speechCode, t, WELCOMES, type Lang } from '../lib/i18n'
import { useProgress } from '../lib/progress'
import { hasVoice, speak, stopSpeaking, useVoicesReady } from '../lib/voice'

const READ_ALOUD_KEY = 'wt-read-aloud'

function savedReadAloud(): boolean {
  try {
    return localStorage.getItem(READ_ALOUD_KEY) === '1'
  } catch {
    return false
  }
}

function time(at?: string) {
  if (!at) return ''
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/** Whether the browser currently has a network connection. */
function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
}

function AssistantAvatar({ small = false }: { small?: boolean }) {
  return (
    <div className={clsx('grid shrink-0 place-items-center rounded-full bg-brand-800 text-white shadow-sm dark:bg-brand-500', small ? 'h-7 w-7' : 'h-9 w-9')}>
      <Sparkles size={small ? 13 : 16} />
    </div>
  )
}

export function ChatPanel() {
  const { messages, status, error, notice, send, retry, dismissError, plan, session, language, setLanguage } = useStore()
  const lang = language ?? 'en'
  const say = (key: Parameters<typeof t>[1], values?: Record<string, string | number>) => t(lang, key, values)
  // A saved welcome in any language is shown in the chosen one.
  const shown = (content: string) => (WELCOMES.has(content) ? say('welcome') : content)
  const listRef = useRef<HTMLDivElement>(null)
  const busy = status !== 'idle'
  const online = useOnline()
  const unsent = messages.at(-1)?.role === 'user' && !!messages.at(-1)?.failed

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, status, error])

  const active = useActivePlan()
  // Package and travel-mode chips switch instantly in the browser; the others ask the planner.
  const afterPlan = active
    ? [
        // All three packages; the current one is ticked.
        ...active.packages.map((p) => ({ label: packageLabel(lang, p.name), send: p.name, on: p.name === active.recommended_package })),
        ...(active.transport_choice?.kind !== 'flight' && active.selected_flights.some((f) => f.price != null) ? [{ label: say('byFlight'), send: 'by flight' }] : []),
        ...(active.transport_choice?.kind !== 'train' && active.ground_options.some((o) => o.kind === 'train') ? [{ label: say('byTrain'), send: 'by train' }] : []),
        { label: say('moreRelaxed'), send: 'more relaxed' },
        { label: say('moreActivities'), send: 'more activities' },
      ]
    : []
  const feasibility = [
    { label: say('yesApply'), send: 'yes' },
    { label: say('continueAsIs'), send: 'continue' },
  ]
  const quick = busy ? [] : session?.stage === 'feasibility' ? feasibility : plan && session?.stage === 'planned' ? afterPlan : []
  const daysChip =
    plan?.duration.days && session?.stage === 'planned' && !busy ? [{ label: say('days', { n: plan.duration.days + 1 }), send: `${plan.duration.days + 1} days` }] : []

  // Reading replies aloud: each new assistant message is spoken in the chosen language.
  const voicesReady = useVoicesReady()
  const [readAloud, setReadAloud] = useState(savedReadAloud)
  const spokenCount = useRef(messages.length)
  useEffect(() => {
    const last = messages.at(-1)
    if (readAloud && messages.length > spokenCount.current && last?.role === 'assistant') speak(shown(last.content), speechCode(lang))
    spokenCount.current = messages.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, readAloud])
  const toggleReadAloud = () => {
    const next = !readAloud
    setReadAloud(next)
    try {
      localStorage.setItem(READ_ALOUD_KEY, next ? '1' : '0')
    } catch {
      /* the setting still applies for this visit */
    }
    if (next) {
      const last = messages.at(-1)
      if (last?.role === 'assistant') speak(shown(last.content), speechCode(lang))
    } else {
      stopSpeaking()
    }
  }
  const missingVoice = readAloud && voicesReady > 0 && lang !== 'en' && !hasVoice(speechCode(lang))
  const progress = useProgress()
  // The calendar opens by itself when the assistant asks for dates; after a plan it is one tap away.
  const askingDates = !busy && session?.stage === 'collecting' && Array.isArray(session.pending) && (session.pending as string[]).includes('start_date')
  const [calendar, setCalendar] = useState<{ open: boolean; at: number }>({ open: false, at: -1 })
  const askedAt = askingDates ? messages.length : -1
  const calendarOpen = askingDates ? !(calendar.at === askedAt && !calendar.open) : calendar.open && session?.stage === 'planned' && !busy
  const sendDates = (text: string) => {
    setCalendar({ open: false, at: askedAt })
    void send(text)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-ink-900">
      <div className="flex items-center gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
        <AssistantAvatar />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold text-slate-900 dark:text-white">{say('assistant')}</div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className={clsx('h-1.5 w-1.5 rounded-full', !online ? 'bg-rose-500' : busy ? 'animate-pulse bg-amber-400' : 'bg-emerald-500')} />
            {!online ? (busy ? say('offlineBusy') : say('offline')) : status === 'planning' ? say('building') : status === 'thinking' ? say('typing') : say('online')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="w-[92px]">
            <Select<Lang>
              id="chat-language"
              size="sm"
              align="right"
              menuWidth={150}
              label={say('language')}
              value={lang}
              onChange={(value) => {
                stopSpeaking()
                setLanguage(value)
              }}
              options={LANGUAGES.map((item) => ({ value: item.code, label: item.label }))}
            />
          </div>
          <button
            onClick={toggleReadAloud}
            aria-pressed={readAloud}
            aria-label={readAloud ? say('stopReading') : say('readAloud')}
            title={readAloud ? say('stopReading') : say('readAloud')}
            className={clsx(
              'grid h-8 w-8 place-items-center rounded-lg border transition',
              readAloud
                ? 'border-brand-600 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-500/20 dark:text-white'
                : 'border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:text-slate-300',
            )}
          >
            {readAloud ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        </div>
      </div>
      {missingVoice && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          {say('noVoice', { lang: LANGUAGES.find((l) => l.code === lang)?.label ?? lang })}
        </div>
      )}

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const grouped = previous?.role === message.role
          if (message.role === 'user') {
            return (
              <div key={index} className="flex animate-fade-up flex-col items-end">
                <div
                  className={clsx(
                    'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm',
                    message.failed && 'opacity-60',
                  )}
                >
                  {message.content}
                </div>
                {message.failed ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-300">
                    <AlertTriangle size={11} /> {say('notSent')}
                  </span>
                ) : (
                  time(message.at) && <span className="mt-1 text-[11px] text-slate-400">{time(message.at)}</span>
                )}
              </div>
            )
          }
          return (
            <div key={index} className="flex animate-fade-up gap-2.5">
              <div className="w-7 shrink-0">{!grouped && <AssistantAvatar small />}</div>
              <div className="min-w-0 max-w-[88%]">
                <div className="rounded-2xl rounded-tl-md border border-slate-200/80 bg-slate-50 px-4 py-3 text-[15px] leading-relaxed text-slate-800 dark:border-white/10 dark:bg-ink-800 dark:text-slate-100">
                  <MessageContent text={shown(message.content)} />
                </div>
                {time(message.at) && <span className="mt-1 block text-[11px] text-slate-400">{time(message.at)}</span>}
              </div>
            </div>
          )
        })}

        {status === 'thinking' && (
          <div className="flex gap-2.5">
            <AssistantAvatar small />
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-slate-200/80 bg-slate-50 px-4 py-3.5 text-slate-400 dark:border-white/10 dark:bg-ink-800">
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot h-2 w-2 rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {status === 'planning' && (
          <div className="flex gap-2.5">
            <AssistantAvatar small />
            <div className="w-full max-w-[88%] rounded-2xl rounded-tl-md border border-brand-200 bg-brand-50/70 px-4 py-3 dark:border-brand-400/30 dark:bg-brand-500/10">
              <div className="flex items-center justify-between text-sm font-semibold text-brand-800 dark:text-brand-200">
                <span>{say('planningTitle')}</span>
                <span className="text-xs font-medium">{say('steps', { done: progress.finished, total: progress.total })}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-white/10">
                <div className="h-full rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${Math.max(5, (progress.finished / Math.max(progress.total, 1)) * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-brand-700/80 dark:text-brand-200/80">{notice ?? say('planningNote')}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-2.5">
            <div className="w-7 shrink-0" />
            <div className="w-full max-w-[88%] rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="flex-1">{error}</div>
                <button onClick={dismissError} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
                  <X size={15} />
                </button>
              </div>
              {(unsent || session?.stage === 'ready') && (
                <button
                  onClick={() => void retry()}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  {unsent ? <WifiOff size={13} /> : <RefreshCw size={13} />} {unsent ? say('sendAgain') : say('planAgain')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {calendarOpen && (
        <div className="px-3 pb-2.5">
          <DatePicker
            mode={askingDates ? 'ask' : 'change'}
            lang={lang}
            busy={busy}
            onSend={sendDates}
            onClose={() => setCalendar({ open: false, at: askedAt })}
          />
        </div>
      )}

      {(quick.length > 0 || daysChip.length > 0 || askingDates || (plan && session?.stage === 'planned' && !busy)) && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2.5">
          {askingDates && !calendarOpen && (
            <button
              onClick={() => setCalendar({ open: true, at: askedAt })}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-800 shadow-sm transition hover:bg-brand-100 dark:border-brand-400/40 dark:bg-brand-500/15 dark:text-brand-100"
            >
              <CalendarDays size={13} /> {say('pickDates')}
            </button>
          )}
          {askingDates && (
            <button
              onClick={() => { setCalendar({ open: false, at: askedAt }); void send('flexible', say('flexible')) }}
              className="shrink-0 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 dark:border-white/10 dark:bg-ink-800 dark:text-slate-200 dark:hover:bg-brand-500/15"
            >
              {say('flexible')}
            </button>
          )}
          {plan && session?.stage === 'planned' && !busy && (
            <button
              onClick={() => setCalendar((c) => ({ open: !c.open, at: -1 }))}
              aria-expanded={calendarOpen}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 dark:border-white/10 dark:bg-ink-800 dark:text-slate-200 dark:hover:bg-brand-500/15"
            >
              <CalendarDays size={13} /> {say('changeDates')}
            </button>
          )}
          {[...quick, ...daysChip].map((chip) => {
            const on = 'on' in chip && !!chip.on
            return (
              <button
                key={chip.label}
                onClick={() => !on && void send(chip.send, chip.label)}
                aria-pressed={'on' in chip ? on : undefined}
                className={clsx(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-sm transition',
                  on
                    ? 'cursor-default border-brand-600 bg-brand-50 text-brand-900 dark:border-brand-400 dark:bg-brand-500/20 dark:text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 dark:border-white/10 dark:bg-ink-800 dark:text-slate-200 dark:hover:bg-brand-500/15',
                )}
              >
                {on && <Check size={12} />} {chip.label}
              </button>
            )
          })}
        </div>
      )}

      <div className="border-t border-slate-200/80 bg-white/90 px-3 pb-3 pt-3 backdrop-blur dark:border-white/10 dark:bg-ink-900/90">
        <Composer
          onSend={(text) => void send(text)}
          busy={busy}
          placeholder={plan ? say('placeholderPlan') : say('placeholder')}
          voiceLang={speechCode(lang)}
          labels={{ hint: say('hint'), speak: say('speak'), listening: say('listening'), micBlocked: say('micBlocked') }}
        />
      </div>
    </div>
  )
}
