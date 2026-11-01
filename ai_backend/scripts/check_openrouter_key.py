"""Read-only OpenRouter key check: GET /api/v1/key. Costs nothing, prints no secrets.

Run from ai_backend:  python scripts/check_openrouter_key.py
"""
import re, json, urllib.request, urllib.error
key=""
for line in open(".env",encoding="utf-8"):
    if line.startswith("OPENROUTER_API_KEY="):
        key=line.split("=",1)[1].strip().strip('"').strip("'")
red=lambda t: re.sub(r"sk-or-[\w\-]+","[redacted]",t.replace(key,"[redacted]") if key else t)
print("key present:", bool(key), "| length:", len(key), "| prefix ok:", key.startswith("sk-or-"))
req=urllib.request.Request("https://openrouter.ai/api/v1/key",headers={"Authorization":f"Bearer {key}","User-Agent":"worldtour-keycheck"})
try:
    r=urllib.request.urlopen(req,timeout=20); status=r.status; body=r.read().decode()
except urllib.error.HTTPError as e:
    status=e.code; body=e.read().decode()
except Exception as e:
    print("request failed:", type(e).__name__, red(str(e))[:200]); raise SystemExit
print("status:", status)
try:
    d=json.loads(body); data=d.get("data",d)
    if isinstance(data,dict): data={k:v for k,v in data.items() if k not in ("label","hash","key","name")}
    print(red(json.dumps(data,indent=2))[:1200])
except Exception:
    print("non-json body:", red(body)[:300])
