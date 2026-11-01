// Chatbot text in English, Hindi, Gujarati and Marathi. The assistant's own replies are translated by
// the API; these are the parts the browser writes (labels, buttons, the welcome and local updates).

export type Lang = 'en' | 'hi' | 'gu' | 'mr'

export const LANGUAGES: { code: Lang; label: string; short: string; speech: string }[] = [
  { code: 'en', label: 'English', short: 'EN', speech: 'en-IN' },
  { code: 'hi', label: 'हिन्दी', short: 'हि', speech: 'hi-IN' },
  { code: 'gu', label: 'ગુજરાતી', short: 'ગુ', speech: 'gu-IN' },
  { code: 'mr', label: 'मराठी', short: 'म', speech: 'mr-IN' },
]

const en = {
  assistant: 'Travel assistant',
  online: 'Online · replies in seconds',
  typing: 'Typing…',
  building: 'Building your plan…',
  offline: "You're offline",
  offlineBusy: "You're offline — we'll carry on when you're back",
  placeholder: 'Type your reply…',
  placeholderPlan: 'Ask for a change, e.g. "by train"',
  hint: 'Enter to send · Shift + Enter for a new line',
  welcome:
    "Hi, I'm your WorldTour travel assistant. Tell me where you'd like to go, from where, for how long, your budget and who's coming.\n\n" +
    "I'll ask for anything missing, check the trip is realistic, then plan transport, hotels, weather and an hour-by-hour itinerary.",
  planReady:
    'Your plan is ready! Explore it on the right. To change anything, just tell me — for example "premium", "by train", "more relaxed", "5 days" or "remove <place>".',
  planningTitle: 'Planning your trip',
  planningNote: 'Comparing transport, hotels, weather and places — usually under a minute.',
  steps: '{done} of {total} steps',
  notSent: 'Not sent',
  sendAgain: 'Send again',
  planAgain: 'Try planning again',
  pickDates: 'Pick dates',
  flexible: "I'm flexible",
  changeDates: 'Change dates',
  moreRelaxed: 'More relaxed',
  moreActivities: 'More activities',
  byFlight: 'By flight',
  byTrain: 'By train',
  days: '{n} days',
  yesApply: 'Yes, apply suggestions',
  continueAsIs: 'Continue as is',
  calendarAsk: 'Pick your travel dates',
  calendarChange: 'Change your travel dates',
  tapStart: 'Tap your start date',
  tapReturn: 'tap a return date (optional)',
  clear: 'Clear',
  useDates: 'Use these dates',
  useDate: 'Use this date',
  switchedPackage: 'Switched to the {pkg} package — {travel} and {hotels}. Your day-by-day plan stays the same; the new total is {total}.',
  switchedMode: "Done — you'll travel by {travel}. I've updated the arrival and departure days and the costs; the rest of the itinerary is unchanged. New total: {total}.",
  language: 'Language',
  speak: 'Speak your message',
  listening: 'Listening… tap to stop',
  voiceUnsupported: 'Voice input works in Chrome, Edge and Safari',
  micBlocked: 'Allow microphone access in your browser to speak your message.',
  readAloud: 'Read replies aloud',
  stopReading: 'Stop reading replies aloud',
  noVoice: 'This device has no {lang} voice, so replies can’t be read aloud. Chrome on Android usually has one.',
  packages: { budget: 'Budget', balanced: 'Balanced', premium: 'Premium' },
}

type Strings = typeof en

const hi: Strings = {
  assistant: 'यात्रा सहायक',
  online: 'ऑनलाइन · कुछ ही सेकंड में जवाब',
  typing: 'लिख रहा है…',
  building: 'आपकी योजना बन रही है…',
  offline: 'आप ऑफ़लाइन हैं',
  offlineBusy: 'आप ऑफ़लाइन हैं — कनेक्शन लौटते ही हम आगे बढ़ेंगे',
  placeholder: 'अपना जवाब लिखें…',
  placeholderPlan: 'कोई बदलाव बताएं, जैसे "ट्रेन से"',
  hint: 'भेजने के लिए Enter · नई पंक्ति के लिए Shift + Enter',
  welcome:
    'नमस्ते, मैं आपका WorldTour यात्रा सहायक हूँ। बताइए आप कहाँ जाना चाहते हैं, कहाँ से, कितने दिनों के लिए, आपका बजट क्या है और कौन-कौन साथ आ रहा है।\n\n' +
    'जो जानकारी कम होगी वह मैं पूछ लूँगा, यात्रा व्यावहारिक है या नहीं जाँचूँगा, फिर यातायात, होटल, मौसम और घंटे-दर-घंटे की यात्रा योजना बनाऊँगा।',
  planReady: 'आपकी योजना तैयार है! इसे दाईं ओर देखें। कुछ भी बदलना हो तो बताइए — जैसे "प्रीमियम", "ट्रेन से", "ज़्यादा आराम से" या "5 दिन"।',
  planningTitle: 'आपकी यात्रा की योजना बन रही है',
  planningNote: 'यातायात, होटल, मौसम और जगहों की तुलना हो रही है — आमतौर पर एक मिनट से कम।',
  steps: '{total} में से {done} चरण',
  notSent: 'नहीं भेजा गया',
  sendAgain: 'फिर से भेजें',
  planAgain: 'फिर से योजना बनाएं',
  pickDates: 'तारीखें चुनें',
  flexible: 'तारीखें तय नहीं',
  changeDates: 'तारीखें बदलें',
  moreRelaxed: 'ज़्यादा आराम से',
  moreActivities: 'ज़्यादा गतिविधियाँ',
  byFlight: 'फ़्लाइट से',
  byTrain: 'ट्रेन से',
  days: '{n} दिन',
  yesApply: 'हाँ, सुझाव लागू करें',
  continueAsIs: 'ऐसे ही जारी रखें',
  calendarAsk: 'अपनी यात्रा की तारीखें चुनें',
  calendarChange: 'अपनी यात्रा की तारीखें बदलें',
  tapStart: 'शुरुआत की तारीख चुनें',
  tapReturn: 'वापसी की तारीख चुनें (वैकल्पिक)',
  clear: 'हटाएं',
  useDates: 'ये तारीखें रखें',
  useDate: 'यह तारीख रखें',
  switchedPackage: '{pkg} पैकेज चुना गया — {travel} और {hotels}। आपकी दिन-ब-दिन योजना वही रहेगी; नया कुल खर्च {total} है।',
  switchedMode: 'हो गया — आप {travel} से यात्रा करेंगे। पहुँचने और लौटने के दिन और खर्च बदल दिए गए हैं; बाकी योजना वही है। नया कुल: {total}।',
  language: 'भाषा',
  speak: 'बोलकर संदेश भेजें',
  listening: 'सुन रहा हूँ… रोकने के लिए टैप करें',
  voiceUnsupported: 'बोलकर लिखना Chrome, Edge और Safari में काम करता है',
  micBlocked: 'बोलकर संदेश भेजने के लिए ब्राउज़र में माइक्रोफ़ोन की अनुमति दें।',
  readAloud: 'जवाब पढ़कर सुनाएं',
  stopReading: 'जवाब पढ़ना बंद करें',
  noVoice: 'इस डिवाइस में {lang} आवाज़ नहीं है, इसलिए जवाब पढ़कर नहीं सुनाए जा सकते। Android पर Chrome में आमतौर पर यह होती है।',
  packages: { budget: 'बजट', balanced: 'संतुलित', premium: 'प्रीमियम' },
}

const gu: Strings = {
  assistant: 'પ્રવાસ સહાયક',
  online: 'ઓનલાઇન · થોડી સેકન્ડમાં જવાબ',
  typing: 'લખી રહ્યું છે…',
  building: 'તમારી યોજના બની રહી છે…',
  offline: 'તમે ઓફલાઇન છો',
  offlineBusy: 'તમે ઓફલાઇન છો — કનેક્શન પાછું આવતાં જ આગળ વધીશું',
  placeholder: 'તમારો જવાબ લખો…',
  placeholderPlan: 'કોઈ ફેરફાર જણાવો, જેમ કે "ટ્રેનથી"',
  hint: 'મોકલવા Enter · નવી લાઇન માટે Shift + Enter',
  welcome:
    'નમસ્તે, હું તમારો WorldTour પ્રવાસ સહાયક છું. મને કહો તમે ક્યાં જવા માંગો છો, ક્યાંથી, કેટલા દિવસ માટે, તમારું બજેટ અને કોણ કોણ સાથે આવે છે.\n\n' +
    'જે માહિતી ખૂટતી હશે તે હું પૂછીશ, પ્રવાસ શક્ય છે કે નહીં તે તપાસીશ, પછી વાહનવ્યવહાર, હોટેલ, હવામાન અને કલાકે-કલાકની યોજના બનાવીશ.',
  planReady: 'તમારી યોજના તૈયાર છે! તેને જમણી બાજુ જુઓ. કંઈ બદલવું હોય તો કહો — જેમ કે "પ્રીમિયમ", "ટ્રેનથી", "વધુ આરામથી" અથવા "5 દિવસ".',
  planningTitle: 'તમારા પ્રવાસની યોજના બની રહી છે',
  planningNote: 'વાહનવ્યવહાર, હોટેલ, હવામાન અને સ્થળોની સરખામણી થઈ રહી છે — સામાન્ય રીતે એક મિનિટથી ઓછું.',
  steps: '{total} માંથી {done} પગલાં',
  notSent: 'મોકલાયું નથી',
  sendAgain: 'ફરી મોકલો',
  planAgain: 'ફરી યોજના બનાવો',
  pickDates: 'તારીખો પસંદ કરો',
  flexible: 'તારીખો નક્કી નથી',
  changeDates: 'તારીખો બદલો',
  moreRelaxed: 'વધુ આરામથી',
  moreActivities: 'વધુ પ્રવૃત્તિઓ',
  byFlight: 'ફ્લાઇટથી',
  byTrain: 'ટ્રેનથી',
  days: '{n} દિવસ',
  yesApply: 'હા, સૂચનો લાગુ કરો',
  continueAsIs: 'એમ જ ચાલુ રાખો',
  calendarAsk: 'તમારી પ્રવાસની તારીખો પસંદ કરો',
  calendarChange: 'તમારી પ્રવાસની તારીખો બદલો',
  tapStart: 'શરૂઆતની તારીખ પસંદ કરો',
  tapReturn: 'પાછા ફરવાની તારીખ પસંદ કરો (વૈકલ્પિક)',
  clear: 'સાફ કરો',
  useDates: 'આ તારીખો રાખો',
  useDate: 'આ તારીખ રાખો',
  switchedPackage: '{pkg} પેકેજ પસંદ થયું — {travel} અને {hotels}. તમારી દિવસવાર યોજના એ જ રહેશે; નવો કુલ ખર્ચ {total} છે.',
  switchedMode: 'થઈ ગયું — તમે {travel} થી પ્રવાસ કરશો. પહોંચવાના અને પાછા ફરવાના દિવસો અને ખર્ચ બદલાયા છે; બાકીની યોજના એ જ છે. નવો કુલ: {total}.',
  language: 'ભાષા',
  speak: 'બોલીને સંદેશ મોકલો',
  listening: 'સાંભળી રહ્યું છે… રોકવા ટેપ કરો',
  voiceUnsupported: 'બોલીને લખવાનું Chrome, Edge અને Safari માં ચાલે છે',
  micBlocked: 'બોલીને સંદેશ મોકલવા બ્રાઉઝરમાં માઇક્રોફોનની પરવાનગી આપો.',
  readAloud: 'જવાબ વાંચીને સંભળાવો',
  stopReading: 'જવાબ વાંચવાનું બંધ કરો',
  noVoice: 'આ ડિવાઇસમાં {lang} અવાજ નથી, તેથી જવાબ વાંચીને સંભળાવી શકાતા નથી. Android પર Chrome માં સામાન્ય રીતે હોય છે.',
  packages: { budget: 'બજેટ', balanced: 'સંતુલિત', premium: 'પ્રીમિયમ' },
}

const mr: Strings = {
  assistant: 'प्रवास सहाय्यक',
  online: 'ऑनलाइन · काही सेकंदांत उत्तर',
  typing: 'लिहित आहे…',
  building: 'तुमची योजना तयार होत आहे…',
  offline: 'तुम्ही ऑफलाइन आहात',
  offlineBusy: 'तुम्ही ऑफलाइन आहात — कनेक्शन परत आल्यावर पुढे जाऊ',
  placeholder: 'तुमचे उत्तर लिहा…',
  placeholderPlan: 'बदल सांगा, उदा. "ट्रेनने"',
  hint: 'पाठवण्यासाठी Enter · नवीन ओळीसाठी Shift + Enter',
  welcome:
    'नमस्कार, मी तुमचा WorldTour प्रवास सहाय्यक आहे. तुम्हाला कुठे जायचे आहे, कुठून, किती दिवसांसाठी, तुमचे बजेट आणि कोण कोण येत आहे ते सांगा.\n\n' +
    'जी माहिती कमी असेल ती मी विचारेन, प्रवास शक्य आहे का ते तपासेन, मग प्रवासाचे साधन, हॉटेल, हवामान आणि तासा-तासाची योजना तयार करेन.',
  planReady: 'तुमची योजना तयार आहे! ती उजवीकडे पाहा. काही बदलायचे असल्यास सांगा — उदा. "प्रीमियम", "ट्रेनने", "अधिक आरामात" किंवा "5 दिवस".',
  planningTitle: 'तुमच्या प्रवासाची योजना तयार होत आहे',
  planningNote: 'प्रवासाचे साधन, हॉटेल, हवामान आणि ठिकाणांची तुलना होत आहे — साधारणपणे एका मिनिटापेक्षा कमी.',
  steps: '{total} पैकी {done} टप्पे',
  notSent: 'पाठवले नाही',
  sendAgain: 'पुन्हा पाठवा',
  planAgain: 'पुन्हा योजना करा',
  pickDates: 'तारखा निवडा',
  flexible: 'तारखा ठरलेल्या नाहीत',
  changeDates: 'तारखा बदला',
  moreRelaxed: 'अधिक आरामात',
  moreActivities: 'अधिक उपक्रम',
  byFlight: 'विमानाने',
  byTrain: 'ट्रेनने',
  days: '{n} दिवस',
  yesApply: 'हो, सूचना लागू करा',
  continueAsIs: 'असेच सुरू ठेवा',
  calendarAsk: 'तुमच्या प्रवासाच्या तारखा निवडा',
  calendarChange: 'तुमच्या प्रवासाच्या तारखा बदला',
  tapStart: 'सुरुवातीची तारीख निवडा',
  tapReturn: 'परतीची तारीख निवडा (ऐच्छिक)',
  clear: 'काढा',
  useDates: 'या तारखा ठेवा',
  useDate: 'ही तारीख ठेवा',
  switchedPackage: '{pkg} पॅकेज निवडले — {travel} आणि {hotels}. तुमची दिवसवार योजना तशीच राहील; नवीन एकूण खर्च {total} आहे.',
  switchedMode: 'झाले — तुम्ही {travel} ने प्रवास कराल. पोहोचण्याचे आणि परतीचे दिवस व खर्च बदलले आहेत; बाकी योजना तशीच आहे. नवीन एकूण: {total}.',
  language: 'भाषा',
  speak: 'बोलून संदेश पाठवा',
  listening: 'ऐकत आहे… थांबवण्यासाठी टॅप करा',
  voiceUnsupported: 'बोलून लिहिणे Chrome, Edge आणि Safari मध्ये चालते',
  micBlocked: 'बोलून संदेश पाठवण्यासाठी ब्राउझरमध्ये मायक्रोफोनची परवानगी द्या.',
  readAloud: 'उत्तरे वाचून दाखवा',
  stopReading: 'उत्तरे वाचणे थांबवा',
  noVoice: 'या डिव्हाइसवर {lang} आवाज नाही, म्हणून उत्तरे वाचून दाखवता येत नाहीत. Android वरील Chrome मध्ये सहसा असतो.',
  packages: { budget: 'बजेट', balanced: 'संतुलित', premium: 'प्रीमियम' },
}

const TABLE: Record<Lang, Strings> = { en, hi, gu, mr }

type Key = Exclude<keyof Strings, 'packages'>

/** A chatbot string in the given language, with {placeholders} filled in. */
export function t(lang: Lang, key: Key, values: Record<string, string | number> = {}): string {
  const text = (TABLE[lang] ?? en)[key] ?? en[key]
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
}

export function packageLabel(lang: Lang, name: 'budget' | 'balanced' | 'premium'): string {
  return (TABLE[lang] ?? en).packages[name]
}

export function speechCode(lang: Lang): string {
  return LANGUAGES.find((l) => l.code === lang)?.speech ?? 'en-IN'
}

/** The welcome message in any language, so a saved English welcome is shown in the chosen one. */
export const WELCOMES = new Set(Object.values(TABLE).map((s) => s.welcome))
