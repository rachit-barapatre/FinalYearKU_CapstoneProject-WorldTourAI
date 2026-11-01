"""Display money in the traveler's currency. Calculations stay in USD; only the output is converted."""

from __future__ import annotations

from worldtour_ai.data.places import lookup_place

SYMBOLS = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£", "JPY": "¥", "SGD": "S$", "THB": "฿", "AED": "AED "}
COUNTRY_CURRENCY = {
    "India": "INR",
    "United States": "USD",
    "United Kingdom": "GBP",
    "France": "EUR",
    "Netherlands": "EUR",
    "Italy": "EUR",
    "Spain": "EUR",
    "Portugal": "EUR",
    "Germany": "EUR",
    "Austria": "EUR",
    "Greece": "EUR",
    "Japan": "JPY",
    "Singapore": "SGD",
    "Thailand": "THB",
    "United Arab Emirates": "AED",
}


def display_currency(request: dict) -> str:
    """The currency the user wrote in; otherwise the currency of the country they travel from."""
    if request.get("currency") and not request.get("currency_assumed"):
        return str(request["currency"]).upper()
    if request.get("preferred_currency"):
        return str(request["preferred_currency"]).upper()
    origin = lookup_place(request.get("origin"))
    return COUNTRY_CURRENCY.get(origin.country if origin else "", request.get("currency") or "USD")


def format_money(amount_usd, currency: str = "USD", rate: float = 1.0, approx: bool = False) -> str:
    """Format a USD amount in the display currency. INR uses Indian digit grouping (₹1,50,000)."""
    if not isinstance(amount_usd, (int, float)):
        return "n/a"
    value = float(amount_usd) * (rate or 1.0)
    code = (currency or "USD").upper()
    symbol = SYMBOLS.get(code, code + " ")
    number = _indian(value) if code == "INR" else f"{value:,.0f}"
    return ("~" if approx else "") + symbol + number


def _indian(value: float) -> str:
    whole = str(int(round(abs(value))))
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups) + "," + tail
    return ("-" if value < 0 else "") + whole
