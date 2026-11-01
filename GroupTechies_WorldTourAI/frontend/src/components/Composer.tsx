import clsx from 'clsx'
import { ArrowUp, Loader2, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useVoiceInput } from '../lib/voice'

interface Props {
  onSend: (text: string) => void
  busy?: boolean
  placeholder?: string
  size?: 'md' | 'lg'
  autoFocus?: boolean
  hint?: boolean
  /** Text to start with, e.g. a prompt from a destination guide link. */
  initialText?: string
  /** id for the text box, so other parts of the page can focus it. */
  inputId?: string
  /** Language voice input listens for, e.g. "hi-IN". */
  voiceLang?: string
  /** Translated labels; English defaults. */
  labels?: { hint?: string; speak?: string; listening?: string; micBlocked?: string }
}

/** Auto-growing message box: Enter sends, Shift+Enter adds a line, the mic turns speech into a message. */
export function Composer({
  onSend,
  busy = false,
  placeholder = 'Describe your trip…',
  size = 'md',
  autoFocus = false,
  hint = true,
  initialText = '',
  inputId,
  voiceLang = 'en-IN',
  labels = {},
}: Props) {
  const [text, setText] = useState(initialText)
  const ref = useRef<HTMLTextAreaElement>(null)
  const voice = useVoiceInput(
    voiceLang,
    (heard) => setText(heard),
    (heard) => {
      // Speaking is hands-free: the message goes as soon as the speaker stops.
      if (heard.trim() && !busy) {
        onSend(heard.trim())
        setText('')
      }
    },
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, size === 'lg' ? 220 : 160)}px`
  }, [text, size])

  const submit = () => {
    if (!text.trim() || busy) return
    if (voice.listening) voice.stop()
    onSend(text.trim())
    setText('')
  }

  const big = size === 'lg'
  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className={clsx(
          'flex items-end gap-2 rounded-2xl border bg-white transition dark:bg-ink-800',
          voice.listening
            ? 'border-rose-400 ring-4 ring-rose-500/15'
            : 'border-slate-200 shadow-soft focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10 dark:border-white/10 dark:focus-within:border-brand-400/60',
          big ? 'p-2.5 sm:p-3' : 'p-2',
        )}
      >
        <textarea
          id={inputId}
          ref={ref}
          value={text}
          autoFocus={autoFocus}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={voice.listening ? labels.listening ?? 'Listening… tap to stop' : placeholder}
          aria-label="Message"
          className={clsx(
            'min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-slate-400',
            big ? 'min-h-[52px] px-2 py-3 text-base' : 'min-h-[40px] px-2 py-2 text-[15px]',
          )}
        />
        {voice.supported && (
          <button
            type="button"
            onClick={() => (voice.listening ? voice.stop() : voice.start())}
            disabled={busy}
            aria-pressed={voice.listening}
            aria-label={voice.listening ? labels.listening ?? 'Listening… tap to stop' : labels.speak ?? 'Speak your message'}
            title={voice.listening ? labels.listening ?? 'Listening… tap to stop' : labels.speak ?? 'Speak your message'}
            className={clsx(
              'relative grid shrink-0 place-items-center rounded-lg transition disabled:opacity-40',
              big ? 'h-12 w-12' : 'h-10 w-10',
              voice.listening
                ? 'bg-rose-600 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:bg-transparent dark:text-slate-300',
            )}
          >
            {voice.listening && <span className="absolute inset-0 animate-ping rounded-lg bg-rose-500/40" aria-hidden="true" />}
            {voice.listening ? <Square size={15} fill="currentColor" className="relative" /> : <Mic size={big ? 20 : 18} />}
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send message"
          className={clsx(
            'grid shrink-0 place-items-center rounded-lg bg-brand-700 text-white shadow-sm transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-white/10 dark:disabled:text-slate-500',
            big ? 'h-12 w-12' : 'h-10 w-10',
          )}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={big ? 20 : 18} strokeWidth={2.4} />}
        </button>
      </form>
      {voice.error === 'mic-blocked' && (
        <p className="mt-1.5 px-1 text-[11px] font-medium text-rose-600">{labels.micBlocked ?? 'Allow microphone access in your browser to speak your message.'}</p>
      )}
      {hint && voice.error !== 'mic-blocked' && (
        <p className="mt-1.5 hidden px-1 text-[11px] text-slate-400 sm:block">
          {labels.hint ?? (
            <>
              <kbd className="font-sans font-semibold">Enter</kbd> to send · <kbd className="font-sans font-semibold">Shift + Enter</kbd> for a new line
            </>
          )}
        </p>
      )}
    </div>
  )
}
