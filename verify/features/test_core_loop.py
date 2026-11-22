"""The core loop contract (Charles, 22 Nov 2026): type a name, press Enter, get that node. Every time.

1. Enter always creates one node with the typed name, at once: no network wait, no AI gate, no full diagram,
   and a name that is already on the board still gets a new node.
2. Placement is deterministic: free space beside the selected or last-touched node, never on top of another
   node, and nothing already on the board moves.
3. Connections are suggested, never forced: Enter on the empty bar accepts the highlighted one; typing skips it.
4. AI is additive: the same keys on the same board give the same board whether the AI answers, fails or hangs.
"""
import json
import time

import pytest
from conftest import assert_no_console_errors, check
from driver import Driver, is_shape, overlapping_pairs
from test_features import THOUGHT_BAR, ghosts, read_options, shot

SUGGESTIONS_PANEL = '[role=region][aria-label="Predictive drafting suggestions"] button[aria-pressed]'
SHAPES_JS = "() => document.querySelectorAll('[role=application] svg [data-element-id]:not([data-kind=arrow])').length"
JEV = {"source": "gateway:typesafe-ai/jev", "model": "typesafe-ai/jev", "isHeuristic": False, "latencyMs": 90}


def norm(s):
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


@pytest.fixture
def ai(page, new_page):
    """ai(page, mode) scripts the AI route for one page.
    ok: jev answers and prefers the biggest / last option (it must not change what Enter does).
    fail: the AI route returns 500. hang: the AI never answers (requests are released when the check ends)."""
    pending = []

    def script(target, mode):
        def handle(route):
            if mode == "hang":
                pending.append(route)
                return
            if mode == "fail":
                route.fulfill(status=500, content_type="application/json", body='{"error":"ai down"}')
                return
            try:
                body = json.loads(route.request.post_data or "{}")
            except ValueError:
                body = {}
            if body.get("mode") == "next_options":
                answer = dict(JEV, probabilities={"minimal": 0.04, "cluster": 0.06, "full": 0.9}, graphs=None)
            elif body.get("mode") == "rank_actions":
                ids = [c["id"] for c in body.get("candidates", [])]
                probs = {cid: (0.9 if i == len(ids) - 1 else 0.1 / max(1, len(ids) - 1)) for i, cid in enumerate(ids)}
                answer = dict(JEV, nextActionProbabilities=probs)
            else:
                route.continue_()
                return
            route.fulfill(status=200, content_type="application/json", body=json.dumps(answer))
        target.route("**/api/jev/decide", handle)

    yield script
    for route in pending:
        try:
            route.abort()
        except Exception:  # the page already cancelled this request itself
            pass


def bar_of(page):
    return page.get_by_role("textbox", name=THOUGHT_BAR)


def type_enter(page, text, settle_ms=0, budget_ms=1500):
    """Type a name in the Thought Bar and press Enter. Returns (shapes added, ms until the first new shape)."""
    bar = bar_of(page)
    if not bar.evaluate("el => el === document.activeElement"):
        bar.click()
    page.keyboard.type(text, delay=25)
    if settle_ms:
        page.wait_for_timeout(settle_ms)
    before = page.evaluate(SHAPES_JS)
    t0 = time.time()
    page.keyboard.press("Enter")
    ms = None
    try:
        page.wait_for_function("n => (%s)() > n" % SHAPES_JS, arg=before, timeout=budget_ms, polling=16)
        ms = round((time.time() - t0) * 1000)
    except Exception:  # nothing appeared inside the budget: the caller asserts on the count
        pass
    page.wait_for_timeout(250)
    return page.evaluate(SHAPES_JS) - before, ms


def board(skot, n_shapes, timeout=6):
    return skot.wait_state(lambda es: len([e for e in es if is_shape(e)]) == n_shapes, timeout=timeout,
                           what="%d shapes on the board" % n_shapes)


def by_creation(els):
    return sorted([e for e in els if is_shape(e)], key=lambda e: (e.get("createdAt", 0), e["id"]))


def gap(a, b):
    """Empty space between two boxes (0 when they touch or overlap)."""
    dx = max(a["x"] - (b["x"] + b["width"]), b["x"] - (a["x"] + a["width"]), 0)
    dy = max(a["y"] - (b["y"] + b["height"]), b["y"] - (a["y"] + a["height"]), 0)
    return (dx * dx + dy * dy) ** 0.5


def frozen(els):
    return {e["id"]: (e["x"], e["y"], e["width"], e["height"], e.get("label")) for e in els if is_shape(e)}


def assert_untouched(before, els, what):
    now = frozen(els)
    moved = [v[4] for k, v in before.items() if now.get(k) != v]
    assert not moved, "%s moved or changed existing nodes: %s" % (what, moved)


def arrows_named(els):
    by_id = {e["id"]: e for e in els}
    return sorted((by_id[a["fromId"]]["label"], by_id[a["toId"]]["label"]) for a in els
                  if a.get("kind") == "arrow" and a.get("fromId") in by_id and a.get("toId") in by_id)


@check("core-loop-enter-creates")
def test_core_loop_enter_creates(page, skot, evidence, ai):
    ai(page, "hang")  # the AI never answers: Enter must not wait for it
    skot.new_board()
    seen = {}
    for i, name in enumerate(["app", "api gateway", "postgres"]):
        added, ms = type_enter(page, name)
        shot(page, evidence, "core-loop-enter-creates", "%d-%s" % (i + 1, name.replace(" ", "-")))
        seen[name] = {"added": added, "ms": ms}
        assert added == 1, "Enter on %r must add exactly one node, added %d" % (name, added)
        assert ms is not None and ms < 400, "Enter on %r took %s ms with the AI hanging; it must not wait" % (name, ms)
        assert bar_of(page).input_value() == "", "the bar should clear after Enter"
        assert bar_of(page).evaluate("el => el === document.activeElement"), "the bar should keep focus"
    els = board(skot, 3)
    names = [e["label"] for e in by_creation(els)]
    assert [norm(n) for n in names] == ["app", "apigateway", "postgres"], "nodes must carry the typed names: %s" % names
    assert names[1] == "API Gateway", "known names get their usual capitals: %r" % names[1]
    assert not [e for e in els if e.get("kind") == "arrow"], "Enter must not draw connections by itself"

    before = frozen(els)
    for name in ["app", "api gateway", "app"]:
        added, ms = type_enter(page, name)
        seen["again " + name] = {"added": added, "ms": ms}
        assert added == 1, "a name already on the board (%r) must still add a node, added %d" % (name, added)
    shot(page, evidence, "core-loop-enter-creates", "4-duplicates")
    els = board(skot, 6)
    names = [norm(e["label"]) for e in by_creation(els)]
    assert names == ["app", "apigateway", "postgres", "app", "apigateway", "app"], names
    assert_untouched(before, els, "adding duplicates")
    assert not overlapping_pairs(els), "nodes overlap: %s" % overlapping_pairs(els)
    assert not [e for e in els if e.get("kind") == "arrow"], "duplicates must not be auto-connected"

    added, ms = type_enter(page, "x")
    assert added == 1, "even a one-letter name creates a node, added %d" % added

    # jev prefers the full diagram: Enter still adds exactly the one typed node (the 21 Nov prod bug).
    page.unroute("**/api/jev/decide")
    ai(page, "ok")
    skot.new_board()
    type_enter(page, "app")
    added, ms = type_enter(page, "api gateway", settle_ms=1500)
    shot(page, evidence, "core-loop-enter-creates", "5-jev-prefers-full")
    els = board(skot, 2)
    evidence.note(steps=seen, jev_prefers_full_added=added, nodes=[e["label"] for e in by_creation(els)])
    assert added == 1, "jev ranking the full diagram first must not change Enter: added %d nodes" % added
    assert [e["label"] for e in by_creation(els)] == ["App", "API Gateway"], [e["label"] for e in by_creation(els)]
    assert_no_console_errors(evidence)


def place_sequence(page, skot):
    """alpha, beta, gamma in a row; then delta twice next to the clicked alpha. Returns the board."""
    skot.new_board()
    for name in ["alpha", "beta", "gamma"]:
        added, _ = type_enter(page, name)
        assert added == 1, "%r added %d nodes" % (name, added)
    els = board(skot, 3)
    before = frozen(els)
    skot.click_element("Alpha")
    for n in (4, 5):
        added, _ = type_enter(page, "delta")
        assert added == 1
        els = board(skot, n)
        assert_untouched(before, els, "adding Delta")
        skot.clear()
        skot.click_element("Alpha")
    return els


@check("core-loop-placement")
def test_core_loop_placement(page, skot, new_page, evidence, base_url, ai):
    ai(page, "hang")
    els = place_sequence(page, skot)
    shot(page, evidence, "core-loop-placement", "board")
    s = {e["label"]: e for e in by_creation(els)[:3]}
    deltas = [e for e in by_creation(els) if e["label"] == "Delta"]
    assert not overlapping_pairs(els, pad=16), "nodes overlap or touch: %s" % overlapping_pairs(els, pad=16)
    assert gap(s["Alpha"], s["Beta"]) <= 220, "Beta should sit beside Alpha (the last node), gap %d" % gap(s["Alpha"], s["Beta"])
    assert gap(s["Beta"], s["Gamma"]) <= 220, "Gamma should sit beside Beta (the last node), gap %d" % gap(s["Beta"], s["Gamma"])
    for d in deltas:
        assert gap(s["Alpha"], d) <= 260, "Delta should sit beside the selected Alpha, gap %d" % gap(s["Alpha"], d)
    v = skot.viewport()
    hidden = []
    for e in by_creation(els):
        cx, cy = skot.to_screen(e["x"] + e["width"] / 2, e["y"] + e["height"] / 2, v)
        if not skot.on_canvas(cx, cy):
            hidden.append(e["label"])
    assert not hidden, "new nodes ended up off screen or under the app chrome: %s" % hidden

    # Same keys on a second fresh board: same layout.
    other = new_page("second visitor")
    ai(other, "hang")
    els2 = place_sequence(other, Driver(other, base_url))

    def layout(es):
        ordered = by_creation(es)
        o = ordered[0]
        return [(e["label"], e["kind"], e["x"] - o["x"], e["y"] - o["y"]) for e in ordered]
    evidence.note(layout=layout(els))
    assert layout(els) == layout(els2), "the same keys gave two layouts:\n%s\n%s" % (layout(els), layout(els2))
    assert_no_console_errors(evidence)


@check("core-loop-connections-suggested")
def test_core_loop_connections_suggested(page, skot, evidence, ai):
    ai(page, "ok")  # jev answers and prefers the last option: the highlight must stay where it is
    skot.new_board()
    type_enter(page, "app")
    type_enter(page, "api gateway")
    els = board(skot, 2)
    app, gw = by_creation(els)
    assert not skot.arrows(), "the connection must be offered, not drawn"
    opts = read_options(page)
    g = ghosts(page)
    shot(page, evidence, "core-loop-connections-suggested", "1-offered")
    assert opts and opts[0]["active"], "the first suggestion should be highlighted: %s" % opts
    assert "App" in opts[0]["title"] and "API Gateway" in opts[0]["title"], "first suggestion should link App and API Gateway: %s" % opts[0]
    assert g["shapes"] == [] and len(g["arrows"]) == 1, "the highlighted suggestion is one ghost arrow: %s" % g
    assert (g["arrows"][0]["from"], g["arrows"][0]["to"]) == (app["id"], gw["id"]), g["arrows"]
    page.wait_for_timeout(900)  # jev has answered by now
    assert read_options(page)[0]["active"], "a late jev answer must not move the highlight"

    # Typing is never blocked: the next name goes in, the offered link is simply skipped.
    added, _ = type_enter(page, "postgres")
    els = board(skot, 3)
    assert added == 1 and not skot.arrows(), "typing past a suggestion must not apply it: %s" % arrows_named(els)
    pg = by_creation(els)[2]
    opts = read_options(page)
    assert "API Gateway" in opts[0]["title"] and "Postgres" in opts[0]["title"], "expected API Gateway -> Postgres first: %s" % opts
    shot(page, evidence, "core-loop-connections-suggested", "2-postgres-offered")

    # Enter on the empty bar accepts the highlighted link, and only that.
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len([e for e in es if e.get("kind") == "arrow"]) == 1, what="Enter to accept the link")
    shot(page, evidence, "core-loop-connections-suggested", "3-accepted")
    arrow = skot.arrows()[0]
    assert (arrow["fromId"], arrow["toId"]) == (gw["id"], pg["id"]), "accepted link should be API Gateway -> Postgres: %s" % arrows_named(els)
    assert len([e for e in els if is_shape(e)]) == 3, "accepting a link must not add nodes"
    assert bar_of(page).input_value() == "" and bar_of(page).evaluate("el => el === document.activeElement")

    # A typed flow draws the arrows that were typed and no others (second judge, prod 22 Nov: App -> Worker appeared).
    page.keyboard.press("Escape")
    before = len(skot.arrows())
    bar_of(page).click()
    page.keyboard.type("worker -> queue", delay=25)
    page.keyboard.press("Enter")
    els = board(skot, 5)
    page.wait_for_timeout(400)
    els = skot.elements()
    shot(page, evidence, "core-loop-connections-suggested", "4-flow")
    by_label = {e["label"]: e for e in els if is_shape(e)}
    new = [a for a in els if a.get("kind") == "arrow" and by_label["Worker"]["id"] in (a["fromId"], a["toId"])
           or a.get("kind") == "arrow" and by_label["Queue"]["id"] in (a["fromId"], a["toId"])]
    assert len(skot.arrows()) == before + 1, "the flow must add exactly the one typed arrow: %s" % arrows_named(els)
    assert [(a["fromId"], a["toId"]) for a in new] == [(by_label["Worker"]["id"], by_label["Queue"]["id"])], arrows_named(els)
    assert not overlapping_pairs(els), overlapping_pairs(els)
    evidence.note(arrows=arrows_named(els))
    assert_no_console_errors(evidence)


def loop_result(page, skot, settle_ms):
    """app, api gateway, postgres, app again, then Enter on the empty bar (accept the first suggestion)."""
    skot.new_board()
    for name in ["app", "api gateway", "postgres", "app"]:
        added, ms = type_enter(page, name, settle_ms=settle_ms)
        assert added == 1 and ms is not None and ms < 400, "%r: added %s in %s ms" % (name, added, ms)
    page.wait_for_timeout(settle_ms)
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len([e for e in es if e.get("kind") == "arrow"]) >= 1, what="the accepted suggestion")
    page.wait_for_timeout(400)
    els = skot.elements()
    ordered = by_creation(els)
    o = ordered[0]
    return {"nodes": [(e["label"], e["kind"], e.get("sublabel"), e["x"] - o["x"], e["y"] - o["y"]) for e in ordered],
            "arrows": arrows_named(els)}


def panel_after_one_more(page):
    """Add one more node and read the suggestion panel once the AI has had time to answer (or fail)."""
    type_enter(page, "redis")
    page.wait_for_timeout(1500)
    return page.locator('[role=region][aria-label="Predictive drafting suggestions"]').inner_text().replace("\n", " ")


@check("core-loop-ai-optional")
def test_core_loop_ai_optional(page, skot, new_page, evidence, base_url, ai):
    results, panels = {}, {}
    for mode, settle in (("ok", 900), ("fail", 0), ("hang", 0), ("ok-fast", 0)):
        p = new_page(mode)
        ai(p, mode.split("-")[0])
        results[mode] = loop_result(p, Driver(p, base_url), settle)
        shot(p, evidence, "core-loop-ai-optional", mode)
        if mode in ("ok", "fail"):
            panels[mode] = panel_after_one_more(p)
            shot(p, evidence, "core-loop-ai-optional", mode + "-panel")
    evidence.note(**results)
    # Judge on prod, 22 Nov: with the AI returning 500 the panel said "jev deciding…" for ever.
    assert "deciding" not in panels["fail"], "the panel still says deciding after the AI failed: %r" % panels["fail"][:200]
    assert "scored by jev" in panels["ok"] and "jev pick" in panels["ok"], "jev's score should show when it answers: %r" % panels["ok"][:200]
    first = results["ok"]
    assert len(first["nodes"]) == 4 and len(first["arrows"]) == 1, first
    for mode, got in results.items():
        assert got == first, "the board differs when the AI is %r:\n%s\n%s" % (mode, got, first)
    # The page fixture's own tab is unused; the failures the "fail" visitor logs are the point of the test.
    errs = [e for e in evidence.errors() if e["who"] not in ("fail",)]
    assert not errs, "console errors outside the AI-failing visitor: %s" % json.dumps(errs[:6], indent=1)


@check("core-loop-keyboard")
def test_core_loop_keyboard(page, skot, evidence, ai):
    """No mouse at all, from the moment the page opens."""
    ai(page, "fail")
    evidence.events.clear()
    skot.new_board()
    assert bar_of(page).evaluate("el => el === document.activeElement"), "the Thought Bar should have the caret when the board opens"
    page.keyboard.type("app", delay=25)
    page.keyboard.press("Enter")
    board(skot, 1)
    page.keyboard.type("api", delay=25)
    page.keyboard.press("Tab")
    assert bar_of(page).input_value() == "API Gateway", "Tab completes the name: %r" % bar_of(page).input_value()
    page.keyboard.press("Enter")
    board(skot, 2)
    assert read_options(page), "the connection should be offered"
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    shot(page, evidence, "core-loop-keyboard", "1-after-escape")
    assert page.locator(SUGGESTIONS_PANEL).count() == 0, "Esc should dismiss the suggestions"
    assert bar_of(page).evaluate("el => el === document.activeElement"), "Esc on suggestions must keep the caret in the bar"
    page.keyboard.type("postgres", delay=25)
    page.keyboard.press("Enter")
    els = board(skot, 3)
    page.keyboard.press("Enter")  # accept API Gateway -> Postgres
    els = skot.wait_state(lambda es: len([e for e in es if e.get("kind") == "arrow"]) == 1, what="Enter to accept the link")
    shot(page, evidence, "core-loop-keyboard", "2-done")
    evidence.note(nodes=[e["label"] for e in by_creation(els)], arrows=arrows_named(els))
    assert [e["label"] for e in by_creation(els)] == ["App", "API Gateway", "Postgres"]
    assert arrows_named(els) == [("API Gateway", "Postgres")], arrows_named(els)
    assert not [e for e in evidence.errors() if "/api/jev/decide" not in e["text"] and "500" not in e["text"]], evidence.errors()[:4]
