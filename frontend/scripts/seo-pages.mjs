// Builds static, crawlable destination guides (dist/trip-planner/<slug>.html, served at /trip-planner/<slug>
// through the rewrites in vercel.json), the guide index and
// sitemap.xml after `vite build`. Each guide answers common searches ("Goa trip planner", "Jaipur itinerary
// 3 days") with plain HTML that loads instantly, and links into the planner with the prompt pre-filled.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://worldtour-xi.vercel.app'
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const TODAY = new Date().toISOString().slice(0, 10)

const GUIDES = [
  {
    slug: 'goa', name: 'Goa', region: 'India', days: '4–5', best: 'November to February (dry, sunny and 21–32 °C); the monsoon runs June to September.',
    reach: 'Fly into Dabolim (GOI) or Manohar International at Mopa (GOX). By rail, Madgaon (MAO) and Thivim are the main stations on the Konkan Railway.',
    sights: ['Baga and Calangute beaches', 'Fort Aguada', 'Basilica of Bom Jesus, Old Goa', 'Anjuna flea market', 'Dudhsagar Falls', 'Palolem Beach'],
    prompt: 'Plan a 4 day trip to Goa from Mumbai for 2 people under ₹40,000, beaches and food, relaxed',
    blurb: 'beaches, Portuguese churches, forts and seafood',
  },
  {
    slug: 'jaipur', name: 'Jaipur', region: 'Rajasthan, India', days: '2–3', best: 'October to March, when days are pleasant; April to June is very hot.',
    reach: 'Jaipur International Airport (JAI) is about 12 km from the old city. Jaipur Junction has fast trains from Delhi (about 4–5 hours).',
    sights: ['Amber (Amer) Fort', 'Hawa Mahal', 'City Palace', 'Jantar Mantar', 'Nahargarh Fort', 'Albert Hall Museum'],
    prompt: 'Delhi to Jaipur by train, 3 days for 2 people, ₹30,000, history and culture',
    blurb: 'forts, palaces and the bazaars of the Pink City',
  },
  {
    slug: 'kerala', name: 'Kerala', region: 'India', days: '5–6', best: 'September to March; the backwaters and hills are greenest just after the monsoon.',
    reach: 'Fly into Cochin International (COK). Ernakulam Junction is the main railway station for Kochi, with roads on to Munnar and Alleppey.',
    sights: ['Fort Kochi and the Chinese fishing nets', 'Munnar tea gardens', 'Alleppey backwaters by houseboat', 'Eravikulam National Park', 'Mattancherry Palace'],
    prompt: '6 days in Kerala (Kochi, Munnar, Alleppey) from Bengaluru for 2 people, ₹70,000, nature and relaxed',
    blurb: 'backwaters, tea hills and the old port of Kochi',
  },
  {
    slug: 'manali', name: 'Manali', region: 'Himachal Pradesh, India', days: '4–5', best: 'March to June for pleasant weather; December to February for snow.',
    reach: 'The nearest airport is Bhuntar (KUU), about 50 km away. Most travellers take an overnight Volvo bus from Delhi or a train to Chandigarh and continue by road.',
    sights: ['Hadimba Temple', 'Old Manali', 'Solang Valley', 'Atal Tunnel and Sissu', 'Vashisht hot springs'],
    prompt: '5 days in Manali from Delhi for 2 people, ₹45,000, mountains and adventure',
    blurb: 'snow valleys, pine forests and mountain adventure',
  },
  {
    slug: 'udaipur', name: 'Udaipur', region: 'Rajasthan, India', days: '2–3', best: 'September to March, when the lakes are full and evenings are cool.',
    reach: 'Maharana Pratap Airport (UDR) is about 22 km from the city. Udaipur City railway station has trains from Delhi, Jaipur and Mumbai.',
    sights: ['City Palace', 'Lake Pichola boat ride', 'Jag Mandir', 'Saheliyon-ki-Bari', 'Fateh Sagar Lake', 'Bagore Ki Haveli'],
    prompt: '3 days in Udaipur from Ahmedabad for 2 people, ₹35,000, culture and relaxed',
    blurb: 'lake palaces, havelis and sunset boat rides',
  },
  {
    slug: 'varanasi', name: 'Varanasi', region: 'Uttar Pradesh, India', days: '2–3', best: 'October to March; dawn boat rides are best in winter.',
    reach: 'Lal Bahadur Shastri Airport (VNS) is about 25 km away. Varanasi Junction has trains from Delhi, Kolkata and Mumbai.',
    sights: ['Ganga aarti at Dashashwamedh Ghat', 'Kashi Vishwanath Temple', 'Sunrise boat ride on the Ganges', 'Sarnath', 'Assi Ghat'],
    prompt: '3 days in Varanasi from Delhi by train for 2 people, ₹25,000, culture and spiritual',
    blurb: 'ghats, temples and the evening Ganga aarti',
  },
  {
    slug: 'rishikesh', name: 'Rishikesh', region: 'Uttarakhand, India', days: '2–3', best: 'September to November and February to May; rafting pauses in the monsoon.',
    reach: 'Jolly Grant Airport, Dehradun (DED) is about 35 km away. Haridwar Junction and Yog Nagari Rishikesh are the nearest railway stations.',
    sights: ['Laxman Jhula and Ram Jhula', 'Triveni Ghat aarti', 'White-water rafting on the Ganges', 'The Beatles Ashram', 'Neelkanth Mahadev Temple'],
    prompt: '3 days in Rishikesh from Delhi for 2 people, ₹20,000, adventure and yoga',
    blurb: 'yoga, rafting and riverside temples',
  },
  {
    slug: 'ladakh', name: 'Leh Ladakh', region: 'India', days: '6–7', best: 'May to September, when the high passes are open.',
    reach: 'Fly into Leh (IXL) and rest for a day or two to acclimatise; there is no railway. Road trips come over the Manali–Leh and Srinagar–Leh highways.',
    sights: ['Pangong Tso', 'Nubra Valley and Diskit Monastery', 'Khardung La', 'Leh Palace', 'Shanti Stupa', 'Thiksey Monastery'],
    prompt: '7 days in Leh Ladakh from Delhi for 2 people in June, ₹90,000, mountains and nature',
    blurb: 'high passes, blue lakes and monasteries',
  },
  {
    slug: 'andaman', name: 'Andaman Islands', region: 'India', days: '5–6', best: 'October to May, when the sea is calm for ferries and diving.',
    reach: 'Fly into Veer Savarkar International Airport, Port Blair (IXZ), then take ferries to Havelock (Swaraj Dweep) and Neil (Shaheed Dweep).',
    sights: ['Cellular Jail and light show', 'Radhanagar Beach, Havelock', 'Neil Island', 'Scuba diving and snorkelling', 'Ross Island'],
    prompt: '6 days in the Andaman Islands from Chennai for 2 people, ₹1 lakh, beaches and diving',
    blurb: 'white beaches, coral reefs and island hopping',
  },
  {
    slug: 'dubai', name: 'Dubai', region: 'United Arab Emirates', days: '4–5', best: 'November to March; summers are extremely hot.',
    reach: 'Dubai International (DXB) has direct flights from most Indian cities (about 3–4 hours). The metro links the airport to the city.',
    sights: ['Burj Khalifa', 'Dubai Mall and fountain show', 'Old Dubai, Al Fahidi and the souks', 'Desert safari', 'Dubai Marina', 'Palm Jumeirah'],
    prompt: '5 days in Dubai from Mumbai for 2 people, ₹1.5 lakh, shopping and culture',
    blurb: 'skyline views, souks and the desert',
  },
  {
    slug: 'bali', name: 'Bali', region: 'Indonesia', days: '5–7', best: 'April to October, the dry season.',
    reach: 'Fly into Ngurah Rai International, Denpasar (DPS). Most visitors base themselves in Ubud and a beach area such as Seminyak or Uluwatu.',
    sights: ['Tegallalang rice terraces, Ubud', 'Uluwatu Temple', 'Tanah Lot', 'Mount Batur sunrise trek', 'Seminyak beaches'],
    prompt: '6 days in Bali from Mumbai for a couple, ₹1.2 lakh, beaches and nature, relaxed',
    blurb: 'rice terraces, temples and beaches',
  },
  {
    slug: 'bangkok', name: 'Bangkok', region: 'Thailand', days: '3–4', best: 'November to February, the cool, dry season.',
    reach: 'Fly into Suvarnabhumi (BKK) or Don Mueang (DMK). The Airport Rail Link and BTS Skytrain connect to the centre.',
    sights: ['Grand Palace', 'Wat Pho', 'Wat Arun', 'Chatuchak Weekend Market', 'A floating market', 'Chao Phraya river boat'],
    prompt: '4 days in Bangkok from Delhi for 2 people, ₹80,000, food and shopping',
    blurb: 'temples, street food and markets',
  },
  {
    slug: 'singapore', name: 'Singapore', region: 'Singapore', days: '4', best: 'All year; February to April is usually driest.',
    reach: 'Fly into Changi (SIN). The MRT metro reaches almost every sight cheaply.',
    sights: ['Gardens by the Bay', 'Marina Bay Sands', 'Sentosa Island', 'Chinatown and Little India', 'Singapore Zoo and Night Safari'],
    prompt: '4 days in Singapore from Chennai for a family of 4, ₹2 lakh, entertainment and food',
    blurb: 'gardens, skyline and family attractions',
  },
  {
    slug: 'paris', name: 'Paris', region: 'France', days: '4–5', best: 'April to June and September to October.',
    reach: 'Fly into Charles de Gaulle (CDG) or Orly (ORY). The RER and Métro cover the whole city.',
    sights: ['Eiffel Tower', 'The Louvre', 'Notre-Dame', 'Montmartre and Sacré-Cœur', 'Seine river cruise', 'Palace of Versailles (day trip)'],
    prompt: 'A relaxed week in Paris from London for 2 people, budget 3000 EUR, museums and food',
    blurb: 'museums, cafés and boulevards',
  },
]

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;background:#f4f6f9;line-height:1.6}
a{color:#1f4a8c}header{background:#10284d;color:#fff;border-bottom:3px solid #ee8a1f}.wrap{max-width:900px;margin:0 auto;padding:0 20px}
.bar{display:flex;align-items:center;justify-content:space-between;height:60px}.logo{color:#fff;text-decoration:none;font-weight:800;font-size:19px}
.hero{padding:40px 0 34px}.crumbs{font-size:13px;opacity:.8}.crumbs a{color:#fff}h1{font-size:clamp(28px,5vw,40px);line-height:1.15;margin:8px 0 12px}
.lead{font-size:17px;opacity:.9;max-width:680px}.cta{display:inline-block;margin-top:18px;background:#ee8a1f;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px}
.cta:hover{background:#d47212}main{padding:28px 0 48px}section{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;margin-bottom:16px}
h2{font-size:20px;margin:0 0 8px;color:#10284d}ul{padding-left:20px;margin:6px 0}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.fact{background:#f0f4fa;border-radius:8px;padding:12px 14px}.fact b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#3a61a3}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.card{display:block;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-decoration:none;color:#0f172a}
.card:hover{border-color:#1f4a8c}.card b{font-size:17px;color:#10284d}footer{color:#64748b;font-size:13px;padding:24px 0 40px}`

function page({ title, description, path, body, jsonLd }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="${SITE}${path}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#10284d" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="WorldTour" />
<meta property="og:url" content="${SITE}${path}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>${CSS}</style>
</head>
<body>
<header><div class="wrap"><div class="bar"><a class="logo" href="/"><img src="/logo-globe.svg" alt="" width="36" height="36" style="vertical-align:middle;margin-right:8px">WorldTour</a><a class="cta" style="margin:0;padding:8px 14px" href="/">Plan a trip</a></div></div></header>
${body}
<footer><div class="wrap">© ${new Date().getFullYear()} WorldTour · Free AI trip planner · <a href="/trip-planner">All destination guides</a> · Prices in the planner are estimates; confirm on booking sites.</div></footer>
</body>
</html>
`
}

function guidePage(g) {
  const path = `/trip-planner/${g.slug}`
  const title = `${g.name} Trip Planner — ${g.days} Day Itinerary & Budget | WorldTour`
  const description = `Plan your ${g.name} trip free with AI: a ${g.days} day itinerary, best time to visit, how to reach, top places (${g.sights.slice(0, 3).join(', ')}), hotels and a full budget in ₹.`
  const link = `/?q=${encodeURIComponent(g.prompt)}`
  const faq = [
    { q: `How many days are enough for ${g.name}?`, a: `${g.days} days covers the main sights of ${g.name} at a comfortable pace. WorldTour fits the plan to the number of days you choose.` },
    { q: `What is the best time to visit ${g.name}?`, a: g.best },
    { q: `How do I reach ${g.name}?`, a: g.reach },
    { q: `How much does a ${g.name} trip cost?`, a: `It depends on where you start, your dates and hotel class. WorldTour prices travel, hotels, food, local transport and entry fees for your exact trip and shows Budget, Balanced and Premium packages.` },
  ]
  const others = GUIDES.filter((o) => o.slug !== g.slug).slice(0, 6)
  const body = `<div class="hero" style="background:#10284d;color:#fff;margin-top:-1px"><div class="wrap">
<div class="crumbs"><a href="/">WorldTour</a> › <a href="/trip-planner">Trip planners</a> › ${esc(g.name)}</div>
<h1>${esc(g.name)} Trip Planner: ${esc(g.days)} Day Itinerary, Budget &amp; Hotels</h1>
<p class="lead">Plan a ${esc(g.name)} trip for ${esc(g.blurb)} in about a minute. Tell WorldTour where you are starting from, your dates and budget — it compares flights${g.region.includes('India') ? ', trains and buses' : ''} and hotels and builds an hour-by-hour itinerary with every cost in ₹.</p>
<a class="cta" href="${link}">Plan my ${esc(g.name)} trip — free</a>
</div></div>
<main><div class="wrap">
<section><h2>${esc(g.name)} at a glance</h2><div class="facts">
<div class="fact"><b>Ideal length</b>${esc(g.days)} days</div>
<div class="fact"><b>Best time to visit</b>${esc(g.best)}</div>
<div class="fact"><b>Where</b>${esc(g.region)}</div>
</div></section>
<section><h2>How to reach ${esc(g.name)}</h2><p>${esc(g.reach)}</p></section>
<section><h2>Top places to visit in ${esc(g.name)}</h2><ul>${g.sights.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<p>WorldTour groups nearby places on the same day, keeps outdoor sights off rainy days and the midday heat, and adds every cab or walk between them with time and fare.</p></section>
<section><h2>Sample request</h2><p>“${esc(g.prompt)}”</p><a class="cta" href="${link}">Use this and customise it</a></section>
<section><h2>${esc(g.name)} trip FAQ</h2>${faq.map((f) => `<h3 style="font-size:16px;margin:14px 0 4px">${esc(f.q)}</h3><p style="margin:0">${esc(f.a)}</p>`).join('')}</section>
<section><h2>More trip planners</h2><div class="grid">${others.map((o) => `<a class="card" href="/trip-planner/${o.slug}"><b>${esc(o.name)}</b><br><span style="color:#64748b;font-size:14px">${esc(o.days)} days · ${esc(o.blurb)}</span></a>`).join('')}</div></section>
</div></main>`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'WorldTour', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Trip planners', item: `${SITE}/trip-planner` },
          { '@type': 'ListItem', position: 3, name: `${g.name} trip planner`, item: `${SITE}${path}` },
        ],
      },
      {
        '@type': 'TouristDestination',
        name: g.name,
        description: `${g.name}: ${g.blurb}.`,
        containedInPlace: { '@type': 'Place', name: g.region },
        includesAttraction: g.sights.map((s) => ({ '@type': 'TouristAttraction', name: s })),
      },
      { '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  }
  return { path, html: page({ title, description, path, body, jsonLd }) }
}

function indexPage() {
  const path = '/trip-planner'
  const india = GUIDES.filter((g) => g.region.includes('India'))
  const abroad = GUIDES.filter((g) => !g.region.includes('India'))
  const cards = (list) => `<div class="grid">${list.map((g) => `<a class="card" href="/trip-planner/${g.slug}"><b>${esc(g.name)} trip planner</b><br><span style="color:#64748b;font-size:14px">${esc(g.days)} days · ${esc(g.blurb)}</span></a>`).join('')}</div>`
  const body = `<div class="hero" style="background:#10284d;color:#fff;margin-top:-1px"><div class="wrap">
<div class="crumbs"><a href="/">WorldTour</a> › Trip planners</div>
<h1>Trip Planners &amp; Itinerary Guides</h1>
<p class="lead">Free AI itineraries for India's most popular trips and favourite international getaways — with the best time to visit, how to get there, top places and a full budget.</p>
<a class="cta" href="/">Plan any trip</a></div></div>
<main><div class="wrap"><section><h2>Trips in India</h2>${cards(india)}</section><section><h2>International trips</h2>${cards(abroad)}</section></div></main>`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'WorldTour trip planners',
    itemListElement: GUIDES.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/trip-planner/${g.slug}`, name: `${g.name} trip planner` })),
  }
  return {
    path,
    html: page({
      title: 'Trip Planners & Itinerary Guides — India and Abroad | WorldTour',
      description: 'Free AI trip planners for Goa, Jaipur, Kerala, Manali, Udaipur, Ladakh, Dubai, Bali, Bangkok, Singapore and Paris: itineraries, best time to visit and budgets.',
      path,
      body,
      jsonLd,
    }),
  }
}

const pages = [indexPage(), ...GUIDES.map(guidePage)]
for (const { path, html } of pages) {
  const file = join(DIST, `${path}.html`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}
const urls = [{ loc: `${SITE}/`, priority: '1.0' }, ...pages.map((p) => ({ loc: `${SITE}${p.path}`, priority: p.path === '/trip-planner' ? '0.9' : '0.8' }))]
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u.loc}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`)
    .join('\n')}\n</urlset>\n`,
)
console.log(`SEO: wrote ${pages.length} guide pages and sitemap.xml (${urls.length} URLs)`)
