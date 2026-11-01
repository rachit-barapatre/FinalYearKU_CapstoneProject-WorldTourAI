// Voice for the chat, using the browser's own speech recognition and speech synthesis
// (free, no key). Recognition works in Chrome, Edge and Safari; Firefox has none.

import { useCallback, useEffect, useRef, useState } from 'react'

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const voiceInputSupported = () => recognitionClass() !== null

/**
 * Speech to text in the given language (e.g. "hi-IN"). While listening, onInterim receives the words
 * so far; when the speaker stops (or taps stop), onFinal receives the whole message.
 */
export function useVoiceInput(speechLang: string, onInterim: (text: string) => void, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const heard = useRef('')
  const callbacks = useRef({ onInterim, onFinal })
  useEffect(() => {
    callbacks.current = { onInterim, onFinal }
  }, [onInterim, onFinal])

  useEffect(() => () => recognition.current?.abort(), [])

  const stop = useCallback(() => recognition.current?.stop(), [])

  const start = useCallback(() => {
    const Klass = recognitionClass()
    if (!Klass) return
    recognition.current?.abort()
    const r = new Klass()
    r.lang = speechLang
    r.interimResults = true
    r.continuous = false
    heard.current = ''
    setError(null)
    r.onresult = (event) => {
      let finalText = ''
      let interim = ''
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else interim += result[0].transcript
      }
      heard.current = (finalText || interim).trim()
      callbacks.current.onInterim((finalText + interim).trim())
    }
    r.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setError('mic-blocked')
      else if (event.error !== 'no-speech' && event.error !== 'aborted') setError(event.error)
    }
    r.onend = () => {
      setListening(false)
      recognition.current = null
      if (heard.current) callbacks.current.onFinal(heard.current)
    }
    recognition.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [speechLang])

  return { supported: voiceInputSupported(), listening, error, start, stop }
}

// --------------------------------------------------------------------------- reading replies aloud

function voices(): SpeechSynthesisVoice[] {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : []
}

/** Whether the device has a voice for the language ("hi-IN" → any "hi" voice). */
export function hasVoice(speechLang: string): boolean {
  const prefix = speechLang.split('-')[0].toLowerCase()
  return voices().some((v) => v.lang.toLowerCase().startsWith(prefix))
}

/** Keeps the voice list fresh; browsers load voices asynchronously. */
export function useVoicesReady(): number {
  const [count, setCount] = useState(() => voices().length)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const update = () => setCount(voices().length)
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return count
}

/** Read text aloud in the language. Without a voice for it nothing is read (another language's voice
 * would mispronounce the script); the chat shows a notice instead. */
export function speak(text: string, speechLang: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  if (voices().length && !hasVoice(speechLang)) return
  const clean = text
    .replace(/[*_#`>]/g, '')
    .replace(/→/g, ' to ')
    .replace(/[·•]/g, ', ')
    .replace(/\p{Extended_Pictographic}/gu, '')
  const prefix = speechLang.split('-')[0].toLowerCase()
  const all = voices()
  const voice =
    all.find((v) => v.lang.toLowerCase() === speechLang.toLowerCase()) ??
    all.find((v) => v.lang.toLowerCase().startsWith(prefix)) ??
    null
  // Reading aloud is a nicety: a browser quirk here must never break the chat.
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.lang = voice?.lang ?? speechLang
    try {
      if (voice) utterance.voice = voice
    } catch {
      /* the language code alone still picks a voice */
    }
    utterance.rate = 1
    window.speechSynthesis.speak(utterance)
  } catch {
    /* no speech on this device */
  }
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}
