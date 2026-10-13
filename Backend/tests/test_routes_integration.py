"""The two assistants (Orbit Assist and the help guide) and the other routers share one app."""
from collections import Counter

from fastapi.routing import APIRoute

from app.ai.router import router as orbit_assist
from app.main import app
from app.routes import assistant_guide, auth, google_browser, otp, support, users

ROUTERS = [auth.router, otp.router, users.router, orbit_assist, assistant_guide.router, support.router, google_browser.router]


def _endpoints():
    """(method, full path) of every endpoint, router by router (each router's paths include its prefix)."""
    return [
        (method, route.path)
        for router in ROUTERS
        for route in router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    ]


def test_no_two_routers_define_the_same_method_and_path():
    duplicates = [key for key, count in Counter(_endpoints()).items() if count > 1]
    assert duplicates == []


def test_orbit_assist_and_the_help_guide_live_under_different_paths():
    paths = {path for _, path in _endpoints()}
    # Orbit Assist (app/ai)
    assert {"/assistant/status", "/assistant/turn", "/assistant/usage", "/assistant/sessions"} <= paths
    # The help guide (app/routes/assistant_guide.py)
    assert {"/assistant/guide/status", "/assistant/guide/chat"} <= paths
    guide = {path for path in paths if path.startswith("/assistant/guide")}
    assert guide.isdisjoint({"/assistant/status", "/assistant/turn"})


def test_every_router_is_mounted_on_the_app():
    mounted = set(app.openapi()["paths"])
    for _, path in _endpoints():
        assert path in mounted, path
    for path in ("/support/tickets", "/support/access", "/auth/google-browser/start", "/health"):
        assert path in mounted, path
