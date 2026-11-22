"""Drawing must not drain the AI budget (Caren, 22 Nov 2026).

Prod 12d7019: a 6-node, 5-arrow board drawn with the tools fired 19 `rank_actions` requests in about 12 s
(two per node: shape created, label committed; one per arrow; one per click), so Fork right after drawing fell
back to the pattern catalogue 3 times out of 5. The rule (5A): nothing is asked while a drawing is in progress,
and a settled add or click costs at most one request.
"""
import json
import time

from conftest import assert_no_console_errors, check
from test_core_loop import JEV, bar_of
from test_features import shot

BOARD_NODES = [("actor", "Shopper", (170, 300)), ("box", "Edge gateway", (430, 300)),
               ("box", "API service", (700, 300)), ("database", "Orders DB", (990, 300)),
               ("box", "Payment provider", (990, 480)), ("box", "Email worker", (700, 480))]
BOARD_ARROWS = [("Shopper", "Edge gateway"), ("Edge gateway", "API service"), ("API service", "Orders DB"),
                ("API service", "Payment provider"), ("API service", "Email worker")]

# What the model behind the route can take in one minute before Fork falls back to the catalogue. The real
# numbers are the server's; 19 requests in 12 s is what broke it on prod.
UPSTREAM_PER_MINUTE = 8
# A request is "settled" when no key or pointer was pressed for this long before it left the browser.
SETTLED_MS = 700
MAX_CALLS_FOR_THE_BOARD = 3

WATCH_DECIDE = """() => {
    const log = (window.__decide = []);
    let lastInput = performance.now();
    let down = false;
    const seen = (isDown) => () => { lastInput = performance.now(); if (isDown !== null) down = isDown; };
    window.addEventListener('pointerdown', seen(true), true);
    window.addEventListener('pointerup', seen(false), true);
    window.addEventListener('keydown', seen(null), true);
    const send = window.fetch;
    window.fetch = function (input, init) {
        try {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('/api/jev/decide')) {
                const tool = [...document.querySelectorAll('button[aria-label*=" tool ("]')]
                    .find((b) => b.getAttribute('aria-pressed') === 'true');
                log.push({
                    mode: JSON.parse(init.body).mode,
                    sinceInput: Math.round(performance.now() - lastInput),
                    editing: !!document.querySelector('input[aria-label="Edit element label"]'),
                    pointerDown: down,
                    tool: tool ? tool.getAttribute('aria-label') : null,
                });
            }
        } catch (e) { /* the request itself must never be affected */ }
        return send.apply(this, arguments);
    };
}"""


def sent(page, mode="rank_actions"):
    return [c for c in page.evaluate("() => window.__decide") if c["mode"] == mode]


@check("call-budget")
def test_call_budget(page, skot, evidence):
    served = []

    def handle(route):
        try:
            body = json.loads(route.request.post_data or "{}")
        except ValueError:
            body = {}
        now = time.time()
        used = len([c for c in served if now - c["at"] < 60])
        served.append({"at": now, "mode": body.get("mode"), "subject": (body.get("context") or {}).get("subjectLabel")})
        if used >= UPSTREAM_PER_MINUTE:
            answer = {"source": "heuristic", "model": "heuristic", "isHeuristic": True, "latencyMs": 0, "degraded": True}
        elif body.get("mode") == "fork_architecture":
            takes = [t["archetype"] for t in body.get("candidateTakes", [])]
            answer = dict(JEV, takeProbabilities={a: round(0.6 - 0.2 * i, 2) for i, a in enumerate(takes)})
        else:
            answer = dict(JEV, nextActionProbabilities={c["id"]: 0.3 for c in body.get("candidates", [])},
                          contextSuggestions=[])
        route.fulfill(status=200, content_type="application/json", body=json.dumps(answer))

    page.add_init_script("(%s)()" % WATCH_DECIDE)
    page.route("**/api/jev/decide", handle)
    skot.new_board()

    # 1. The prod board, drawn with the tools as fast as the driver goes, then Fork at once.
    for shape, label, at in BOARD_NODES:
        skot.add(shape, label, skot.to_world(*at))
    for frm, to in BOARD_ARROWS:
        skot.connect(frm, to)
    drawn = sent(page)
    shot(page, evidence, "call-budget", "1-board-drawn")
    evidence.note(calls_while_drawing=drawn)
    unsettled = [c for c in drawn if c["sinceInput"] < SETTLED_MS or c["editing"] or c["pointerDown"]
                 or not (c["tool"] or "").startswith("Select tool")]
    assert not unsettled, "a drawing in progress must not call the AI; %d of %d calls were sent mid-drawing: %s" % (
        len(unsettled), len(drawn), unsettled[:4])
    assert len(drawn) <= MAX_CALLS_FOR_THE_BOARD, \
        "6 nodes and 5 arrows drawn quickly cost %d AI calls (at most %d)" % (len(drawn), MAX_CALLS_FOR_THE_BOARD)

    skot.select("API service", "Orders DB")
    skot.press("Alt+f")
    target = page.get_by_role("textbox", name="Target")
    target.wait_for(state="visible", timeout=10000)
    target.fill("p99 < 100 ms")
    is_fork = lambda r: "/api/jev/decide" in r.url and "fork_architecture" in (r.request.post_data or "")
    with page.expect_response(is_fork, timeout=15000):
        target.press("Enter")
    page.wait_for_function("() => /AI · |Pattern catalogue/.test(document.body.innerText)", timeout=8000)
    page.mouse.move(8, 500)
    shot(page, evidence, "call-budget", "2-fork-after-drawing")
    status = [t for t in page.locator("body").inner_text().split("\n") if "AI ·" in t or "Pattern catalogue" in t]
    before_fork = len(sent(page))
    evidence.note(calls_before_fork=before_fork, fork_status=status)
    assert status and all("AI ·" in s for s in status), \
        "Fork right after drawing must reach the model, got %s after %d rank calls" % (status, before_fork)
    assert before_fork <= MAX_CALLS_FOR_THE_BOARD, "selecting two nodes and opening Fork must not add calls: %d" % before_fork
    page.keyboard.press("Escape")
    page.wait_for_timeout(2500)

    # 2. One settled add, arrow, click or drag: exactly one call, about that node.
    def one_call_after(what, action, subject=None):
        n = len(sent(page))
        action()
        page.wait_for_timeout(2500)
        new = sent(page)[n:]
        assert len(new) == 1, "%s must cost exactly one AI call, got %d: %s" % (what, len(new), new)
        assert new[0]["sinceInput"] >= SETTLED_MS and not new[0]["editing"], "%s: asked before it settled: %s" % (what, new[0])
        if subject:
            assert served[-1]["mode"] == "rank_actions" and served[-1]["subject"] == subject, \
                "%s: the call must be about %r, got %s" % (what, subject, served[-1])

    # Fork left the view on the selection, so these steps use nodes that are on screen now.
    api = skot.by_label("API service")
    one_call_after("a node drawn with a tool",
                   lambda: skot.add("box", "Audit log", (api["x"] + api["width"] / 2, api["y"] - 150)), "Audit log")
    one_call_after("an arrow drawn between two nodes", lambda: skot.connect("API service", "Audit log"), "Audit log")

    def click_worker():
        skot.clear()
        skot.click_element("Email worker")
    one_call_after("a click on a node", click_worker, "Email worker")

    def drag_worker():
        el = skot.by_label("Email worker")
        sx, sy = skot.to_screen(el["x"] + el["width"] / 2, el["y"] + el["height"] * 0.55)
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx, sy + 40, steps=6)
        page.mouse.move(sx, sy + 90, steps=6)
        page.mouse.up()
    one_call_after("a node dragged to a new spot", drag_worker)

    # 3. Three names typed one after another: the board settles once, so one call (about the last node).
    def three_names():
        skot.clear()
        bar_of(page).click()
        for name in ("cache", "queue", "cdn"):
            page.keyboard.type(name, delay=25)
            page.keyboard.press("Enter")
    one_call_after("three names typed in a row", three_names, "CDN")

    # Judge A, round 4: the same with no pause at all between keys made no call.
    def three_more_at_once():
        for name in ("alpha", "beta", "gamma"):
            page.keyboard.type(name, delay=0)
            page.keyboard.press("Enter")
    one_call_after("three names typed with no pause at all", three_more_at_once, "Gamma")
    shot(page, evidence, "call-budget", "3-settled-adds")

    evidence.note(calls=[(c["mode"], c["subject"]) for c in served])
    assert not sent(page, "next_options"), "the per-keystroke route must not be called"
    assert_no_console_errors(evidence)
