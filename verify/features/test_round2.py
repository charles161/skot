"""Charles's answers to the core-loop report (22 Nov 2026): "A for all".

1A  Letters typed anywhere on the board go to the Thought Bar; tools move to Alt+letter, Fork It to Alt+F.
5A  Nothing is asked of the AI while typing. After a node is added or clicked there is one call: the context
    route names a next node from the board and jev scores the options.
6A  The first screen is the bar and one Examples button.
7A  On a phone the suggestions are one row of chips above the bar; the board stays visible.
(2A, 3A and 4A keep what test_core_loop.py already checks.)
"""
import json
import re

from conftest import assert_no_console_errors, check
from driver import Driver, is_shape, overlapping_pairs
from test_core_loop import JEV, arrows_named, bar_of, board, by_creation, gap, type_enter
from test_features import SUGGESTIONS, read_options, shot

FORK_PRESSURE = '[role=region][aria-label="Fork It pressure"]'


def active_tool(page):
    return page.evaluate("""() => {
        const b = [...document.querySelectorAll('button[aria-label*=" tool ("]')].find(x => x.getAttribute('aria-pressed') === 'true');
        return b ? b.getAttribute('aria-label') : null;
    }""")


def click_node(skot, label):
    el = skot.by_label(label)
    skot.page.mouse.click(*skot.to_screen(el["x"] + el["width"] / 2, el["y"] + el["height"] * 0.55))
    skot.page.wait_for_timeout(200)
    return el


@check("type-anywhere")
def test_type_anywhere(page, skot, evidence):
    page.route("**/api/jev/decide", lambda r: r.fulfill(status=500, content_type="application/json", body="{}"))
    evidence.events.clear()
    skot.new_board()
    # Third judge, prod: empty board, click the canvas, type app, Enter: nothing, and the Pen tool was on.
    page.mouse.click(150, 450)
    page.keyboard.type("app", delay=30)
    shot(page, evidence, "type-anywhere", "1-typed-on-canvas")
    assert bar_of(page).input_value() == "app", "letters typed on the board must land in the bar: %r" % bar_of(page).input_value()
    assert active_tool(page).startswith("Select tool"), "typing must not switch tools: %s" % active_tool(page)
    page.keyboard.press("Enter")
    board(skot, 1)
    type_enter(page, "api gateway")
    type_enter(page, "postgres")
    page.keyboard.press("Escape")

    # All three judges, prod: click a node, type redis, Enter: no Redis, a suggestion nobody picked was committed.
    click_node(skot, "App")
    page.keyboard.type("redis", delay=30)
    page.wait_for_timeout(250)
    shot(page, evidence, "type-anywhere", "2-typed-after-clicking-app")
    assert bar_of(page).input_value() == "redis"
    page.keyboard.press("Enter")
    els = board(skot, 4)
    by = {e["label"]: e for e in els if is_shape(e)}
    assert "Redis" in by, "the typed node was not created: %s" % sorted(by)
    assert gap(by["Redis"], by["App"]) <= 260, "Redis should land beside the clicked App, gap %d" % gap(by["Redis"], by["App"])
    assert not skot.arrows(), "nothing may be connected by typing: %s" % arrows_named(els)
    assert not overlapping_pairs(els)

    # Round-2 judge, prod, machine speed: click a node, type with no delay between keys and press Enter at once.
    # The name came out scrambled ("Rdise"), and the click's own late suggestions replaced the new node's.
    page.keyboard.press("Escape")
    click_node(skot, "API Gateway")
    page.keyboard.type("kafka", delay=0)
    page.keyboard.press("Enter")
    els = board(skot, 5)
    page.wait_for_timeout(1500)
    assert "Kafka" in [e["label"] for e in els if is_shape(e)], "typed at machine speed the name must still be Kafka: %s" % [e["label"] for e in by_creation(els)]
    first = read_options(page)[0]
    shot(page, evidence, "type-anywhere", "2b-machine-speed")
    assert "Kafka" in first["title"] and "→" in first["title"], "the suggestions must still be the new node's connections: %s" % first
    page.keyboard.press("Escape")
    skot.clear()

    # Second judge, prod: click App, type cachr, Backspace: the App node was deleted.
    page.keyboard.press("Escape")
    click_node(skot, "App")
    page.keyboard.type("cachr", delay=30)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)
    assert bar_of(page).input_value() == "cach", "Backspace should edit the typed text: %r" % bar_of(page).input_value()
    assert len(skot.shapes()) == 5 and "App" in [e["label"] for e in skot.shapes()], "Backspace deleted a node"
    page.keyboard.press("Escape")
    assert bar_of(page).input_value() == ""

    # Tools are on Alt+letter and still on their buttons.
    skot.clear()
    page.keyboard.press("Alt+r")
    assert active_tool(page).startswith("Box tool"), "Alt+R should pick the Box tool: %s" % active_tool(page)
    page.keyboard.press("Alt+s")
    assert active_tool(page).startswith("Select tool")
    page.get_by_role("button", name=re.compile("^Decision tool")).click()
    assert active_tool(page).startswith("Decision tool")
    page.keyboard.press("Alt+s")

    # Round-2 judges, prod: with nothing selected Alt+F turned the Zone Frame tool on. Alt+F is Fork It only.
    page.keyboard.press("Alt+f")
    page.wait_for_timeout(200)
    assert active_tool(page).startswith("Select tool") and page.locator(FORK_PRESSURE).count() == 0, \
        "Alt+F with nothing selected must do nothing: %s" % active_tool(page)
    page.keyboard.press("Alt+z")
    assert active_tool(page).startswith("Zone Frame tool (Alt+Z)"), active_tool(page)
    page.keyboard.press("Alt+s")

    # Fork It: Alt+F on a selection, and its button. A bare f is a letter.
    click_node(skot, "App")
    page.keyboard.type("f")
    assert bar_of(page).input_value() == "f" and page.locator(FORK_PRESSURE).count() == 0, "a bare f must type, not fork"
    page.keyboard.press("Escape")
    click_node(skot, "App")
    page.keyboard.press("Alt+f")
    page.locator(FORK_PRESSURE).wait_for(state="visible", timeout=5000)
    shot(page, evidence, "type-anywhere", "3-alt-f-forks")
    page.keyboard.press("Escape")
    evidence.note(nodes=[e["label"] for e in by_creation(skot.elements())])
    assert not [e for e in evidence.errors() if "/api/jev/decide" not in e["text"] and "500" not in e["text"]], evidence.errors()[:4]


@check("ai-on-demand")
def test_ai_on_demand(page, skot, evidence):
    calls = []

    def handle(route):
        try:
            body = json.loads(route.request.post_data or "{}")
        except ValueError:
            body = {}
        calls.append(body)
        if body.get("mode") != "rank_actions":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(JEV, probabilities=None, graphs=None)))
            return
        ids = [c["id"] for c in body.get("candidates", [])]
        probs = {cid: 0.05 for cid in ids}
        probs["ctx_0"] = 0.8
        answer = dict(JEV, nextActionProbabilities=probs,
                      contextSuggestions=[{"id": "ctx_0", "label": "Thumbnail Worker", "sublabel": "Resizes uploads",
                                           "kind": "node", "edgeLabel": "resizes"}])
        route.fulfill(status=200, content_type="application/json", body=json.dumps(answer))
    page.route("**/api/jev/decide", handle)
    skot.new_board()

    bar_of(page).click()
    page.keyboard.type("app", delay=60)
    page.wait_for_timeout(1200)
    assert read_options(page, 3)[0]["title"] == "App", "typing still shows what Enter adds"
    assert calls == [], "typing must not call the AI: %s" % [c.get("mode") for c in calls]
    page.keyboard.press("Enter")
    board(skot, 1)
    page.wait_for_timeout(1500)
    shot(page, evidence, "ai-on-demand", "1-after-add")
    assert [c.get("mode") for c in calls] == ["rank_actions"], "adding a node makes exactly one call: %s" % [c.get("mode") for c in calls]
    assert (calls[0].get("context") or {}).get("subjectLabel") == "App", "the one call must carry the board context: %s" % calls[0].get("context")
    opts = read_options(page)
    titles = [o["title"] for o in opts]
    assert len(opts) == 4, opts
    assert not [o for o in opts if o["active"]], "1A: with no connection to offer nothing is highlighted: %s" % titles
    assert "Thumbnail Worker" in opts[3]["title"], "the board-named node is added after the three options, never in place of one: %s" % titles
    assert [o["tier"] for o in opts[:3]] == ["minimal", "cluster", "full"], "the three local options must stay as they were: %s" % titles
    assert "jev" in (opts[3]["pct"] or ""), "jev's pick should be marked: %s" % opts[3]

    page.keyboard.type("api gateway", delay=60)
    page.wait_for_timeout(1200)
    assert len(calls) == 1, "typing the next name must not call the AI: %s" % [c.get("mode") for c in calls]
    page.keyboard.press("Enter")
    els = board(skot, 2)
    page.wait_for_timeout(1500)
    assert len(calls) == 2 and calls[1].get("mode") == "rank_actions" and calls[1]["context"]["subjectLabel"] == "API Gateway", \
        [(c.get("mode"), (c.get("context") or {}).get("subjectLabel")) for c in calls]
    first = read_options(page)[0]
    assert first["active"] and "App" in first["title"] and "API Gateway" in first["title"], "the link stays first and highlighted: %s" % first

    # Clicking a node: one call, about that node, and its board-named next node can be taken with Tab, Enter.
    page.keyboard.press("Escape")
    app = skot.by_label("App")
    page.mouse.click(*skot.to_screen(app["x"] + app["width"] / 2, app["y"] + app["height"] * 0.55))
    page.wait_for_function("s => !!document.querySelector(s + ' button[aria-pressed]')", arg=SUGGESTIONS, timeout=8000)
    page.wait_for_timeout(1500)
    shot(page, evidence, "ai-on-demand", "2-after-click")
    assert len(calls) == 3 and calls[2].get("mode") == "rank_actions" and calls[2]["context"]["subjectLabel"] == "App", \
        [(c.get("mode"), (c.get("context") or {}).get("subjectLabel")) for c in calls]
    opts = read_options(page)
    idx = next(i for i, o in enumerate(opts) if "Thumbnail Worker" in o["title"])
    assert idx > 0 and not [o for o in opts if o["active"]], opts
    for _ in range(idx + 1):
        page.keyboard.press("Tab")
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: any(e.get("label") == "Thumbnail Worker" for e in es), what="the board-named node")
    worker = next(e for e in els if e.get("label") == "Thumbnail Worker")
    assert any(a.get("fromId") == app["id"] and a.get("toId") == worker["id"] for a in els if a.get("kind") == "arrow"), arrows_named(els)
    assert not overlapping_pairs(els)
    evidence.note(calls=[(c.get("mode"), (c.get("context") or {}).get("subjectLabel")) for c in calls], options=titles)
    assert not [c for c in calls if c.get("mode") == "next_options"], "the per-keystroke route must not be called any more"
    assert_no_console_errors(evidence)


@check("first-screen")
def test_first_screen(page, skot, evidence):
    skot.new_board()
    page.wait_for_timeout(600)
    shot(page, evidence, "first-screen", "1-open")
    start = page.get_by_role("region", name="Start sketching on Skot")
    assert start.is_visible()
    assert bar_of(page).evaluate("el => el === document.activeElement"), "the bar should have the caret"
    examples = start.get_by_role("button", name="Examples", exact=True)
    assert examples.is_visible(), "one Examples button"
    buttons = [b.inner_text().strip() for b in start.get_by_role("button").all()]
    assert buttons == ["Examples"], "the first screen is the bar plus one Examples button, found %s" % buttons
    for hidden in ("Draw a checkout system", "Fork my architecture", "Practice a problem", "Starter board: Chat"):
        assert page.get_by_role("button", name=re.compile(hidden)).count() == 0, "%r should be behind Examples" % hidden
    assert page.get_by_text("WebRTC Whiteboard").count() == 0, "no prompt chips on the first screen"
    words = len(start.inner_text().split())
    assert words <= 40, "the first screen should say very little, it says %d words" % words

    examples.click()
    page.get_by_role("button", name=re.compile("Draw a checkout system")).wait_for(state="visible", timeout=3000)
    shot(page, evidence, "first-screen", "2-examples")
    for shown in ("Morph to sequence", "Fork my architecture", "Practice a problem", "Starter board: URL shortener", "Starter board: Notifications"):
        assert page.get_by_role("button", name=re.compile(shown)).is_visible(), "%r missing from Examples" % shown
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    assert page.get_by_role("button", name=re.compile("Draw a checkout system")).count() == 0, "Esc should close Examples"
    assert examples.is_visible()

    # Typing still wins: the first screen never gets in the way of the core loop.
    page.keyboard.type("app", delay=30)
    page.keyboard.press("Enter")
    board(skot, 1)
    assert page.get_by_role("region", name="Start sketching on Skot").count() == 0
    evidence.note(first_screen_words=words)
    assert_no_console_errors(evidence)


@check("phone-chips")
def test_phone_chips(browser, server, base_url, evidence):
    headers = {"CF-Connecting-IP": "198.18.240.7"} if server["launched"] else {}
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                              device_scale_factor=2, extra_http_headers=headers)
    ctx.route(re.compile(r"/_vercel/(insights|speed-insights)/"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=""))
    page = ctx.new_page()
    evidence.watch(page, "phone")
    page.route("**/api/jev/decide", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(
        dict(JEV, nextActionProbabilities=None, contextSuggestions=[]))))
    skot = Driver(page, base_url)
    try:
        skot.new_board()
        bar_of(page).tap()
        for name in ["app", "api gateway"]:
            page.keyboard.type(name, delay=25)
            page.wait_for_timeout(400)
            if name == "api gateway":
                shot(page, evidence, "phone-chips", "1-typing")
                typing = page.evaluate(PANEL_JS)
                assert typing["rows"] == 1 and typing["chips"] == 3, "typing options must be one row of three chips: %s" % typing
            page.keyboard.press("Enter")
            page.wait_for_timeout(500)
        els = board(skot, 2)
        page.wait_for_timeout(600)
        shot(page, evidence, "phone-chips", "2-offered")
        panel = page.evaluate(PANEL_JS)
        evidence.note(typing=typing, offered=panel)
        assert panel["rows"] == 1 and panel["chips"] >= 1, "suggestions must be one row of chips: %s" % panel
        assert panel["dock_height"] <= 0.25 * 844, "panel plus bar cover %d px of an 844 px screen" % panel["dock_height"]
        assert panel["scroll_x"] is False, "the page itself must not scroll sideways"
        v = skot.viewport()
        for e in by_creation(els):
            x1, y1 = skot.to_screen(e["x"], e["y"], v)
            x2, y2 = skot.to_screen(e["x"] + e["width"], e["y"] + e["height"], v)
            assert x1 >= 0 and x2 <= 390 and y1 >= 0 and y2 <= 844 - panel["dock_height"], \
                "%s is off screen or under the dock on a phone: %s" % (e["label"], (round(x1), round(y1), round(x2), round(y2)))
        first = page.locator(SUGGESTIONS + " button[aria-pressed]").first
        assert "App" in first.inner_text() and "API Gateway" in first.inner_text(), first.inner_text()
        first.tap()
        els = skot.wait_state(lambda es: len([a for a in es if a.get("kind") == "arrow"]) == 1, what="a tap on the chip to connect")
        shot(page, evidence, "phone-chips", "3-tapped")
        assert arrows_named(els) == [("App", "API Gateway")], arrows_named(els)
        assert_no_console_errors(evidence)
    finally:
        ctx.close()


PANEL_JS = """() => {
  const region = document.querySelector('[role=region][aria-label="Predictive drafting suggestions"]');
  const chips = region ? [...region.querySelectorAll('button[aria-pressed]')] : [];
  const tops = [...new Set(chips.map(c => Math.round(c.getBoundingClientRect().top / 6)))];
  const bar = document.querySelector('input[aria-label="Describe a component or diagram flow to draw"]');
  const top = region ? region.getBoundingClientRect().top : (bar ? bar.getBoundingClientRect().top : innerHeight);
  return {chips: chips.length, rows: tops.length, dock_height: Math.round(innerHeight - top),
          scroll_x: document.documentElement.scrollWidth > innerWidth + 1};
}"""
