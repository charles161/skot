"""Charles's answers to the round-2 decision list (22 Nov 2026, 15:03 IST): "A".

1A  Enter on the empty bar accepts only a connection of the node just added. Any other suggestion needs Tab first.
5A  On a phone the text stays readable and the view pans to the newest node; it does not zoom out to fit the board.
8A  When a Fork take renames the selected node, its arrows stay on that node (test_fork_rename.py).
4A  The dead per-keystroke next_options mode is deleted from the server.
"""
import json
import re

from conftest import assert_no_console_errors, check
from driver import Driver, is_shape, overlapping_pairs
from test_core_loop import JEV, ai, arrows_named, bar_of, board, by_creation, type_enter  # noqa: F401 (ai is a fixture)
from test_features import SUGGESTIONS, ghosts, read_options, shot

KEY_LEGEND = SUGGESTIONS + " [data-key-legend]"


def labels(skot):
    return [e["label"] for e in by_creation(skot.elements())]


def legend(page):
    return " ".join(page.locator(KEY_LEGEND).inner_text().split())


def highlighted(page):
    return [o["title"] for o in read_options(page) if o["active"]]


def assert_hint_honest(page, when):
    """With nothing highlighted Enter does nothing, so no text near the suggestions may say that it does."""
    region = page.locator(SUGGESTIONS)
    if region.count() == 0:
        return
    text = " ".join(region.inner_text().split())
    if not highlighted(page):
        lies = [w for w in ("Enter accepts", "Enter adds", "Enter connects", "Enter draws", "Enter ↵") if w in text]
        assert not lies, "%s: nothing is highlighted, yet the panel says %s: %r" % (when, lies, text[:160])


@check("hint-never-lies")
def test_hint_never_lies(page, skot, evidence, ai):
    """Judge A, round 4 (twice): after an accepted connection, and after a Tab-picked bigger option, the pill
    still read "Connect API Gateway? Enter accepts" / "Enter adds API Gateway" while Enter did nothing."""
    ai(page, "ok")
    skot.new_board()
    skot.set_suggestions_mode("full")
    type_enter(page, "app")
    type_enter(page, "api gateway")
    board(skot, 2)
    page.wait_for_timeout(600)
    assert highlighted(page), "the offered connection is highlighted"
    for option in (2, 3):
        page.keyboard.press("Tab")
    page.wait_for_timeout(200)
    n = len([e for e in skot.elements() if is_shape(e)])
    page.keyboard.press("Enter")
    skot.wait_state(lambda es: len([e for e in es if is_shape(e)]) > n, what="the Tab-picked bigger option")
    page.wait_for_timeout(2500)
    shot(page, evidence, "hint-never-lies", "1-after-bigger-option")
    assert_hint_honest(page, "after a Tab-picked bigger option")
    els_before = len(skot.elements())
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    assert len(skot.elements()) == els_before, "Enter with nothing highlighted added something"

    type_enter(page, "postgres")
    page.wait_for_timeout(400)
    if highlighted(page):
        page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    shot(page, evidence, "hint-never-lies", "2-after-accepted-connection")
    assert_hint_honest(page, "after an accepted connection")

    # The full stack around a node: whatever is left on screen afterwards must still be true.
    type_enter(page, "kafka")
    page.wait_for_timeout(300)
    for _ in range(3):
        page.keyboard.press("Tab")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    shot(page, evidence, "hint-never-lies", "3-after-full-option")
    assert_hint_honest(page, "after the biggest option")
    assert_no_console_errors(evidence)


@check("enter-needs-pick")
def test_enter_needs_pick(page, skot, evidence, ai):
    ai(page, "ok")
    skot.new_board()
    skot.set_suggestions_mode("full")

    # 1. One node on the board: nothing to connect. Enter, Enter, Enter must not add nodes nobody typed.
    type_enter(page, "app")
    board(skot, 1)
    page.wait_for_timeout(2500)  # the AI has answered: its fourth option is on screen
    opts = read_options(page)
    shot(page, evidence, "enter-needs-pick", "1-after-add")
    assert len(opts) >= 3, opts
    assert not highlighted(page), "no suggestion may be highlighted before the user picks one: %s" % highlighted(page)
    assert ghosts(page) == {"shapes": [], "arrows": []}, "no ghost before the user picks: %s" % ghosts(page)
    assert "Enter" not in legend(page), "the legend must not promise Enter adds something: %r" % legend(page)
    for _ in range(3):
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
    page.wait_for_timeout(600)
    assert labels(skot) == ["App"], "Enter on the empty bar added nodes that were never typed or picked: %s" % labels(skot)
    assert bar_of(page).evaluate("el => el === document.activeElement"), "the caret stays in the bar"

    # 2. Tab picks; then Enter adds exactly that suggestion.
    page.keyboard.press("Tab")
    picked = highlighted(page)
    assert len(picked) == 1 and picked[0] == opts[0]["title"], "Tab highlights the first suggestion: %s" % picked
    assert ghosts(page)["shapes"], "the picked suggestion is previewed on the board"
    assert legend(page).startswith("Enter"), legend(page)
    shot(page, evidence, "enter-needs-pick", "2-tab-picked")
    page.keyboard.press("Enter")
    els = board(skot, 2)
    second = by_creation(els)[1]["label"]
    assert second.lower() in opts[0]["title"].lower(), "Enter adds what Tab picked (%s), got %s" % (opts[0]["title"], second)

    # 3. A typed node that has a connection on offer: Enter accepts the connection, and only that.
    type_enter(page, "postgres")
    els = board(skot, 3)
    first = read_options(page)[0]
    assert first["active"] and first["category"] == "connect", "the offered connection is highlighted: %s" % first
    assert legend(page).startswith("Enter ↵ connect"), legend(page)
    before = arrows_named(els)
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len(arrows_named(es)) == len(before) + 1, what="the accepted connection")
    new = [a for a in arrows_named(els) if a not in before]
    assert "Postgres" in new[0], "Enter accepts a connection of the node just added: %s" % new
    shot(page, evidence, "enter-needs-pick", "3-connection-accepted")
    # One Enter, one connection. The node's other possible connections are offered, not highlighted: more
    # Enters add nothing (prod walk, 22 Nov: four Enters wired Metrics to four more nodes).
    page.wait_for_timeout(500)
    assert not highlighted(page), "after the connection is accepted nothing is highlighted: %s" % highlighted(page)
    for _ in range(3):
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
    els = skot.elements()
    assert len([e for e in els if is_shape(e)]) == 3, "Enter after the connection added nodes: %s" % labels(skot)
    assert len(arrows_named(els)) == len(before) + 1, "Enter after the connection added more arrows: %s" % arrows_named(els)

    # Judge A, round 4: after "Enter, Enter" the pill above the panel still said "Enter accepts" with nothing
    # highlighted. The pill must not promise a key that does nothing.
    pill = " ".join(page.locator(SUGGESTIONS).inner_text().split())
    assert "Enter accepts" not in pill, "nothing is highlighted, yet the panel says Enter accepts: %r" % pill[:160]

    # 3b. A node that could connect to several others: Enter still takes one connection only.
    type_enter(page, "auth service")
    type_enter(page, "metrics")
    els = board(skot, 5)
    opts = read_options(page)
    links = [o for o in opts if o["category"] == "connect"]
    assert len(links) >= 2 and opts[0]["active"], "Metrics should have several connections on offer: %s" % [o["title"] for o in opts]
    n_arrows = len(arrows_named(els))
    for _ in range(4):
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
    page.wait_for_timeout(500)
    shot(page, evidence, "enter-needs-pick", "3b-one-connection-only")
    pill = " ".join(page.locator(SUGGESTIONS).inner_text().split())
    assert not highlighted(page) and "Enter accepts" not in pill, \
        "Metrics has more connections on offer and none highlighted, yet the panel says Enter accepts: %r" % pill[:160]
    els = skot.elements()
    assert len(arrows_named(els)) == n_arrows + 1, \
        "four Enters must accept one connection, not chain through the rest: %s" % arrows_named(els)[n_arrows:]
    assert len([e for e in els if is_shape(e)]) == 5

    # 4. Clicking a node shows its suggestions; Enter does not add any of them.
    skot.clear()
    skot.click_element("Postgres")
    page.wait_for_function("s => !!document.querySelector(s + ' button[aria-pressed]')", arg=SUGGESTIONS, timeout=8000)
    page.wait_for_timeout(2500)
    assert not highlighted(page), "a clicked node's suggestions need Tab first: %s" % highlighted(page)
    shot(page, evidence, "enter-needs-pick", "4-clicked-node")
    n_arrows = len(arrows_named(skot.elements()))
    bar_of(page).click()
    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    els = skot.elements()
    assert len([e for e in els if is_shape(e)]) == 5 and len(arrows_named(els)) == n_arrows, \
        "Enter after a click added something: %s %s" % (labels(skot), arrows_named(els))

    # 5. Judge A, round 4: after drawing an arrow with the arrow tool, Enter added a second arrow nobody picked
    # (the target's other connection was highlighted). A drawn arrow adds no node, so nothing is on offer to Enter.
    skot.clear()
    n_arrows = len(arrows_named(skot.elements()))
    skot.connect("App", "Auth Service")
    page.wait_for_timeout(700)
    assert not highlighted(page), "after a drawn arrow nothing is highlighted: %s" % highlighted(page)
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    page.keyboard.press("Escape")
    els = skot.elements()
    shot(page, evidence, "enter-needs-pick", "5-after-drawn-arrow")
    assert len(arrows_named(els)) == n_arrows + 1, "Enter after a drawn arrow added another arrow: %s" % arrows_named(els)

    # 6. Judge A, round 4: the options carry numbers, but "2" typed a 2. A digit is text like a letter, in the bar
    # and on the board: a name may start with one ("2fa service"), and no bare key is a shortcut.
    skot.clear()
    skot.click_element("Postgres")
    page.wait_for_function("s => !!document.querySelector(s + ' button[aria-pressed]')", arg=SUGGESTIONS, timeout=8000)
    before_ids = {e["id"] for e in skot.elements()}
    page.keyboard.type("2fa service", delay=30)
    assert bar_of(page).input_value() == "2fa service", "digits typed on the board go to the bar with the letters: %r" % bar_of(page).input_value()
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len({e["id"] for e in es} - before_ids) == 1, what="the node 2fa service")
    new = next(e for e in els if e["id"] not in before_ids)
    assert new["label"].lower() == "2fa service", "the node is named what was typed: %r" % new["label"]
    evidence.note(nodes=labels(skot), arrows=arrows_named(els))

    # 7. Judge B, second round: "app, Enter, postgres, Enter", click App, Enter within 300 ms accepted the
    # connection still on offer for the last node; after 600 ms the same keys did not. A click takes the offer
    # back at once. (Since 15A an app and a database have no usual connection, so the pair is app and gateway.)
    skot.new_board()
    type_enter(page, "app")
    type_enter(page, "api gateway")
    board(skot, 2)
    assert highlighted(page), "the connection of API Gateway is on offer"
    app = skot.by_label("App")
    page.mouse.click(*skot.to_screen(app["x"] + app["width"] / 2, app["y"] + app["height"] * 0.55))
    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    shot(page, evidence, "enter-needs-pick", "7-click-then-enter")
    assert arrows_named(skot.elements()) == [], "Enter right after clicking a node accepted the old offer: %s" % arrows_named(skot.elements())

    # 8. Both judges, third round: after clicking another node the pill still read "Connect Postgres? Enter
    # accepts" while Enter edited the clicked node's name.
    type_enter(page, "redis")
    board(skot, 3)
    assert highlighted(page), "the connection of Redis is on offer"
    page.mouse.click(*skot.to_screen(app["x"] + app["width"] / 2, app["y"] + app["height"] * 0.55))
    page.wait_for_timeout(150)
    assert_hint_honest(page, "right after clicking another node")
    page.wait_for_timeout(1200)
    assert_hint_honest(page, "a second after clicking another node")

    # 9. Judge A, third round: Alt+R, drag a box, name it "Billing", Enter, Enter added API Gateway -> Billing. A
    # node drawn with a tool is named with its own Enter; a second Enter must not be read as "connect it".
    skot.new_board()
    type_enter(page, "app")
    type_enter(page, "api gateway")
    els = board(skot, 2)
    n_arrows = len(arrows_named(els))
    gw = skot.by_label("API Gateway")
    skot.add("box", "Billing", (gw["x"] + gw["width"] + 220, gw["y"] + gw["height"] / 2))
    page.wait_for_timeout(500)
    assert not highlighted(page), "a tool-drawn node's connections are offered, not highlighted: %s" % highlighted(page)
    assert_hint_honest(page, "after naming a tool-drawn node")
    for _ in range(2):
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    shot(page, evidence, "enter-needs-pick", "9-tool-drawn-then-enter")
    assert len(arrows_named(skot.elements())) == n_arrows, "Enter after naming a tool-drawn node added an arrow: %s" % arrows_named(skot.elements())
    assert_no_console_errors(evidence)


PHONE = {"width": 390, "height": 844}
DOCK_JS = """() => {
  const bar = document.querySelector('input[aria-label="Describe a component or diagram flow to draw"]');
  const region = document.querySelector('[role=region][aria-label="Predictive drafting suggestions"]');
  const tops = [bar, region].filter(Boolean).map((n) => n.getBoundingClientRect().top);
  return Math.min(...tops);
}"""
LABEL_HEIGHT_JS = """(id) => {
  const snap = window.__skotDebug && window.__skotDebug.getSceneSnapshot && window.__skotDebug.getSceneSnapshot();
  if (snap) {
    const el = snap.elements.find(e => e.id === id);
    return el ? 14 * snap.viewport.zoom : 0;
  }
  return Math.max(0, ...[...document.querySelectorAll(
    `[role=application] svg [data-element-id="${CSS.escape(id)}"] text, [role=application] svg [data-element-id="${CSS.escape(id)}"] foreignObject *`
  )].filter((n) => n.children.length === 0 && n.textContent.trim()).map((n) => n.getBoundingClientRect().height));
}"""


@check("phone-pans")
def test_phone_pans(browser, server, base_url, evidence):
    """5A. On a phone a growing board does not zoom out: the text keeps its size and the view moves to the node
    that was just added. Earlier nodes may scroll off; the user pans back to them."""
    headers = {"CF-Connecting-IP": "198.18.240.9"} if server["launched"] else {}
    ctx = browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True, device_scale_factor=2, extra_http_headers=headers)
    ctx.route(re.compile(r"/_vercel/(insights|speed-insights)/"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=""))
    page = ctx.new_page()
    evidence.watch(page, "phone")
    page.route("**/api/jev/decide", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(
        dict(JEV, nextActionProbabilities=None, contextSuggestions=[]))))
    skot = Driver(page, base_url)
    try:
        skot.new_board()
        bar_of(page).tap()
        names = ["app", "api gateway", "postgres", "redis", "queue", "worker", "cdn", "search", "metrics"]
        zooms, heights = [], []
        for i, name in enumerate(names, 1):
            page.keyboard.type(name, delay=20)
            page.keyboard.press("Enter")
            els = board(skot, i)
            page.wait_for_timeout(700)
            newest = by_creation(els)[-1]
            v = skot.viewport()
            zooms.append(round(v["zoom"], 3))
            heights.append(round(page.evaluate(LABEL_HEIGHT_JS, newest["id"]), 1))
            dock_top = page.evaluate(DOCK_JS)
            x1, y1 = skot.to_screen(newest["x"], newest["y"], v)
            x2, y2 = skot.to_screen(newest["x"] + newest["width"], newest["y"] + newest["height"], v)
            if i in (1, 5, len(names)):
                shot(page, evidence, "phone-pans", "%d-nodes" % i)
            # Judge B, second round: the header and toolbar floated over the newest node at the top of the column.
            bars_bottom = page.evaluate("""() => Math.max(...[...document.querySelectorAll('button[aria-label*=" tool ("]')].map((b) => b.getBoundingClientRect().bottom))""")
            assert x1 >= 0 and x2 <= PHONE["width"] and y1 >= bars_bottom and y2 <= dock_top, \
                "node %d (%s) is not in view after it was added: %s, toolbar ends at %d, dock at %d" % (
                    i, newest["label"], (round(x1), round(y1), round(x2), round(y2)), bars_bottom, dock_top)
        evidence.note(zooms=zooms, label_heights_px=heights, nodes=[e["label"] for e in by_creation(skot.elements())])
        assert len(set(zooms)) == 1, "adding nodes on a phone must not change the zoom: %s" % zooms
        assert zooms[0] >= 0.9, "a new board on a phone starts at a readable size: %s" % zooms[0]
        assert min(heights) >= 14, "node names must stay readable (at least 14 px tall on screen): %s" % heights
        assert_no_console_errors(evidence)
    finally:
        ctx.close()


OLD_KEYSTROKE_REQUEST = {
    "mode": "next_options", "trigger": "type", "text": "apigateway", "conceptLabel": "API Gateway",
    "anchorLabel": "Client Dashboard", "selectedLabels": [], "boardLabels": ["Client Dashboard"],
    "options": [
        {"id": "minimal", "title": "API Gateway", "description": "Client Dashboard to API Gateway", "nodes": 1},
        {"id": "cluster", "title": "API Gateway + Auth Service + Core Service", "description": "linked from Client Dashboard", "nodes": 3},
        {"id": "full", "title": "Full API backend", "description": "API Gateway, Auth Service, Core Service", "nodes": 9},
    ],
}


@check("keystroke-route-removed")
def test_keystroke_route_removed(page, skot, evidence, base_url):
    """4A. The request the app used to send on every keystroke is no longer a mode the server knows."""
    skot.new_board()
    res = page.request.post(base_url.rstrip("/") + "/api/jev/decide", data=json.dumps(OLD_KEYSTROKE_REQUEST),
                            headers={"content-type": "application/json"})
    evidence.note(status=res.status, body=res.text()[:200])
    assert res.status == 400, "next_options must be rejected as an unknown mode, got %d: %s" % (res.status, res.text()[:200])


@check("flow-both-ways")
def test_flow_both_ways(page, skot, evidence):
    """Judge B, round 4: "web -> queue" then "queue -> web" cleared the bar and drew nothing, with no message.
    A typed flow is drawn as typed, the way back included; a flow that is already there says so on screen."""
    page.route("**/api/jev/decide", lambda r: r.fulfill(status=500, content_type="application/json", body='{"error":"off"}'))
    skot.new_board()
    skot.set_suggestions_mode("full")
    bar_of(page).click()
    page.keyboard.type("web -> queue", delay=25)
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: arrows_named(es) == [("Web", "Queue")], what="web -> queue")
    nodes = {e["id"]: (e["x"], e["y"]) for e in els if is_shape(e)}

    page.keyboard.type("queue -> web", delay=25)
    page.wait_for_timeout(400)
    preview = ghosts(page)["arrows"]
    assert len(preview) == 1, "the way back is previewed before Enter: %s" % preview
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len(arrows_named(es)) == 2, what="queue -> web drawn as a second arrow")
    shot(page, evidence, "flow-both-ways", "1-there-and-back")
    assert sorted(arrows_named(els)) == [("Queue", "Web"), ("Web", "Queue")], arrows_named(els)
    # Judge A, second round: the way back was drawn exactly on top of the way there and read as one arrow.
    labels_at = page.evaluate("""() => {
        const snap = window.__skotDebug && window.__skotDebug.getSceneSnapshot && window.__skotDebug.getSceneSnapshot();
        const app = document.querySelector('[role=application]');
        if (snap && app) {
            const r = app.getBoundingClientRect();
            const v = snap.viewport;
            return snap.elements.filter(e => e.kind === 'arrow' && e.labelPill).map(e => {
                const p = e.labelPill;
                const cx = r.left + v.x + p.x * v.zoom;
                const cy = r.top + v.y + p.y * v.zoom;
                const hw = (p.width / 2) * v.zoom;
                const hh = (p.height / 2) * v.zoom;
                return {text: p.text, top: cy - hh, bottom: cy + hh, left: cx - hw, right: cx + hw};
            });
        }
        return [...document.querySelectorAll('[role=application] svg [data-element-id][data-kind="arrow"]')].map((g) => {
            const t = [...g.querySelectorAll('text')].find((n) => n.textContent.trim());
            const r = t.getBoundingClientRect();
            return {text: t.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right};
        });
    }""")
    assert len(labels_at) == 2, labels_at
    a, b = labels_at
    overlap = not (a["bottom"] <= b["top"] or b["bottom"] <= a["top"] or a["right"] <= b["left"] or b["right"] <= a["left"])
    assert not overlap, "there and back must read as two arrows, each with its own label in the clear: %s" % labels_at
    assert {e["id"]: (e["x"], e["y"]) for e in els if is_shape(e)} == nodes, "the way back must not add or move nodes"

    page.keyboard.type("web -> queue", delay=25)
    page.keyboard.press("Enter")
    notice = page.locator('[data-testid="board-notice"]')
    notice.wait_for(state="visible", timeout=3000)
    shot(page, evidence, "flow-both-ways", "2-already-there")
    assert "already on the board" in notice.inner_text(), notice.inner_text()
    page.wait_for_timeout(500)
    assert len(arrows_named(skot.elements())) == 2 and bar_of(page).input_value() == "", "a repeated flow adds nothing and clears the bar"
    # The notice is about the last thing typed: it goes as soon as the user types again.
    page.keyboard.type("c")
    page.wait_for_timeout(300)
    assert notice.count() == 0, "the notice is still up after the user typed again"
    page.keyboard.press("Backspace")
    evidence.note(arrows=arrows_named(skot.elements()))
    console = [e for e in evidence.errors() if "/api/jev/decide" not in e["text"] and "500" not in e["text"]]
    assert not console, console[:4]


@check("ring-around-selection")
def test_ring_around_selection(page, skot, evidence):
    """Judge A, second round: with API selected the sixth and seventh nodes went two rows away while the whole
    left side of API stayed empty, and "svc a" was named "Svc a" next to "Svc B"."""
    page.route("**/api/jev/decide", lambda r: r.fulfill(status=500, content_type="application/json", body='{"error":"off"}'))
    skot.new_board()
    type_enter(page, "api")
    api = board(skot, 1)[0]
    letters = "abcdefgh"
    for i, letter in enumerate(letters, 2):
        skot.clear()
        skot.click_element(api["label"])
        page.keyboard.type("svc " + letter, delay=20)
        page.keyboard.press("Enter")
        board(skot, i)
        page.wait_for_timeout(250)
    els = by_creation(skot.elements())
    page.keyboard.press("Escape")
    page.mouse.move(8, 500)
    shot(page, evidence, "ring-around-selection", "eight-around-api")
    assert [e["label"] for e in els[1:]] == ["Svc " + c.upper() for c in letters], [e["label"] for e in els]
    cx, cy = api["x"] + api["width"] / 2, api["y"] + api["height"] / 2
    cells = [(round((e["x"] + e["width"] / 2 - cx) / 300), round((e["y"] + e["height"] / 2 - cy) / 128)) for e in els[1:]]
    evidence.note(cells=cells)
    assert len(set(cells)) == 8 and all(abs(c) <= 1 and abs(r) <= 1 for c, r in cells), \
        "eight nodes added with API selected must fill the ring around it: %s" % cells
    assert not overlapping_pairs(skot.elements())

