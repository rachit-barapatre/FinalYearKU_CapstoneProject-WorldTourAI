// Shapes returned by the WorldTour API. Only the fields the UI uses are typed.

export type Role = 'user' | 'assistant'
export interface ChatMessage {
  role: Role
  content: string
  at?: string
  /** A traveler message that never got an answer (e.g. the connection dropped). */
  failed?: boolean
}

export interface Summary {
  origin: string | null
  destination: string | null
  cities: string[]
  cities_are_suggestions: boolean
  start_date: string | null
  end_date: string | null
  duration_days: number | null
  budget: number | null
  currency: string | null
  budget_scope: string | null
  travelers: number | null
  pace: string | null
  preferences: string[]
  transport_preferences: string[]
  display_currency: string
  notes: string[]
}

export interface Session {
  stage: 'collecting' | 'feasibility' | 'ready' | 'planned'
  [key: string]: unknown
}

export interface ChatResponse {
  session: Session
  reply: string
  ready: boolean
  changes: string[]
  summary: Summary | null
}

export interface AgentEvent {
  event: string
  agent_id: string
  message: string
  timestamp: string
}

export interface Flight {
  option_id: string
  airline: string | null
  flight_number: string | null
  origin: string | null
  destination: string | null
  departure_time: string | null
  arrival_time: string | null
  duration_minutes: number | null
  stops: number | null
  via?: string | null
  price: number | null
  price_is_estimate?: boolean
  price_included?: boolean
  price_scope?: string
}

export interface GroundOption {
  option_id: string
  kind: 'train' | 'bus' | 'cab'
  label: string
  duration_minutes: number
  distance_km: number
  price_pp: number
  /** Everyone, one way (a cab is priced per vehicle, so this is not always price_pp × travelers). */
  price_total_one_way?: number
  overnight?: boolean
  booking_link?: string
}

export interface TransportChoice {
  kind: string
  label: string
  option_id?: string
  outbound_id?: string | null
  return_id?: string | null
  duration_minutes?: number | null
  round_trip_total: number
  door_to_door_minutes: number
  price_is_estimate?: boolean
  booking_link?: string | null
}

export interface PackageHotel {
  option_id: string
  name: string
  city: string | null
  price_per_night: number | null
  rating: number | null
  nights: number
  rooms?: number
}

export interface Package {
  name: 'budget' | 'balanced' | 'premium'
  label: string
  total: number
  fits_budget: boolean
  hotels: PackageHotel[]
  transport: TransportChoice | null
  transport_cost: number
  hotel_cost: number
  food_cost: number
  local_cost: number
  activities_cost?: number
}

export interface Hotel {
  option_id: string
  name: string
  city: string | null
  tier: string | null
  stars?: number | null
  price_per_night: number | null
  rating: number | null
  reviews?: number | null
  why?: string | null
  amenities?: string[]
  verified_on_map?: boolean
  data_source?: string
  link?: string | null
  lat?: number | null
  lon?: number | null
  distance_to_center_km?: number | null
  location?: string | null
}

export interface WeatherDay {
  day: number
  date: string
  city?: string
  condition: string
  temp_min_c: number | null
  temp_max_c: number | null
  precipitation_probability: number | null
  source?: string
}

export interface Activity {
  activity_id: string
  name: string
  start_minute: number
  end_minute: number
  category: string
  detail: string
  cost_usd?: number | null
  mode?: string | null
  lat?: number | null
  lon?: number | null
}

export interface ItineraryDay {
  day: number
  date: string | null
  city: string | null
  title: string
  morning: string
  midday: string
  evening: string
  stay_name: string
  stay: { name: string; option_id?: string | null; lat?: number | null; lon?: number | null } | null
  activities: Activity[]
  local_transport_usd?: number
  /** Set in the browser when a different way there or back changes what fits in the day. */
  notes?: string[]
}

export interface BreakdownRow {
  category: string
  cost: number
  detail?: string
  legs?: { from: string; to: string; distance_km: number; mode: string; cost: number }[]
}

export interface Pricing {
  travelers: number
  rooms: number
  nights: number | null
  intercity_cost: number
  country: string | null
  local_rates: { name: string; base: number; per_km: number }
  airport_km: number
  station_km: number
}

export interface Plan {
  trip_summary: string
  origin: string | null
  destination: string | null
  dates: { start_date: string | null; end_date: string | null; planned_start?: string | null }
  duration: { days: number | null; nights: number | null }
  travelers: number | null
  pace: string | null
  preferences: string[]
  budget: { amount: number | null; currency: string | null; scope: string | null; user_stated: boolean; planning_budget: number | null }
  packages: Package[]
  recommended_package: string | null
  display_currency: string
  usd_to_display: number
  transport_choice: TransportChoice | null
  ground_options: GroundOption[]
  road_km: number | null
  selected_flights: Flight[]
  return_flights: Flight[]
  selected_hotels: Hotel[]
  recommended_hotel_ids: string[]
  recommended_outbound_id: string | null
  recommended_return_id: string | null
  budget_breakdown: BreakdownRow[]
  daily_itinerary: ItineraryDay[]
  daily_spend: { detail?: string } | null
  weather_information: { data_source: string | null; summary: string | null; days: WeatherDay[]; dates_assumed?: boolean }
  packing_tips: string[]
  links: {
    flights?: string
    ground?: { label: string; url: string }
    hotels?: { name: string; url: string }[]
    places?: { day: number; name: string; url: string }[]
  }
  estimated_cost: number
  remaining_budget: number | null
  warnings: string[]
  data_notes: string[]
  parser_notes: string[]
  cities: string[]
  cities_are_suggestions: boolean
  algorithms_actually_used: string[]
  attractions?: { name: string; category?: string; city?: string | null }[]
  pricing?: Pricing
  routes: { dijkstra: { path: string[]; total_cost_km: number } | null }
}
