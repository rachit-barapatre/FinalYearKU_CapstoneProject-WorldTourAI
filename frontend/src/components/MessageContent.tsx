import type { ReactNode } from 'react'

/**
 * Renders the assistant's plain-text replies with light structure:
 * numbered questions become a list, indented lines become notes under them,
 * and blank lines separate paragraphs.
 */
export function MessageContent({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { title: string; notes: string[] }[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p${blocks.length}`}>{paragraph.join(' ')}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push(
      <ol key={`l${blocks.length}`} className="space-y-2">
        {list.map((item, index) => (
          <li key={index} className="flex gap-2.5">
            <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600/10 text-[11px] font-bold text-brand-700 dark:bg-brand-400/15 dark:text-brand-200">
              {index + 1}
            </span>
            <div className="min-w-0">
              <div>{item.title}</div>
              {item.notes.map((note, i) => (
                <div key={i} className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{note}</div>
              ))}
            </div>
          </li>
        ))}
      </ol>,
    )
    list = []
  }

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (numbered) {
      flushParagraph()
      list.push({ title: numbered[1], notes: [] })
    } else if (/^\s{2,}\S/.test(line) && list.length) {
      list[list.length - 1].notes.push(line.trim())
    } else if (!line.trim()) {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  flushParagraph()
  flushList()
  return <div className="space-y-2.5">{blocks}</div>
}
