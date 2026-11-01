import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store'

/** Shown when the API is protected with ACCESS_CODE and no valid code has been entered. */
export function AccessCode() {
  const setAccessCode = useStore((s) => s.setAccessCode)
  const [code, setCode] = useState('')
  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setAccessCode(code)
        }}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-ink-800"
      >
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10">
          <KeyRound size={20} />
        </div>
        <h2 className="text-lg font-semibold">Access code needed</h2>
        <p className="mb-4 text-sm text-slate-500">This planner is private. Enter the access code you were given.</p>
        <input
          autoFocus
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/10"
          placeholder="Access code"
        />
        <button type="submit" disabled={!code.trim()} className="mt-3 w-full rounded-lg bg-brand-700 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40">
          Continue
        </button>
      </form>
    </div>
  )
}
