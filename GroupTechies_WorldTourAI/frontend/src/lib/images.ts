// Photos of destinations and sights from Wikipedia's free page-summary API (CORS-enabled, no key).

import { useEffect, useState } from 'react'

const STANDARD_WIDTHS = [330, 500, 960, 1280, 1920]
// Words that say what kind of place it is, not which one.
const GENERIC_WORDS = ['beach', 'fort', 'temple', 'church', 'market', 'view', 'point', 'viewpoint', 'city', 'palace', 'lake', 'museum',
  'park', 'garden', 'gardens', 'falls', 'waterfall', 'hill', 'hills', 'road', 'street', 'square', 'mall', 'bazaar', 'national', 'old', 'new', 'the']
/** Lower-case words without accents ("Sensō-ji" → ["senso", "ji"]). */
const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
const cache = new Map<string, Promise<string | null>>()

function stored(key: string): string | null | undefined {
  try {
    const value = sessionStorage.getItem(`wt-img3:${key}`)
    return value === null ? undefined : value || null
  } catch {
    return undefined
  }
}

function remember(key: string, url: string | null) {
  try {
    sessionStorage.setItem(`wt-img3:${key}`, url ?? '')
  } catch {
    /* the in-memory cache still works */
  }
}

async function lookup(title: string, width: number): Promise<string | null> {
  const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`)
  if (!response.ok) return null
  const data = (await response.json()) as { type?: string; thumbnail?: { source: string; width: number }; originalimage?: { source: string; width: number } }
  if (data.type === 'disambiguation' || !data.thumbnail) return null
  // Wikimedia serves thumbnails only at standard widths; other widths fail to load.
  const size = STANDARD_WIDTHS.find((w) => w >= width) ?? STANDARD_WIDTHS[STANDARD_WIDTHS.length - 1]
  const { source, width: thumbWidth } = data.thumbnail
  if (data.originalimage && data.originalimage.width <= size) return data.originalimage.source
  return thumbWidth < size ? source.replace(/\/(\d+)px-/, `/${size}px-`) : source
}

/** A photo URL for the first title that has one on Wikipedia, or null. */
export function wikiImage(titles: (string | null | undefined)[], width = 800): Promise<string | null> {
  const list = titles.map((t) => t?.trim()).filter((t): t is string => !!t)
  const key = `${width}|${list.join('|')}`
  const known = stored(key)
  if (known !== undefined) return Promise.resolve(known)
  let pending = cache.get(key)
  if (!pending) {
    pending = (async () => {
      for (const title of list) {
        try {
          const url = await lookup(title, width)
          if (url) return url
        } catch {
          /* try the next title */
        }
      }
      return null
    })().then((url) => {
      remember(key, url)
      return url
    })
    cache.set(key, pending)
  }
  return pending
}

export function useWikiImage(titles: (string | null | undefined)[], width = 800): string | null {
  const key = titles.join('|')
  const [image, setImage] = useState<{ key: string; url: string | null }>({ key: '', url: null })
  useEffect(() => {
    let live = true
    void wikiImage(key.split('|'), width).then((url) => live && setImage({ key, url }))
    return () => {
      live = false
    }
  }, [key, width])
  return image.key === key ? image.url : null
}

/**
 * A photo of a sight in a given city: Wikipedia search for "<name> <city>", accepted only when the article
 * mentions the city (so "Albert Hall" in Jaipur never shows London's Royal Albert Hall).
 */
export function placeImage(name: string, city: string | null | undefined, width = 500): Promise<string | null> {
  const size = STANDARD_WIDTHS.find((w) => w >= width) ?? STANDARD_WIDTHS[STANDARD_WIDTHS.length - 1]
  const key = `place|${size}|${name}|${city ?? ''}`
  const known = stored(key)
  if (known !== undefined) return Promise.resolve(known)
  let pending = cache.get(key)
  if (!pending) {
    pending = (async () => {
      const params = new URLSearchParams({
        action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `${name} ${city ?? ''}`.trim(), gsrlimit: '1',
        prop: 'pageimages|extracts', piprop: 'thumbnail', pithumbsize: String(size), exintro: '1', explaintext: '1', exchars: '800',
      })
      try {
        const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`)
        if (!response.ok) return null
        const data = (await response.json()) as { query?: { pages?: Record<string, { title: string; extract?: string; thumbnail?: { source: string } }> } }
        const page = Object.values(data.query?.pages ?? {})[0]
        if (!page?.thumbnail) return null
        const about = `${page.title} ${page.extract ?? ''}`.toLowerCase()
        if (city && !about.includes(city.toLowerCase())) return null
        // Logos, flags, seals and maps are never a photo of the place.
        if (/logo|flag|seal|emblem|coat_of_arms|symbol|locator|map|\.svg/i.test(decodeURIComponent(page.thumbnail.source))) return null
        // The article must be about this place: its title shares a distinctive word with the name
        // ("Albert Hall Museum" for "Albert Hall"), not just the city (a party called "Goa Forward" for a beach).
        const title = words(page.title).join(' ')
        const ignore = new Set([...GENERIC_WORDS, ...(city ? words(city) : [])])
        const distinctive = words(name).filter((word) => word.length >= 4 && !ignore.has(word))
        const matches = distinctive.length ? distinctive.some((word) => title.includes(word)) : title.includes(words(name).join(' '))
        return matches ? page.thumbnail.source : null
      } catch {
        return null
      }
    })().then((url) => {
      remember(key, url)
      return url
    })
    cache.set(key, pending)
  }
  return pending
}
