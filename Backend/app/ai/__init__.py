"""Orbit Assist AI gateway.

An isolated, additive module: nothing in here is imported by the existing auth, OTP or
user routes, and it adds no Firestore collections. The only edit outside this package is
one `include_router` line in `app/main.py`.

What lives here
  settings.py   AI configuration (env, never shipped to the app)
  schemas.py    the wire protocol with the mobile app
  tools.py      the tool catalogue the model may call, and their validation
  prompt.py     the system prompt (personality, truth rules, safety rules)
  providers/    the language-model adapters (Anthropic) behind one small interface
  sessions.py   per-user conversation sessions with expiry
  ratelimit.py  per-user request limits and a daily token budget
  usage.py      usage metering and cost estimates
  engine.py     the tool-use loop that ties it together
  router.py     the HTTP endpoints (`/assistant/...`)

Design rule: the model explains and compares, it never calculates. Every number about
battery, route, price or availability comes from a tool, and the tools run on the
driver's phone against the app's own deterministic services (see docs/ASSISTANT_AI.md).
"""
