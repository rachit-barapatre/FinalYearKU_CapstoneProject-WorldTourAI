const EMOJI: Record<string, string> = {
  clear: '☀️',
  'partly cloudy': '⛅',
  overcast: '☁️',
  fog: '🌫️',
  drizzle: '🌦️',
  rain: '🌧️',
  snow: '❄️',
  thunderstorm: '⛈️',
}

export function weatherEmoji(condition: string | null | undefined): string {
  return EMOJI[condition ?? ''] ?? '🌤️'
}
