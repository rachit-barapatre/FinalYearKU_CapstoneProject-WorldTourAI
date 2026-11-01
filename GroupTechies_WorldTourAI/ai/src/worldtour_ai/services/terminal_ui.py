"""Readable terminal rendering of the chat, the workflow events and the final plan."""

from __future__ import annotations

from datetime import date

from worldtour_ai.services.itinerary_composer import fill_money
from worldtour_ai.utils.money import format_money

WIDTH = 64
_DISPLAY = {"currency": "USD", "rate": 1.0}
_ICONS = {"travel": "✈", "transfer": "🚕", "meal": "🍽", "stay": "🏨", "food": "🍽"}
_MODE_ICONS = {"flight": "✈", "train": "🚆", "bus": "🚌", "cab": "🚕", "walk": "🚶"}


def banner() -> None:
    print("=" * WIDTH)
    print("          WORLD TOUR — MULTI-AGENT TRAVEL PLANNER")
    print("=" * WIDTH)
    print()
    print("Tell me about the trip you want, in your own words.")
    print()
    print("Examples:")
    print("- Plan a 5 day trip from Ahmedabad to Dubai for 2 people under 1500 USD.")
    print("- A relaxed week in Paris in December, we love food and museums.")
    print("- Plan a budget trip from Mumbai to Europe covering Paris, Amsterdam and Rome.")
    print()
    print("I'll ask for anything I still need before I start planning.")
    print()
    print("-" * WIDTH)
    print()


def section(title: str) -> None:
    print()
    print("=" * WIDTH)
    print(title)
    print("=" * WIDTH)


def subsection(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def print_request_summary(request: dict) -> None:
    """Show the constraints collected in the chat before the workflow starts."""
    print()
    print("Great, here is what I have:")
    for label, value in _request_lines(request):
        print(f"  {label:<12} {value}")
    print()
    print("Starting the planning workflow. This can take a few minutes.")


def _request_lines(request: dict) -> list[tuple[str, str]]:
    destination = request.get("destination") or "not specified"
    if request.get("cities"):
        label = "suggested" if request.get("cities_are_suggestions") else "cities"
        destination += f" ({label}: {', '.join(request['cities'])})"
    budget = "not specified"
    if request.get("budget") is not None:
        scope = " per person" if request.get("budget_scope") == "per_person" else ""
        budget = f"{request['budget']:g} {request.get('currency') or 'USD'}{scope}"
    days = request.get("duration_days")
    lines = [
        ("From:", request.get("origin") or "not specified"),
        ("To:", destination),
        ("Dates:", _date_range(request.get("start_date"), request.get("end_date")) or "flexible"),
        ("Duration:", f"{days} days" if days else "not specified"),
        ("Budget:", budget),
        ("Travelers:", str(request.get("travelers") or "not specified")),
        ("Pace:", request.get("pace") or "balanced"),
    ]
    if request.get("preferences"):
        lines.append(("Interests:", ", ".join(request["preferences"])))
    return lines


def format_event(event: dict) -> str:
    return f"[{event.get('event')}] {event.get('agent_id')}: {event.get('message')}"


def print_plan(plan: dict) -> None:
    _DISPLAY.update(currency=plan.get("display_currency") or "USD", rate=plan.get("usd_to_display") or 1.0)
    section(plan.get("trip_summary") or "YOUR TRIP")
    print(f"From {plan.get('origin') or '?'} to {plan.get('destination') or '?'}"
          + (f" | {_date_range(plan['dates'].get('start_date'), plan['dates'].get('end_date'))}" if (plan.get("dates") or {}).get("start_date") else " | dates flexible")
          + f" | {plan.get('travelers') or 1} traveler(s) | pace: {plan.get('pace') or 'balanced'}")
    if plan.get("cities_are_suggestions"):
        print("Suggested cities (you did not name these): " + ", ".join(plan.get("cities") or []))
    for note in plan.get("parser_notes") or []:
        print(f"- {note}")

    _print_packages(plan)
    _print_getting_there(plan)
    _print_hotels(plan)
    _print_weather(plan)
    _print_days(plan)
    _print_costs(plan)
    _print_links(plan)

    notes = (plan.get("data_notes") or []) + (plan.get("warnings") or [])
    notes += [item.get("message") for item in plan.get("constraint_violations") or [] if item.get("message")]
    if notes:
        subsection("NOTES")
        for note in notes:
            print(f"  - {note}")

    subsection("HOW THIS PLAN WAS OPTIMIZED")
    print("  Algorithms used: " + ", ".join(plan.get("algorithms_actually_used") or []))
    routes = plan.get("routes") or {}
    print(f"  Dijkstra: {_path(routes.get('dijkstra'))}")
    print(f"  A*:       {_path(routes.get('a_star'))}")
    print(f"  {plan.get('optimization_explanation')}")
    for event in plan.get("replanning_history") or []:
        print(f"  Replanned for weather: {event.get('message')}")


def _print_packages(plan: dict) -> None:
    packages = plan.get("packages") or []
    if not packages:
        return
    subsection("PACKAGES")
    budget = (plan.get("budget") or {}).get("planning_budget")
    for package in packages:
        star = "★ recommended" if package["name"] == plan.get("recommended_package") else ""
        fits = "within budget" if package.get("fits_budget") else "over budget"
        hotels = "; ".join(f"{h['name']} (~{_money(h.get('price_per_night'))}/night)" for h in package.get("hotels") or []) or "no hotel data"
        print(f"  {package['label']:<9} {_money(package.get('total')):>12}  {fits:<13} {star}")
        if package.get("transport"):
            print(f"            Travel: {package['transport']['label']}")
        print(f"            Stay:   {hotels}")
    stated = plan.get("budget") or {}
    if stated.get("user_stated") and stated.get("amount") is not None and (stated.get("currency") or "USD") == _DISPLAY["currency"]:
        # Show exactly what the user typed, not a USD round trip of it.
        scope = " per person" if stated.get("scope") == "per_person" else ""
        print(f"  Your budget: {format_money(stated['amount'], _DISPLAY['currency'], 1.0)}{scope}")
    elif budget is not None:
        print(f"  Your budget: {_money(budget)}"
              + (" (assumed, you did not give one)" if stated.get("planning_budget_is_assumption") else ""))
    print("  Type 'budget', 'balanced' or 'premium' after the plan to switch packages.")


def _print_getting_there(plan: dict) -> None:
    subsection("GETTING THERE & BACK")
    choice = plan.get("transport_choice")
    if choice:
        print(f"  ★ Recommended: {choice['label']} — {_money(choice.get('round_trip_total'))} for everyone, both ways"
              + (" (estimate)" if choice.get("price_is_estimate") else ""))
    ground = plan.get("ground_options") or []
    if ground:
        road = f" (road distance {plan['road_km']:.0f} km)" if isinstance(plan.get("road_km"), (int, float)) else ""
        print(f"  By road or rail{road}:")
        for option in ground:
            hours, minutes = divmod(int(option.get("duration_minutes") or 0), 60)
            mark = "★" if choice and choice.get("option_id") == option.get("option_id") else " "
            overnight = ", overnight" if option.get("overnight") else ""
            print(f"   {mark} {option['label']:<34} {hours}h {minutes:02d}m{overnight} | ~{_money(option['price_pp'])} per person one way")
    _print_flights(plan)


def _print_flights(plan: dict) -> None:
    outbound, inbound = plan.get("selected_flights") or [], plan.get("return_flights") or []
    if not outbound and not inbound:
        if not plan.get("ground_options"):
            reasons = [w for w in plan.get("warnings") or [] if w.startswith("Flight")]
            print("  Flights: none — " + (reasons[0] if reasons else "no flight data was returned."))
        return
    print("  Flights:")
    for label, flights, chosen in (("Outbound", outbound, plan.get("recommended_outbound_id")),
                                   ("Return", inbound, plan.get("recommended_return_id"))):
        print(f"  {label}:")
        if not flights:
            print("    none found")
        for flight in flights[:3]:
            mark = "★" if flight.get("option_id") == chosen else " "
            hours, minutes = divmod(int(flight.get("duration_minutes") or 0), 60)
            via = f" via {flight['via']}" if flight.get("via") else ""
            if flight.get("price_included"):
                price = "included in round-trip fare"
            elif flight.get("price") is None:
                price = "fare n/a"
            elif flight.get("price_is_estimate"):
                price = f"~{_money(flight['price'])} pp (est.)"
            else:
                price = f"{_money(flight['price'])} {flight.get('price_scope') or 'pp'}"
            print(f"   {mark} {flight.get('airline') or 'Airline'} {flight.get('flight_number') or ''}  "
                  f"{flight.get('origin')} {_clock(flight.get('departure_time'))} -> {flight.get('destination')} {_clock(flight.get('arrival_time'))}"
                  f"{via} | {hours}h {minutes:02d}m | {'direct' if not flight.get('stops') else str(flight['stops']) + ' stop(s)'} | {price}")
        if len(flights) > 3:
            print(f"     … and {len(flights) - 3} more option(s)")


def _print_hotels(plan: dict) -> None:
    hotels = plan.get("selected_hotels") or []
    subsection("HOTELS")
    if not hotels:
        print("  None found.")
        return
    recommended = set(plan.get("recommended_hotel_ids") or [])
    city = None
    for hotel in hotels:
        if hotel.get("city") != city:
            city = hotel.get("city")
            print(f"  {city}:")
        mark = "★" if hotel.get("option_id") in recommended else " "
        approx = "" if hotel.get("data_source") == "live" else "~"
        price = "rate n/a" if hotel.get("price_per_night") is None else f"{approx}{_money(hotel['price_per_night'])}/night"
        rating = f"{hotel['rating']}/5" if hotel.get("rating") else "no rating"
        if hotel.get("reviews"):
            rating += f" ({hotel['reviews']:,} reviews)"
        if hotel.get("stars"):
            rating = f"{hotel['stars']}★, " + rating
        checked = "" if hotel.get("verified_on_map", True) else " (location not confirmed)"
        print(f"   {mark} {hotel.get('name')} [{hotel.get('tier') or 'hotel'}] {price}, {rating}{checked}")
        if hotel.get("why") and mark == "★":
            print(f"      {hotel['why']}")


def _print_weather(plan: dict) -> None:
    weather = plan.get("weather_information") or {}
    subsection("WEATHER & PACKING")
    rows = weather.get("days") or []
    if not rows:
        print("  Weather is not available.")
    else:
        if weather.get("summary"):
            print(f"  {weather['summary']}")
        if weather.get("dates_assumed"):
            print("  (No travel dates given, so the next few days are shown as a guide.)")
        for row in rows:
            typical = " (typical)" if row.get("source") == "seasonal_historical" else ""
            print(f"  Day {row.get('day')} {_pretty_date(row.get('date'))} {row.get('city') or ''}: {row.get('condition')}{typical}, "
                  f"{row.get('temp_min_c')}–{row.get('temp_max_c')} °C, rain {row.get('precipitation_probability')}%")
    for tip in plan.get("packing_tips") or []:
        print(f"  • {tip}")


def _print_days(plan: dict) -> None:
    subsection("DAY BY DAY")
    for day in plan.get("daily_itinerary") or []:
        when = f" ({_pretty_date(day['date'])})" if day.get("date") else ""
        print(f"  {day.get('title') or 'Day ' + str(day.get('day'))}{when} — {day.get('city') or ''}")
        print(f"    Morning   {_fill(day.get('morning')) or '—'}")
        print(f"    Midday    {_fill(day.get('midday')) or '—'}")
        print(f"    Evening   {_fill(day.get('evening')) or '—'}")
        print(f"    Stay      {day.get('stay_name') or (day.get('stay') or {}).get('name') or '—'}")
        timetable = day.get("activities") or []
        if timetable:
            print("    Timetable:")
            for item in timetable:
                icon = _MODE_ICONS.get(item.get("mode") or "", _ICONS.get(item.get("category"), "•"))
                when = f"{_hhmm(item.get('start_minute'))}–{_hhmm(item.get('end_minute'))}"
                detail = _fill(item.get("detail"))
                print(f"      {when}  {icon} {item.get('name')}" + (f"  ({detail})" if detail else ""))
            if day.get("local_transport_usd"):
                print(f"      Local transport today: ~{_money(day['local_transport_usd'])}")
        print()
    spend = plan.get("daily_spend") or {}
    if spend.get("detail"):
        print(f"  {_fill(spend['detail'])}")


def _print_costs(plan: dict) -> None:
    rows = plan.get("budget_breakdown") or []
    if not rows:
        return
    package = next((p for p in plan.get("packages") or [] if p["name"] == plan.get("recommended_package")), {})
    subsection(f"COST ESTIMATE ({package.get('label', 'recommended')} package)")
    for row in rows:
        print(f"  {row['category']:<22} {_money(row['cost']):>12}   {_fill(row.get('detail'))}")
        for leg in row.get("legs") or []:
            print(f"      {leg.get('from')} -> {leg.get('to')}: {leg.get('distance_km')} km by {leg.get('mode')}, {_money(leg.get('cost'))}")
    print(f"  {'TOTAL':<22} {_money(plan.get('estimated_cost')):>12}")
    remaining = plan.get("remaining_budget")
    if remaining is not None:
        if remaining >= 0:
            print(f"  {'Left from budget':<22} {_money(remaining):>12}   buffer for shopping, tips and surprises")
        else:
            print(f"  {'Over budget by':<22} {_money(-remaining):>12}   try the Budget package or fewer days")


def _print_links(plan: dict) -> None:
    links = plan.get("links") or {}
    if not any(links.values()):
        return
    subsection("BOOK & EXPLORE")
    if links.get("ground"):
        print(f"  {links['ground']['label']}: {links['ground']['url']}")
    if links.get("flights"):
        print(f"  Flights: {links['flights']}")
    for hotel in links.get("hotels") or []:
        print(f"  Hotel {hotel['name']}: {hotel['url']}")
    places = links.get("places") or []
    if places:
        print("  Map links:")
        for place in places:
            print(f"    Day {place['day']} {place['name']}: {place['url']}")


def _money(value) -> str:
    """USD amount shown in the traveler's currency."""
    return format_money(value, _DISPLAY["currency"], _DISPLAY["rate"])


def _fill(text: str | None) -> str:
    return fill_money(text or "", lambda amount: format_money(amount, _DISPLAY["currency"], _DISPLAY["rate"], approx=True))


def _hhmm(minute) -> str:
    if not isinstance(minute, int):
        return "--:--"
    hour, mins = divmod(minute % (24 * 60), 60)
    return f"{hour:02d}:{mins:02d}"


def _clock(value) -> str:
    text = str(value or "")
    return text.split("T", 1)[1][:5] if "T" in text else (text[-5:] if ":" in text else "--:--")


def _date_range(start: str | None, end: str | None) -> str:
    if not start:
        return ""
    return _pretty_date(start) + (f" – {_pretty_date(end)}" if end and end != start else "")


def _pretty_date(value: str) -> str:
    try:
        return date.fromisoformat(value).strftime("%a %d %b %Y")
    except (TypeError, ValueError):
        return str(value)


def _path(result: dict | None) -> str:
    if not result:
        return "not run"
    path = " -> ".join(result.get("path") or [])
    cost = result.get("total_cost_km")
    cost_text = f"{cost:.1f} km" if isinstance(cost, (int, float)) else "no path"
    return f"{path} ({cost_text})" if path else cost_text
