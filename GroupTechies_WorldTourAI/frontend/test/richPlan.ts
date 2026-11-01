// A plan shaped like the planner's real final output (every kind of field it produces).
export const richPlan = (): any => ({
  trip_summary: 'Ahmedabad to Goa, 3 days', origin: 'Ahmedabad', destination: 'Goa', cities: ['Goa'], cities_are_suggestions: false,
  dates: { start_date: '2026-12-10', end_date: '2026-12-12' }, duration: { days: 3, nights: 2 }, travelers: 2, pace: 'balanced', preferences: ['beaches', 'food'],
  budget: { amount: 60000, currency: 'INR', scope: 'total', user_stated: true, planning_budget: 721 },
  packages: [{ name: 'balanced', label: 'Balanced', total: 480.5, fits_budget: true, hotels: [{ option_id: 'h1', name: 'Hôtel Mar', price_per_night: 55, nights: 2 }] }],
  recommended_package: 'balanced', display_currency: 'INR', usd_to_display: 83,
  selected_flights: [{ option_id: 'f1', airline: 'IndiGo', price: 92, price_is_estimate: true }], return_flights: [],
  selected_hotels: [{ option_id: 'h1', name: 'Hôtel Mar', data_source: 'live', verified_on_map: true }],
  ground_options: [{ option_id: 'g1', kind: 'train', label: 'Sleeper', price_pp: 12, duration_minutes: 840, distance_km: 780 }],
  budget_breakdown: [{ category: 'Food', cost: 60, detail: 'about {money:15.00} per person per day' }],
  daily_itinerary: [{ day: 1, date: '2026-12-10', city: 'Goa', title: 'Arrive & Baga', morning: 'Land', midday: 'Lunch', evening: 'Beach', stay_name: 'Hôtel Mar', activities: [{ activity_id: 'a1', name: 'Baga Beach', start_minute: 900, end_minute: 1080, category: 'sightseeing', detail: 'Sunset', cost_usd: 0 }] }],
  weather_information: { data_source: 'open-meteo', summary: 'Sunny', days: [] }, attractions: [{ name: 'Baga Beach', category: 'beach', city: 'Goa' }],
  estimated_cost: 480.5, remaining_budget: 240.5, warnings: ['Schedule check: day 2 is light'], data_notes: ['Flight fares are estimates.'], parser_notes: [],
  provider_information: { flights: 'aviationstack' }, algorithms_actually_used: ['dijkstra'],
  verification: {
    attractions: { count: 5, level: 'provider', source: 'Geoapify (OpenStreetMap)' }, hotels: { level: 'real_hotels_estimated_rates', count: 3, unconfirmed: 0 },
    flights: { level: 'provider_schedule_estimated_fares', count: 4 }, ground_transport: { level: 'estimate' }, local_transport: { road_routing: 3, estimate: 1 },
    entry_fees: { level: 'estimate' }, opening_hours: { level: 'not_verified' }, schedule_checks: ['Schedule check: day 2 is light'],
  },
  some_future_field: { nested: [1, 2, { deep: true }], nothing: null },
})
