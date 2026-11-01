import { Camera, ImagePlus, Loader2, Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { server, useAccount, type Profile } from '../lib/account'

const VIEW = 280 // size of the crop circle on screen
const OUTPUT = 512 // size of the uploaded square

interface Signed {
  uploadUrl: string
  apiKey: string
  timestamp: number
  publicId: string
  signature: string
  overwrite: boolean
}

/** Upload a cropped photo: the server signs, the browser sends it straight to Cloudinary, the server saves it. */
async function uploadPhoto(blob: Blob): Promise<Profile> {
  const signed = await server<Signed>('/api/me/photo/sign', { method: 'POST' })
  const form = new FormData()
  form.append('file', blob, 'avatar.jpg')
  form.append('api_key', signed.apiKey)
  form.append('timestamp', String(signed.timestamp))
  form.append('public_id', signed.publicId)
  form.append('overwrite', String(signed.overwrite))
  form.append('signature', signed.signature)
  const response = await fetch(signed.uploadUrl, { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401 || response.status === 403) {
    // The photo service refused the upload (e.g. its API key lacks upload permission): not the traveler's fault.
    console.warn('[photo] Cloudinary refused the upload:', data?.error?.message)
    throw new Error('Photo uploads are not available right now. You can skip this step and add a photo later in Settings.')
  }
  if (!response.ok || !data.secure_url) throw new Error(data?.error?.message || 'The photo could not be uploaded. Please try another one.')
  const { user } = await server<{ user: Profile }>('/api/me/photo', { method: 'PATCH', body: { publicId: data.public_id, url: data.secure_url } })
  return user
}

/** Choose or take a photo, drag and zoom it inside the circle, then save. */
export function PhotoCropper({ onSaved, saveLabel = 'Save photo' }: { onSaved: (profile: Profile) => void; saveLabel?: string }) {
  const [source, setSource] = useState<string | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const setProfile = useAccount((s) => s.setProfile)

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source)
  }, [source])

  const choose = (file: File | undefined) => {
    setError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Please choose an image file (JPG, PNG or WebP).')
    if (file.size > 15 * 1024 * 1024) return setError('That image is larger than 15 MB. Please choose a smaller one.')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setSource(url)
      setImage(img)
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    }
    img.onerror = () => setError('That image could not be opened. Please try another one.')
    img.src = url
  }

  // The image covers the circle at zoom 1; offsets are limited so the circle never shows a gap.
  const base = image ? VIEW / Math.min(image.width, image.height) : 1
  const scale = base * zoom
  const limit = (value: number, size: number) => Math.max(-(size * scale - VIEW) / 2, Math.min((size * scale - VIEW) / 2, value))
  const clamp = (o: { x: number; y: number }) => (image ? { x: limit(o.x, image.width), y: limit(o.y, image.height) } : o)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setOffset(clamp({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y }))
  }
  const changeZoom = (value: number) => {
    const next = Math.min(4, Math.max(1, value))
    setZoom(next)
    if (image) {
      const s = base * next
      setOffset((o) => ({
        x: Math.max(-(image.width * s - VIEW) / 2, Math.min((image.width * s - VIEW) / 2, o.x)),
        y: Math.max(-(image.height * s - VIEW) / 2, Math.min((image.height * s - VIEW) / 2, o.y)),
      }))
    }
  }

  const save = async () => {
    if (!image) return
    setBusy(true)
    setError(null)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT
      canvas.height = OUTPUT
      const ctx = canvas.getContext('2d')!
      const ratio = OUTPUT / VIEW
      const w = image.width * scale * ratio
      const h = image.height * scale * ratio
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, OUTPUT, OUTPUT)
      ctx.drawImage(image, (OUTPUT - w) / 2 + offset.x * ratio, (OUTPUT - h) / 2 + offset.y * ratio, w, h)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (!blob) throw new Error('The photo could not be prepared. Please try another one.')
      const profile = await uploadPhoto(blob)
      setProfile(profile)
      onSaved(profile)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={cameraInput} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />

      {image && source ? (
        <div className="flex flex-col items-center">
          <div
            className="relative cursor-grab touch-none overflow-hidden rounded-full bg-slate-100 shadow-inner ring-4 ring-white active:cursor-grabbing dark:bg-white/5 dark:ring-ink-800"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => changeZoom(zoom - e.deltaY * 0.002)}
            role="img"
            aria-label="Drag to position your photo"
          >
            <img
              src={source}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{ width: image.width * scale, height: image.height * scale, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">Drag to position · use the slider to zoom</p>
          <div className="mt-3 flex w-full max-w-[280px] items-center gap-3">
            <button type="button" onClick={() => changeZoom(zoom - 0.2)} aria-label="Zoom out" className="text-slate-500 hover:text-slate-900 dark:hover:text-white"><Minus size={16} /></button>
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} aria-label="Zoom" className="flex-1 accent-brand-700" />
            <button type="button" onClick={() => changeZoom(zoom + 0.2)} aria-label="Zoom in" className="text-slate-500 hover:text-slate-900 dark:hover:text-white"><Plus size={16} /></button>
          </div>
          {error && <p className="mt-3 text-center text-sm font-medium text-rose-600">{error}</p>}
          <div className="mt-5 flex w-full max-w-[320px] gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">
              <RotateCcw size={15} /> Change
            </button>
            <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-lg bg-brand-700 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-500">
              {busy && <Loader2 size={16} className="animate-spin" />} {saveLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              choose(e.dataTransfer.files?.[0])
            }}
            className="grid h-44 w-44 place-items-center rounded-full border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:border-white/15 dark:bg-white/5"
          >
            <span className="flex flex-col items-center gap-2 text-sm font-semibold">
              <ImagePlus size={28} /> Choose a photo
            </span>
          </button>
          <p className="mt-3 text-xs text-slate-500">or drop an image here · JPG, PNG or WebP up to 15 MB</p>
          <button type="button" onClick={() => cameraInput.current?.click()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:hidden dark:border-white/15 dark:text-slate-200">
            <Camera size={16} /> Take a photo
          </button>
          {error && <p className="mt-3 text-center text-sm font-medium text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
