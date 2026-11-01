import 'leaflet/dist/leaflet.css'
import type { LatLngTuple } from 'leaflet'
import { useEffect } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { ItineraryDay } from '../../lib/types'

interface Stop {
  name: string
  position: LatLngTuple
  hotel?: boolean
}

function FitBounds({ stops }: { stops: Stop[] }) {
  const map = useMap()
  useEffect(() => {
    if (stops.length === 1) map.setView(stops[0].position, 14)
    else if (stops.length > 1) map.fitBounds(stops.map((s) => s.position), { padding: [30, 30] })
  }, [map, stops])
  return null
}

/** Today's stops in visiting order, starting and ending at the hotel. */
export function DayMap({ day }: { day: ItineraryDay }) {
  const stops: Stop[] = []
  const hotel = day.stay?.lat != null && day.stay?.lon != null ? { name: day.stay.name, position: [day.stay.lat, day.stay.lon] as LatLngTuple, hotel: true } : null
  if (hotel) stops.push(hotel)
  for (const activity of day.activities) {
    if (activity.lat == null || activity.lon == null) continue
    if (['travel', 'transfer', 'stay', 'meal'].includes(activity.category)) continue
    stops.push({ name: activity.name, position: [activity.lat, activity.lon] })
  }
  if (stops.length === 0) {
    return (
      <div className="grid h-full min-h-[260px] place-items-center rounded-xl bg-slate-100 text-sm text-slate-500 dark:bg-white/5">
        No mapped stops for this day
      </div>
    )
  }
  const path = hotel && stops.length > 1 ? [...stops.map((s) => s.position), hotel.position] : stops.map((s) => s.position)
  let number = 0
  return (
    <MapContainer center={stops[0].position} zoom={13} scrollWheelZoom={false} className="h-full min-h-[260px] w-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Polyline positions={path} pathOptions={{ color: '#337dfc', weight: 3, dashArray: '6 6' }} />
      {stops.map((stop, index) => {
        if (!stop.hotel) number += 1
        return (
          <CircleMarker
            key={`${stop.name}-${index}`}
            center={stop.position}
            radius={stop.hotel ? 9 : 8}
            pathOptions={{ color: 'white', weight: 2, fillColor: stop.hotel ? '#0d9488' : '#1d5ef1', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]} permanent={stops.length <= 6}>
              {stop.hotel ? `🏨 ${stop.name}` : `${number}. ${stop.name}`}
            </Tooltip>
          </CircleMarker>
        )
      })}
      <FitBounds stops={stops} />
    </MapContainer>
  )
}
