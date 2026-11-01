import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: ReactNode
}

/**
 * The site's own dropdown (instead of the browser's grey list): a button that opens a listbox.
 * Works with the mouse, touch and keyboard (arrows, Home/End, Enter, Escape, typing a letter).
 * The list is drawn in a portal so it is never clipped by a card or a scrolling panel.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
  size = 'md',
  align = 'left',
  className,
  menuWidth,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  /** Accessible name when there is no visible <label htmlFor>. */
  label?: string
  id?: string
  size?: 'sm' | 'md'
  align?: 'left' | 'right'
  className?: string
  /** Minimum width of the open list in px (defaults to the button's width). */
  menuWidth?: number
}) {
  const autoId = useId()
  const buttonId = id ?? `select-${autoId}`
  const listId = `${buttonId}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const selected = options[selectedIndex]

  const position = () => {
    const box = buttonRef.current?.getBoundingClientRect()
    if (!box) return
    const width = Math.max(box.width, menuWidth ?? 0)
    const room = window.innerHeight - box.bottom
    const up = room < Math.min(300, options.length * 44 + 16) && box.top > room
    const left = align === 'right' ? box.right - width : box.left
    setPlace({ top: up ? box.top - 6 : box.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), width, up })
  }

  const show = () => {
    position()
    setActive(selectedIndex)
    setOpen(true)
  }
  const close = (focusButton = true) => {
    setOpen(false)
    if (focusButton) buttonRef.current?.focus()
  }
  const pick = (index: number) => {
    const option = options[index]
    if (option && option.value !== value) onChange(option.value)
    close()
  }

  useLayoutEffect(() => {
    if (!open) return
    listRef.current?.focus()
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false)
    }
    const onMove = () => position()
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  const onListKey = (event: React.KeyboardEvent) => {
    const last = options.length - 1
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      PageDown: () => setActive((i) => Math.min(last, i + 5)),
      PageUp: () => setActive((i) => Math.max(0, i - 5)),
      Enter: () => pick(active),
      ' ': () => pick(active),
      Escape: () => close(),
      Tab: () => close(false),
    }
    if (keys[event.key]) {
      if (event.key !== 'Tab') event.preventDefault()
      keys[event.key]()
      return
    }
    // Type-ahead: jump to the first option starting with the letters typed.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + event.key.toLowerCase(), at: now }
      const found = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
      if (found >= 0) setActive(found)
    }
  }

  const onButtonKey = (event: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      show()
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
        className={clsx(
          'group inline-flex w-full items-center justify-between gap-2 rounded-lg border bg-white text-left font-medium text-slate-900 outline-none transition',
          'hover:border-brand-300 focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15',
          'dark:bg-ink-800 dark:text-white dark:hover:border-brand-400/50',
          open ? 'border-brand-500 ring-4 ring-brand-500/15 dark:border-brand-400' : 'border-slate-300 dark:border-white/15',
          size === 'sm' ? 'h-8 px-2 text-xs font-semibold' : 'h-11 px-3 text-[15px]',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon}
          <span className="truncate">{selected?.label ?? ''}</span>
        </span>
        <ChevronDown size={size === 'sm' ? 13 : 16} className={clsx('shrink-0 text-slate-400 transition-transform group-hover:text-brand-600 dark:group-hover:text-brand-300', open && 'rotate-180 text-brand-600 dark:text-brand-300')} />
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={buttonId}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
            style={{ top: place.top, left: place.left, minWidth: place.width, transform: place.up ? 'translateY(-100%)' : undefined }}
            className="fixed z-[3500] max-h-72 animate-[fade-in_0.12s_ease-out] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lift outline-none dark:border-white/10 dark:bg-ink-800"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              return (
                <li
                  key={option.value || '__empty'}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => pick(index)}
                  className={clsx(
                    'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                    size === 'sm' ? 'py-1.5' : 'py-2',
                    index === active ? 'bg-brand-50 text-brand-900 dark:bg-white/[0.07] dark:text-white' : 'text-slate-700 dark:text-slate-200',
                    isSelected && 'font-semibold',
                  )}
                >
                  {option.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.hint && <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">{option.hint}</span>}
                  </span>
                  <Check size={15} className={clsx('shrink-0 text-brand-600 dark:text-brand-300', !isSelected && 'invisible')} />
                </li>
              )
            })}
          </ul>,
          document.body,
        )}
    </>
  )
}
