import { ArrowRight, BedDouble, CalendarClock, CheckCircle2, CloudSun, Coins, MessagesSquare, Plane, ShieldCheck, Sparkles, TrainFront, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { focusTripInput } from '../lib/focus'
import { LANGUAGES, speechCode, t } from '../lib/i18n'
import { useWikiImage } from '../lib/images'
import { useStore } from '../store'
import { Composer } from './Composer'
import { Logo } from './ui'

const YEAR = new Date().getFullYear()

/** A prompt passed in the link (?q=...) from a destination guide; the traveler can edit it before sending. */
function linkedPrompt(): string {
  try {
    return new URLSearchParams(window.location.search).get('q')?.slice(0, 500) ?? ''
  } catch {
    return ''
  }
}

// Shown on the page and mirrored in the FAQPage structured data in index.html; keep both in sync.
const FAQ = [
  { q: 'Is WorldTour free to use?', a: "Yes. Planning a trip is free and needs no sign-up. You book flights, trains and hotels directly on the provider's website." },
  {
    q: 'How does the AI trip planner work?',
    a: 'Describe your trip in your own words — where, from where, dates, budget and who is coming. WorldTour asks for anything missing, checks the trip is realistic, then compares flights, trains, buses, cabs and hotels and builds an hour-by-hour itinerary with a full cost breakdown.',
  },
  {
    q: 'Can it plan trips within India by train?',
    a: 'Yes. For domestic trips you see flights next to trains (Sleeper, 3AC, 2AC), AC buses and private cabs, with travel times and estimated fares, and can switch between them instantly.',
  },
  { q: 'Can I download my itinerary as a PDF?', a: "Yes. Download PDF creates a travel document with photos, journey and hotel details, the cost summary and every day's timetable." },
  { q: 'Which currencies are supported?', a: "Prices are shown in the currency you plan in — Indian rupees (₹), US dollars, euros, pounds and more — converted at today's exchange rate." },
]

const GUIDES = [
  ['goa', 'Goa'], ['jaipur', 'Jaipur'], ['kerala', 'Kerala'], ['manali', 'Manali'], ['udaipur', 'Udaipur'], ['varanasi', 'Varanasi'],
  ['rishikesh', 'Rishikesh'], ['ladakh', 'Leh Ladakh'], ['andaman', 'Andaman'], ['dubai', 'Dubai'], ['bali', 'Bali'], ['bangkok', 'Bangkok'],
  ['singapore', 'Singapore'], ['paris', 'Paris'],
] as const

const PROMPTS = [
  '4 days in Goa from Ahmedabad for 2, under ₹60,000',
  'Relaxed week in Paris from London, 3000 EUR',
  'Jaipur by train from Delhi, 3 days, history',
]

const DESTINATIONS = [
  { city: 'Goa', country: 'India', tag: 'Beaches & Portuguese quarters', photo: 'Palolem Beach',
    prompt: 'Plan a 4 day trip from Ahmedabad to Goa for 2 people under ₹60,000, beaches and food, relaxed' },
  { city: 'Dubai', country: 'UAE', tag: 'Skyline, souks & desert', photo: 'Burj Khalifa',
    prompt: '5 days from Mumbai to Dubai for 2 people, budget 1.5 lakh, shopping and culture' },
  { city: 'Jaipur', country: 'India', tag: 'Forts, palaces & bazaars', photo: 'Hawa Mahal',
    prompt: 'Delhi to Jaipur by train, 3 days for 2 people, ₹30,000, history and culture' },
  { city: 'Paris', country: 'France', tag: 'Museums, cafés & boulevards', photo: 'Eiffel Tower',
    prompt: 'A relaxed week in Paris from London in December for 2 people, budget 3000 EUR, museums and food' },
  { city: 'Tokyo', country: 'Japan', tag: 'Neon nights & quiet temples', photo: 'Sensō-ji',
    prompt: '7 days from Delhi to Tokyo for 2 people in March, budget 4 lakh, culture and food' },
  { city: 'Bali', country: 'Indonesia', tag: 'Beaches & rice terraces', photo: 'Tegallalang',
    prompt: '6 days from Mumbai to Bali for a couple, ₹1.2 lakh, beaches and nature, relaxed' },
]

const STEPS = [
  { icon: <MessagesSquare size={20} />, title: 'Tell us your trip', text: 'Where, when, budget and who is coming — in your own words. We only ask for what is missing.' },
  { icon: <ShieldCheck size={20} />, title: 'We check & plan', text: 'A reality check first, then nine agents compare flights, trains, hotels, weather and places in parallel.' },
  { icon: <Wand2 size={20} />, title: 'Refine & book', text: 'Switch packages, change dates or pace by chatting, then book with direct links or save it to your calendar.' },
]

const FEATURES = [
  { icon: <Plane size={20} />, title: 'Live fares & hotel rates', text: 'Real Google Flights and Google Hotels prices for your exact dates.' },
  { icon: <TrainFront size={20} />, title: 'Every way to travel', text: 'Trains, buses and cabs for domestic and nearby trips, priced by road distance.' },
  { icon: <BedDouble size={20} />, title: 'Three costed packages', text: 'Budget, Balanced and Premium — travel, stay, food, transfers and entry fees.' },
  { icon: <CalendarClock size={20} />, title: 'Hour-by-hour days', text: 'Every transfer with distance, time and fare, plus meals, check-in and departures.' },
  { icon: <CloudSun size={20} />, title: 'Weather-aware', text: 'Outdoor sights avoid rainy days and the midday heat, with packing tips.' },
  { icon: <Coins size={20} />, title: 'Your currency', text: 'Prices in ₹, €, £ or $ — whichever you plan in.' },
]

export function Landing() {
  const send = useStore((s) => s.send)
  const busy = useStore((s) => s.status !== 'idle')
  const language = useStore((s) => s.language) ?? 'en'
  const setLanguage = useStore((s) => s.setLanguage)
  const heroPhoto = useWikiImage(['Amer Fort'], 1800)
  const [initialPrompt] = useState(linkedPrompt)

  return (
    <div className="overflow-x-hidden">
      {/* Hero */}
      <section id="plan" className="relative isolate overflow-hidden bg-brand-950 text-white">
        {heroPhoto && <img src={heroPhoto} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-90" />}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-950 via-brand-950/90 to-brand-950/40" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-24">
          <div className="animate-fade-up">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur">
              <Sparkles size={13} className="text-coral-400" /> Nine AI agents · live prices · your currency
            </div>
            <h1 className="text-balance text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:text-6xl">
              Plan your whole trip
              <br className="hidden sm:block" /> in{' '}
              <span className="relative whitespace-nowrap">
                one conversation
                <span className="absolute -bottom-1 left-0 h-1.5 w-full rounded-full bg-coral-500" />
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              Tell WorldTour where you want to go. It checks the trip is realistic, compares flights, trains and hotels, and builds an hour-by-hour itinerary that fits your days and budget.
            </p>

            <div className="mt-8 max-w-xl rounded-2xl bg-white p-3 text-slate-900 shadow-2xl dark:bg-ink-800 dark:text-white">
              <Composer onSend={(text) => void send(text)} busy={busy} size="lg" placeholder="e.g. 5 days in Dubai from Mumbai for 2, budget ₹1.5 lakh" initialText={initialPrompt} autoFocus={!!initialPrompt} inputId="trip-input"
                voiceLang={speechCode(language)}
                labels={{ speak: t(language, 'speak'), listening: t(language, 'listening'), micBlocked: t(language, 'micBlocked') }}
              />
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-1" role="group" aria-label="Chat language">
                <span className="mr-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t(language, 'language')}:</span>
                {LANGUAGES.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => setLanguage(item.code)}
                    aria-pressed={language === item.code}
                    className={
                      language === item.code
                        ? 'rounded-full bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white dark:bg-brand-500'
                        : 'rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-800 dark:border-white/10 dark:text-slate-300'
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 px-1 pb-1">
                {PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => void send(prompt)}
                    disabled={busy}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-800 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
              {['Free to use', 'No sign-up', 'Real-time prices', 'PDF itinerary'].map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 size={16} className="text-emerald-400" /> {item}
                </li>
              ))}
            </ul>
          </div>

          <ProductPreview />
        </div>
      </section>

      {/* Destinations */}
      <section id="destinations" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="Inspiration" title="Popular trips to start from" text="Pick one and we'll plan it — you can change anything afterwards." />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map((d) => (
            <DestinationCard key={d.city} destination={d} disabled={busy} onPick={() => void send(d.prompt)} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 border-y border-slate-200 bg-white py-16 dark:border-white/10 dark:bg-ink-800/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHeading eyebrow="How it works" title="From idea to itinerary in about a minute" />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className="relative rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-white/10 dark:bg-ink-900">
                <div className="mb-4 flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-800 text-white dark:bg-brand-500">{step.icon}</span>
                  <span className="font-display text-sm font-bold text-brand-700 dark:text-brand-300">Step {index + 1}</span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="Why WorldTour" title="Everything a good travel agent would do" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft dark:border-white/10 dark:bg-ink-800">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{f.icon}</span>
              <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-t border-slate-200 bg-white py-16 dark:border-white/10 dark:bg-ink-800/50">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <SectionHeading eyebrow="FAQ" title="Questions about the AI trip planner" />
          <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-ink-800">
            {FAQ.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900 dark:text-white">
                  <h3 className="text-base">{item.q}</h3>
                  <span className="text-xl leading-none text-slate-400 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl bg-brand-900 px-6 py-12 text-center text-white shadow-lift sm:px-12">
          <div className="absolute inset-x-0 top-0 h-1 bg-coral-500" />
          <h2 className="relative text-3xl font-extrabold sm:text-4xl">Where to next?</h2>
          <p className="relative mx-auto mt-3 max-w-lg text-white/80">Describe the trip and get a complete, costed plan in about a minute.</p>
          <a href="#plan" onClick={(event) => { event.preventDefault(); focusTripInput() }} className="relative mt-7 inline-flex items-center gap-2 rounded-lg bg-coral-500 px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-coral-600">
            Start planning <ArrowRight size={16} />
          </a>
        </div>
      </section>

      <Footer />
    </div>
  )
}

function DestinationCard({ destination: d, disabled, onPick }: { destination: (typeof DESTINATIONS)[number]; disabled: boolean; onPick: () => void }) {
  const photo = useWikiImage([d.photo, d.city], 900)
  return (
    <button
      onClick={onPick}
      disabled={disabled}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-60 dark:border-white/10 dark:bg-ink-800"
    >
      <div className="relative h-48 overflow-hidden bg-brand-900">
        {photo && <img src={photo} alt={`${d.city}, ${d.country}`} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/10" />
        <div className="absolute left-4 top-4 rounded-md bg-white/95 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-900">{d.country}</div>
        <h3 className="absolute bottom-3 left-4 text-2xl font-extrabold text-white drop-shadow">{d.city}</h3>
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{d.tag}</p>
          <ArrowRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-700" />
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-slate-500">“{d.prompt}”</p>
      </div>
    </button>
  )
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-coral-600 dark:text-coral-400">{eyebrow}</div>
      <h2 className="mt-2 text-balance text-3xl font-extrabold text-slate-900 sm:text-4xl dark:text-white">{title}</h2>
      {text && <p className="mt-3 text-slate-600 dark:text-slate-400">{text}</p>}
    </div>
  )
}

// The example plan's packages; tapping one shows how a real plan switches travel, hotel and total.
const EXAMPLE_TIERS = [
  { name: 'Budget', total: '₹33k', fits: true, travel: '🚆 Train Sleeper · ₹760', hotel: '🏨 Guesthouse · 3★', stars: '3★', rate: '🏨 Live rate ₹2,900/night' },
  { name: 'Balanced', total: '₹40k', fits: true, travel: '🚆 Train 3AC · ₹1,770', hotel: '🏨 Boutique hotel · 4★', stars: '4★', rate: '🏨 Live rate ₹6,267/night' },
  { name: 'Premium', total: '₹72k', fits: false, travel: '✈️ Flight · ₹9,400', hotel: '🏨 Beach resort · 5★', stars: '5★', rate: '🏨 Live rate ₹14,800/night' },
] as const

/** An illustrative glimpse of a finished plan; its packages can be tapped to compare. */
function ProductPreview() {
  const rows = [
    { time: '09:30', icon: '🚕', text: 'Cab to Fort Aguada', meta: '9.7 km · 25 min · ₹195' },
    { time: '10:00', icon: '🏰', text: 'Fort Aguada', meta: 'History · 2 h' },
    { time: '12:30', icon: '🍽️', text: 'Lunch near Candolim', meta: '~₹400 per person' },
    { time: '14:00', icon: '🏖️', text: 'Calangute Beach', meta: 'Beach · 2.5 h' },
    { time: '19:30', icon: '🍷', text: 'Dinner at Gunpowder', meta: 'Assagao' },
  ]
  const [tier, setTier] = useState<(typeof EXAMPLE_TIERS)[number]['name']>('Balanced')
  const chosen = EXAMPLE_TIERS.find((t) => t.name === tier) ?? EXAMPLE_TIERS[1]
  return (
    <div className="relative mx-auto w-full max-w-md animate-fade-up lg:max-w-none">
      <div className="relative rounded-2xl border border-white/10 bg-white p-5 text-slate-900 shadow-2xl dark:bg-ink-800 dark:text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Example plan</div>
            <div className="font-display text-lg font-bold text-slate-900 dark:text-white">Goa · 4 days · 2 travelers</div>
          </div>
          <span
            className={
              chosen.fits
                ? 'rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
            }
          >
            {chosen.fits ? 'Within ₹60k budget' : 'Over ₹60k budget'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Example packages — tap to compare">
          {EXAMPLE_TIERS.map((item) => {
            const on = item.name === tier
            return (
              <button
                key={item.name}
                onClick={() => setTier(item.name)}
                aria-pressed={on}
                className={`rounded-xl border p-2.5 text-left transition ${on ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600 dark:bg-brand-500/15' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5'}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.name}</div>
                <div className="font-display text-base font-bold text-slate-900 dark:text-white">{item.total}</div>
              </button>
            )
          })}
        </div>
        <div className="mt-2 grid gap-1.5 text-xs text-slate-600 sm:grid-cols-2 dark:text-slate-300">
          <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-ink-900">{chosen.travel}</div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-ink-900">{chosen.hotel}</div>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-ink-900">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>DAY 2 · SUN 13 DEC</span>
            <span>☀️ 32° · 💧0%</span>
          </div>
          <ol className="space-y-2.5">
            {rows.map((row) => (
              <li key={row.time} className="flex items-start gap-3">
                <span className="w-11 shrink-0 font-mono text-xs text-slate-400">{row.time}</span>
                <span className="text-base leading-none">{row.icon}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{row.text}</div>
                  <div className="truncate text-xs text-slate-500">{row.meta}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="float-slow absolute -top-11 left-6 hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-lift sm:block dark:border-white/10 dark:bg-ink-800">
        <div className="text-[11px] text-slate-500">Getting there</div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{chosen.travel}</div>
      </div>
      <div className="float-slow absolute -bottom-7 right-6 hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-lift [animation-delay:1.5s] sm:block dark:border-white/10 dark:bg-ink-800">
        <div className="text-[11px] text-slate-500">Hotel · {chosen.stars}</div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{chosen.rate}</div>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-200/80 bg-white dark:border-white/10 dark:bg-ink-900">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.3fr_0.8fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            A multi-agent trip planner. Prices are planning estimates — always confirm on the booking site before you pay.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Data from</div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-500 dark:text-slate-400">
            <li>Google Flights & Google Hotels (via SerpApi)</li>
            <li>OpenStreetMap, OSRM & Geoapify</li>
            <li>Open-Meteo weather · Frankfurter rates</li>
          </ul>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Trip planners</div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-slate-500 dark:text-slate-400">
            {GUIDES.map(([slug, name]) => (
              <li key={slug}><a href={`/trip-planner/${slug}`} className="hover:text-slate-900 dark:hover:text-white">{name} trip planner</a></li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Explore</div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-500 dark:text-slate-400">
            <li><a href="#destinations" className="hover:text-slate-900 dark:hover:text-white">Popular trips</a></li>
            <li><a href="#how" className="hover:text-slate-900 dark:hover:text-white">How it works</a></li>
            <li><a href="#features" className="hover:text-slate-900 dark:hover:text-white">Features</a></li>
            <li><a href="#faq" className="hover:text-slate-900 dark:hover:text-white">FAQ</a></li>
            <li><a href="/trip-planner" className="hover:text-slate-900 dark:hover:text-white">All destination guides</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200/80 py-5 text-center text-xs text-slate-400 dark:border-white/10">
        © {YEAR} WorldTour. Made for travelers.
      </div>
    </footer>
  )
}
