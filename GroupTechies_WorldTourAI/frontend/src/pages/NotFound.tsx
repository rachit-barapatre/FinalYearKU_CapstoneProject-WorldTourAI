import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <main className="grid flex-1 place-items-center px-4 py-20 text-center">
      <div>
        <img src="/logo-globe.svg" alt="" width={80} height={80} className="mx-auto" />
        <h1 className="mt-4 text-3xl font-extrabold text-slate-900 dark:text-white">This page took a wrong turn</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">The address may be mistyped, or the page has moved.</p>
        <Link to="/" className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">Back to planning</Link>
      </div>
    </main>
  )
}
