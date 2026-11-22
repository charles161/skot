"""8A (Charles, 22 Nov 2026): when a Fork take renames the selected node, its arrows stay on that node.

Seen on prod: "API service" came back as "API functions" and its arrows to Email worker and Payment provider were
also drawn from Orders DB.
"""
import json
import os

from conftest import REPO, check
from driver import overlapping_pairs
from test_call_budget import BOARD_ARROWS, BOARD_NODES
from test_core_loop import arrows_named
from test_features import shot

RENAMED_TAKES = os.path.join(REPO, "src", "lib", "jev", "__fixtures__", "fork-renamed-node.json")


@check("fork-rename-keeps-arrows")
def test_fork_rename_keeps_arrows(page, skot, evidence):
    """8A. The takes are the model's own answer recorded on prod (22 Nov): two of them bring "API service" back
    under a new name ("API functions", "API pool"). Its arrows must sit on that node, not on Orders DB."""
    with open(RENAMED_TAKES, encoding="utf-8") as f:
        recorded = json.load(f)

    def handle(route):
        body = json.loads(route.request.post_data or "{}")
        if body.get("mode") != "fork_architecture":
            route.fulfill(status=500, content_type="application/json", body='{"error":"not under test"}')
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "source": "llm-json", "model": "anthropic/claude-haiku-5.5", "isHeuristic": False, "latencyMs": 90,
            "takes": recorded["takes"]}))
    page.route("**/api/jev/decide", handle)

    seen = {}
    for idx, renamed in enumerate(["API functions", "API pool"]):
        skot.new_board()
        for shape, label, at in BOARD_NODES:
            skot.add(shape, label, skot.to_world(*at))
        for frm, to in BOARD_ARROWS:
            skot.connect(frm, to)
        skot.select("API service", "Orders DB")
        skot.press("Alt+f")
        target = page.get_by_role("textbox", name="Target")
        target.wait_for(state="visible", timeout=10000)
        target.fill(recorded["constraint"]["text"])
        target.press("Enter")
        page.wait_for_function("() => /AI · /.test(document.body.innerText)", timeout=10000)
        for _ in range(idx):
            page.keyboard.press("Tab")
        page.wait_for_timeout(400)
        before = {e["id"] for e in skot.elements()}
        page.keyboard.press("Enter")
        els = skot.wait_state(lambda es: {e["id"] for e in es} != before and any(e.get("label") == renamed for e in es),
                              timeout=10, what="the take with %r" % renamed)
        page.wait_for_timeout(900)
        page.mouse.move(8, 500)
        shot(page, evidence, "fork-rename-keeps-arrows", "take-%d-%s" % (idx + 1, renamed.replace(" ", "-").lower()))
        arrows = arrows_named(els)
        seen[renamed] = arrows
        for want in [("Edge gateway", renamed), (renamed, "Payment provider"), (renamed, "Email worker")]:
            assert want in arrows, "%s: the arrow %s -> %s must sit on the renamed node: %s" % (renamed, want[0], want[1], arrows)
        stray = [a for a in arrows if a[0] == "Orders DB" and a[1] in ("Email worker", "Payment provider")]
        assert not stray, "%s: arrows moved to Orders DB: %s" % (renamed, stray)
        assert not [a for a in arrows if "API service" in a], "the old node is gone: %s" % arrows
        assert not overlapping_pairs(els), overlapping_pairs(els)
    evidence.note(arrows=seen)
    console = [e for e in evidence.errors() if "/api/jev/decide" not in e["text"] and "500" not in e["text"]]
    assert not console, console[:4]
