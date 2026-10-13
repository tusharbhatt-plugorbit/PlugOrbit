from app.ai.providers.base import ModelUsage
from app.ai.usage import estimate_cost_usd


def test_sonnet_cache_read_estimate_uses_published_rate():
    assert estimate_cost_usd(
        "claude-sonnet-5-5", ModelUsage(cache_read_tokens=1_000_000)
    ) == 0.10
