"""Round 5: Charles said "all A" to decisions 15 to 19 (22 Nov 2026).

15A  The first connection offered is the one that makes sense for the new node. A selection decides only where
     the node lands; its connection is one Tab away.
16A  A name gets the same shape inside "a -> b" as typed alone.
18A  Labels slide along their arrows until clear of other labels and nodes; on a phone they stay on screen.
19A  Cancelling Fork returns the view from before Fork.
"""
import json
import re

from conftest import assert_no_console_errors, check
from driver import Driver, is_shape
from test_core_loop import arrows_named, bar_of, board, by_creation, gap, type_enter
from test_features import SUGGESTIONS, read_options, shot
from test_round4 import assert_hint_honest, highlighted

AI_OFF = lambda r: r.fulfill(status=500, content_type="application/json", body='{"error":"off"}')  # noqa: E731


@check("first-connection-makes-sense")
def test_first_connection_makes_sense(page, skot, evidence, browser, server, base_url):
    """15A. Reproduced on prod at 905f3af: with Postgres selected, "cdn, Enter, Enter" drew "CDN writes to
    Postgres"; on a phone "object storage" was first offered "Postgres writes to Object Storage"."""
    page.route("**/api/jev/decide", AI_OFF)
    skot.new_board()
    type_enter(page, "app")
    type_enter(page, "postgres")
    board(skot, 2)
    skot.clear()
    postgres = skot.click_element("Postgres")
    page.keyboard.type("cdn", delay=30)
    page.keyboard.press("Enter")
    els = board(skot, 3)
    cdn = next(e for e in els if e["label"] == "CDN")
    assert gap(cdn, postgres) < 200, "the selection still decides where the node lands: CDN is %d px from Postgres" % gap(cdn, postgres)
    opts = read_options(page)
    titles = [o["title"] for o in opts]
    shot(page, evidence, "first-connection-makes-sense", "1-cdn-with-postgres-selected")
    assert opts[0]["active"] and "App" in titles[0] and "CDN" in titles[0], "App -> CDN must be offered first and highlighted: %s" % titles
    assert "CDN" in titles[1] and "Postgres" in titles[1], "the selected node's connection is one Tab away: %s" % titles
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len(arrows_named(es)) == 1, what="the accepted connection")
    assert arrows_named(els) == [("App", "CDN")], arrows_named(els)

    # Nothing sensible on the board for the new node: a link may be listed, none is highlighted, Enter draws nothing.
    skot.new_board()
    type_enter(page, "postgres")
    type_enter(page, "cdn")
    board(skot, 2)
    page.wait_for_timeout(400)
    shot(page, evidence, "first-connection-makes-sense", "2-nothing-sensible")
    assert not highlighted(page), "CDN and Postgres have no usual connection: nothing may be highlighted: %s" % highlighted(page)
    assert_hint_honest(page, "with nothing sensible to connect")
    for _ in range(2):
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
    assert arrows_named(skot.elements()) == [], "Enter drew %s" % arrows_named(skot.elements())
    assert_no_console_errors_but_ai(evidence)

    # The phone column.
    headers = {"CF-Connecting-IP": "198.18.240.15"} if server["launched"] else {}
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                              device_scale_factor=2, extra_http_headers=headers)
    ctx.route(re.compile(r"/_vercel/(insights|speed-insights)/"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=""))
    phone = ctx.new_page()
    phone.route("**/api/jev/decide", AI_OFF)
    try:
        d = Driver(phone, base_url)
        d.new_board()
        bar_of(phone).tap()
        names = ["app", "api gateway", "auth service", "redis", "postgres", "kafka", "worker", "object storage"]
        for i, name in enumerate(names, 1):
            phone.keyboard.type(name, delay=20)
            phone.keyboard.press("Enter")
            board(d, i)
            phone.wait_for_timeout(350)
        chips = [" ".join(c.split()) for c in phone.locator(SUGGESTIONS + " button[aria-pressed]").all_inner_texts()]
        first = phone.locator(SUGGESTIONS + ' button[aria-pressed="true"]')
        shot(phone, evidence, "first-connection-makes-sense", "3-phone-object-storage")
        evidence.note(phone_chips=chips)
        assert first.count() == 1 and "Worker" in first.inner_text() and "Object Storage" in first.inner_text(), \
            "on the phone column Worker -> Object Storage must be offered first: %s" % chips
        phone.keyboard.press("Enter")
        els = d.wait_state(lambda es: len(arrows_named(es)) == 1, what="the accepted connection")
        assert arrows_named(els) == [("Worker", "Object Storage")], arrows_named(els)
    finally:
        ctx.close()


def assert_no_console_errors_but_ai(evidence):
    console = [e for e in evidence.errors() if "/api/jev/decide" not in e["text"] and "500" not in e["text"]]
    assert not console, console[:4]


@check("same-shape-in-flow")
def test_same_shape_in_flow(page, skot, evidence):
    """16A. Judge A, round 4: plain "api" was a hexagon, "api" inside a flow a box."""
    page.route("**/api/jev/decide", AI_OFF)
    look = lambda e: (e["label"], e["kind"], e.get("sublabel") or "", e["width"], e["height"])  # noqa: E731
    alone = {}
    for name in ["api", "worker", "cdn", "postgres"]:
        skot.new_board()
        type_enter(page, name)
        alone[name] = look(board(skot, 1)[0])
    skot.new_board()
    bar_of(page).click()
    page.keyboard.type("api -> worker -> postgres", delay=20)
    page.keyboard.press("Enter")
    els = board(skot, 3)
    shot(page, evidence, "same-shape-in-flow", "1-flow")
    in_flow = {look(e)[0]: look(e) for e in els if is_shape(e)}
    for name in ["api", "worker", "postgres"]:
        want = alone[name]
        assert in_flow.get(want[0]) == want, "%r typed alone is %s, inside a flow %s" % (name, want, in_flow.get(want[0]))
    type_enter(page, "client -> cdn")
    els = board(skot, 5)
    cdn = next(look(e) for e in els if e["label"] == alone["cdn"][0])
    assert cdn == alone["cdn"], "cdn typed alone is %s, inside a flow %s" % (alone["cdn"], cdn)
    evidence.note(alone=alone)
    assert_no_console_errors_but_ai(evidence)


@check("fork-cancel-restores-view")
def test_fork_cancel_restores_view(page, skot, evidence):
    """19A. Fork moves and zooms the view onto the selection; cancelling it left the view there."""
    page.route("**/api/jev/decide", AI_OFF)
    skot.new_board()
    for name in ["app", "api gateway", "postgres", "redis", "kafka", "worker"]:
        type_enter(page, name)
    board(skot, 6)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    view = lambda: {k: round(v, 3) for k, v in skot.viewport().items() if k in ("x", "y", "zoom")}  # noqa: E731
    before = view()

    def open_fork():
        skot.select("API Gateway", "Postgres")
        skot.press("Alt+f")
        page.get_by_role("textbox", name="Target").wait_for(state="visible", timeout=10000)
        page.wait_for_timeout(700)

    open_fork()
    during = view()
    shot(page, evidence, "fork-cancel-restores-view", "1-fork-open")
    assert during != before, "Fork should bring the selection into view (the check needs the view to move): %s" % during
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    shot(page, evidence, "fork-cancel-restores-view", "2-after-esc")
    assert view() == before, "Esc in Fork must return the view from before Fork: %s, was %s" % (view(), before)

    # Past the pressure step, with the three takes on screen, and closed with its button.
    open_fork()
    page.get_by_role("textbox", name="Target").fill("p99 < 100 ms")
    page.get_by_role("textbox", name="Target").press("Enter")
    page.get_by_role("tab").first.wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(900)
    assert view() != before
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    assert view() == before, "Esc on the takes must return the view from before Fork: %s, was %s" % (view(), before)

    # Accepting a take is not a cancel: the view stays on what was swapped in.
    open_fork()
    page.get_by_role("textbox", name="Target").fill("p99 < 100 ms")
    page.get_by_role("textbox", name="Target").press("Enter")
    page.get_by_role("tab").first.wait_for(state="visible", timeout=10000)
    ids = {e["id"] for e in skot.elements()}
    page.keyboard.press("Enter")
    skot.wait_state(lambda es: {e["id"] for e in es} != ids, what="the swap")
    evidence.note(before=before, during=during)
    assert_no_console_errors_but_ai(evidence)


LABEL_PILLS_JS = """() => [...document.querySelectorAll('[role=application] svg [data-element-id][data-kind="arrow"]')].map((g) => {
  const pill = g.querySelector('rect');
  const text = [...g.querySelectorAll('text')].find((n) => n.textContent.trim());
  if (!pill || !text) return null;
  const r = pill.getBoundingClientRect();
  return {id: g.getAttribute('data-element-id'), text: text.textContent.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom};
}).filter(Boolean)"""


def label_clashes(page, skot):
    """Labels drawn on another label, or on a node, as seen on screen."""
    pills = page.evaluate(LABEL_PILLS_JS)
    v = skot.viewport()
    nodes = []
    for e in skot.elements():
        if is_shape(e):
            x1, y1 = skot.to_screen(e["x"], e["y"], v)
            x2, y2 = skot.to_screen(e["x"] + e["width"], e["y"] + e["height"], v)
            nodes.append((e["label"], x1, y1, x2, y2))
    hit = lambda a, b: not (a["right"] <= b["left"] + 1 or b["right"] <= a["left"] + 1 or a["bottom"] <= b["top"] + 1 or b["bottom"] <= a["top"] + 1)  # noqa: E731
    found = []
    for i, a in enumerate(pills):
        found += ["label %r on label %r" % (a["text"], b["text"]) for b in pills[i + 1:] if hit(a, b)]
        found += ["label %r on node %s" % (a["text"], n[0]) for n in nodes
                  if hit(a, {"left": n[1], "top": n[2], "right": n[3], "bottom": n[4]})]
    return found, pills


@check("labels-stay-clear")
def test_labels_stay_clear(page, skot, evidence, browser, server, base_url):
    """18A. Seen on prod: on a 14-node board the label of Kafka -> Search sat on the label of Client -> CDN."""
    page.route("**/api/jev/decide", AI_OFF)
    skot.new_board()
    bar_of(page).click()
    names = ["client", "cdn", "load balancer", "api gateway", "auth service", "user service", "postgres", "redis",
             "kafka", "worker", "s3", "search", "postgres", "notification service"]
    for i, name in enumerate(names, 1):
        page.keyboard.type(name, delay=15)
        page.keyboard.press("Enter")
        board(skot, i)
        page.wait_for_timeout(300)
        if highlighted(page):
            page.keyboard.press("Enter")
            page.wait_for_timeout(300)
    before = {e["id"]: (e["x"], e["y"]) for e in skot.elements() if is_shape(e)}
    for flow in ["kafka -> search", "client -> search", "worker -> redis"]:
        page.keyboard.type(flow, delay=15)
        page.keyboard.press("Enter")
        page.wait_for_timeout(600)
    page.keyboard.press("Escape")
    page.mouse.move(8, 500)
    page.wait_for_timeout(500)
    shot(page, evidence, "labels-stay-clear", "1-busy-board")
    found, pills = label_clashes(page, skot)
    evidence.note(labels=len(pills), arrows=len(arrows_named(skot.elements())))
    assert len(pills) >= 10, "the board should carry at least ten labelled arrows: %d" % len(pills)
    assert not found, "labels must be clear of nodes and of each other: %s" % found
    assert {e["id"]: (e["x"], e["y"]) for e in skot.elements() if is_shape(e)} == before, "no node may move to make room for a label"

    # The same on a phone's single column, where arrows bend round the stack; labels in view stay inside the screen.
    headers = {"CF-Connecting-IP": "198.18.240.17"} if server["launched"] else {}
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                              device_scale_factor=2, extra_http_headers=headers)
    ctx.route(re.compile(r"/_vercel/(insights|speed-insights)/"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=""))
    phone = ctx.new_page()
    phone.route("**/api/jev/decide", AI_OFF)
    try:
        d = Driver(phone, base_url)
        d.new_board()
        bar_of(phone).tap()
        for i, name in enumerate(["app", "api gateway", "auth service", "redis", "postgres", "kafka", "worker", "object storage"], 1):
            phone.keyboard.type(name, delay=15)
            phone.keyboard.press("Enter")
            board(d, i)
            phone.wait_for_timeout(350)
            if phone.locator(SUGGESTIONS + ' button[aria-pressed="true"]').count():
                n = len(arrows_named(d.elements()))
                phone.keyboard.press("Enter")
                d.wait_state(lambda es: len(arrows_named(es)) == n + 1, what="the accepted connection")
                phone.wait_for_timeout(450)
                last = phone.evaluate(LABEL_PILLS_JS)
                newest = [p for p in last if p["id"] == [a for a in d.elements() if a.get("kind") == "arrow"][-1]["id"]]
                for p in newest:
                    assert p["left"] >= 0 and p["right"] <= 390, \
                        "after %r the label %r is cut off by the screen edge (%d to %d)" % (name, p["text"], p["left"], p["right"])
        shot(phone, evidence, "labels-stay-clear", "2-phone-column")
        found, pills = label_clashes(phone, d)
        assert len(pills) >= 5, pills
        assert not found, "on the phone column labels must be clear of nodes and of each other: %s" % found
    finally:
        ctx.close()
    assert_no_console_errors_but_ai(evidence)

