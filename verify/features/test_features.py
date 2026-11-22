"""One user-level check per feature in verify/features.yml. Each drives the real UI like a person would."""
import base64
import gzip
import json
import math
import os
import re
import shutil
import time
import urllib.request

from conftest import REPO, assert_no_console_errors, check
from driver import Driver, center, is_shape, overlapping_pairs

THOUGHT_BAR = "Describe a component or diagram flow to draw"
SUGGESTIONS = '[role=region][aria-label="Predictive drafting suggestions"]'
FORK_PANEL = '[role=region][aria-label="Fork It architectural takes"]'
FORK_PRESSURE = '[role=region][aria-label="Fork It pressure"]'
MULTI_BAR = '[role=toolbar][aria-label="Multi-selection actions"]'
# Same generic labels as GENERIC_SUGGESTION_LABELS in src/lib/jev/prediction-engine.ts.
GENERIC = ["Next Step", "Decision?", "Data Store", "Observability", "Rate Limiter", "Audit Store",
           "Core Architecture", "Parallel Group"]
# Same character class as src/brand/no-stock-icons.test.ts, applied to what the browser renders.
SCAN_UI_JS = r"""() => {
  const pict = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;
  const hits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement && n.parentElement.closest('script, style')) continue;
    if (pict.test(n.textContent)) hits.push('text: ' + n.textContent.trim().slice(0, 60));
  }
  for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v && pict.test(v)) hits.push(a + ': ' + v.slice(0, 60));
    }
  }
  const stock = [...document.querySelectorAll('svg[class]')].map(s => s.getAttribute('class'))
    .filter(c => /\b(lucide|tabler-icon|heroicon|feather|fa-|phosphor|remixicon|iconify)/.test(c));
  return {pictographic: hits, stock: stock.slice(0, 10), svgCount: document.querySelectorAll('svg').length};
}"""


def open_fork_takes(page, skot, pressure=None):
    """Fork starter -> pressure step -> a pressure chip (or Skip) -> the three takes, once evaluated."""
    skot.new_board("fork")
    step = page.locator(FORK_PRESSURE)
    step.wait_for(state="visible", timeout=20000)
    if pressure:
        step.get_by_role("button", name=pressure).click()
    else:
        step.get_by_role("button", name="Skip: classic takes").click()
    panel = page.locator(FORK_PANEL)
    panel.wait_for(state="visible", timeout=20000)
    page.wait_for_function("s => !/Evaluating takes/.test(document.querySelector(s)?.textContent || '')",
                           arg=FORK_PANEL, timeout=20000)
    return panel


def labels(els):
    return sorted(e.get("label") or "" for e in els if is_shape(e))


def generic_count(titles):
    return sum(1 for t in titles if any(g.lower() in t.lower() for g in GENERIC))


ICO_TYPES = {"image/x-icon", "image/vnd.microsoft.icon"}  # both are registered names for .ico


def same_type(served, declared):
    served = served.split(";")[0].strip().lower()
    return served == declared or {served, declared} <= ICO_TYPES


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "skot-feature-verify"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.headers.get("content-type", ""), r.read()


# ------------------------------------------------------------------ load, theme, brand

@check("first-load")
def test_first_load(page, skot, evidence):
    page.emulate_media(color_scheme="light")  # dark must win even when the OS prefers light
    skot.new_board()
    skot.settle(1500)
    html_class = page.evaluate("document.documentElement.className")
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    rgb = [int(v) for v in re.findall(r"\d+", bg)[:3]]
    toggle = page.get_by_role("button", name=re.compile("Switch to .* light theme"))
    evidence.note(url=page.url, html_dark=" dark" in " " + html_class, body_background=bg,
                  canvas=page.locator("[role=application] svg").count())
    assert page.locator("[role=application] svg").count() == 1, "the canvas did not render"
    assert "#room=" in page.url, "no room was created in the URL fragment"
    assert "dark" in html_class.split(), "html is not dark by default (class=%r)" % html_class
    assert max(rgb) < 80, "body background %s is not a dark color" % bg
    assert toggle.count() == 1, "theme toggle should offer the light theme, meaning dark is active"
    assert_no_console_errors(evidence)


@check("beta-badge")
def test_beta_badge(page, skot, evidence):
    skot.new_board()
    badge = page.get_by_role("banner").get_by_text("Beta", exact=True)
    assert badge.count() == 1, "no Beta badge in the header"
    assert badge.is_visible()
    box = badge.bounding_box()
    evidence.note(badge_box=box, badge_text=badge.inner_text())
    assert box["width"] > 10 and box["height"] > 8, "Beta badge has no visible size"
    assert_no_console_errors(evidence)


# ------------------------------------------------------------------ drawing

@check("starters")
def test_starters(page, skot, evidence):
    seen = {}
    skot.new_board("checkout")
    seen["checkout"] = labels(skot.elements())
    for want in ["Customer", "Checkout API", "Payment Gateway", "Ledger DB"]:
        assert want in seen["checkout"], "checkout starter is missing %r: %s" % (want, seen["checkout"])
    assert len(skot.arrows()) >= 4, "checkout starter has no connections"

    skot.new_board("sequence")
    skot.wait_state(lambda es: any((e.get("morphMeta") or {}).get("notation") == "sequence" for e in es),
                    timeout=20, what="the sequence starter to morph")
    seen["sequence"] = labels(skot.elements())

    open_fork_takes(page, skot)
    seen["fork"] = labels(skot.elements())
    seen["fork_panel"] = page.locator(FORK_PANEL).locator("[role=tab]").count()
    evidence.note(**seen)
    assert seen["fork_panel"] == 3, "Fork starter should open three takes, got %d" % seen["fork_panel"]
    assert_no_console_errors(evidence)


STARTER_BOARDS = {"url-shortener": "URL shortener", "chat": "Chat", "news-feed": "News feed",
                  "rate-limiter": "Rate limiter", "payments": "Payments", "notifications": "Notifications"}
CARD_TEXT_JS = r"""id => {
  const g = document.querySelector(`[role=application] svg [data-element-id="${CSS.escape(id)}"]`);
  return g ? [...g.querySelectorAll('text')].filter(t => getComputedStyle(t).fontFamily.includes('Mono'))
    .map(t => t.getComputedTextLength()) : null;
}"""


@check("starter-boards")
def test_starter_boards(page, skot, evidence):
    seen = {}
    for i, (bid, title) in enumerate(STARTER_BOARDS.items()):
        skot.new_board()
        if i == 0:
            page.get_by_role("button", name="Board menu").click()
            page.get_by_role("menuitem", name=title, exact=True).click()
        else:
            skot.open_examples()
            page.get_by_role("button", name="Starter board: " + title).click()
        els = skot.wait_state(lambda es: any(e["id"] == bid + "_requirements" for e in es), timeout=15,
                              what="the %s starter board" % bid)
        skot.settle(600)
        by_id = {e["id"]: e for e in els}
        kinds = [e["kind"] for e in els]
        notations = sorted({(e.get("morphMeta") or {}).get("notation") for e in els} - {None})
        sections = {k: bid + "_" + k for k in ("requirements", "numbers", "zone", "breaks", "er_caption", "seq_caption")}
        missing = [k for k, el_id in sections.items() if el_id not in by_id or not skot.rendered(el_id)]
        v = skot.viewport()
        offscreen = []
        for e in els:
            if not is_shape(e):
                continue
            x1, y1 = skot.to_screen(e["x"], e["y"], v)
            x2, y2 = skot.to_screen(e["x"] + e["width"], e["y"] + e["height"], v)
            if x1 < 0 or y1 < 0 or x2 > 1600 or y2 > 1000:
                offscreen.append(e.get("label") or e["id"])
        req = by_id.get(bid + "_requirements")
        overflow = [c["label"] for c in els if c["kind"] == "card" and
                    max(skot.page.evaluate(CARD_TEXT_JS, c["id"]) or [0]) > c["width"] - 20]
        widest = max(skot.page.evaluate(CARD_TEXT_JS, req["id"]) or [0])
        seen[bid] = {"title": page.get_by_role("textbox", name="Board title").input_value(), "zoom": v["zoom"],
                     "entities": kinds.count("entity"), "fragments": kinds.count("fragment"),
                     "activations": kinds.count("activation"), "notations": notations, "missing": missing,
                     "offscreen": offscreen[:5], "overflowing_cards": overflow, "card_text_px": round(widest), "card_px": req["width"]}
        assert not missing, "%s: sections not drawn: %s" % (bid, missing)
        assert seen[bid]["title"] == title, seen[bid]
        assert notations == ["er", "sequence"], "%s: morph groups %s" % (bid, notations)
        assert seen[bid]["entities"] >= 3 and seen[bid]["fragments"] >= 1 and seen[bid]["activations"] >= 2, seen[bid]
        assert not offscreen, "%s: zoom to fit left shapes off screen: %s" % (bid, offscreen)
        assert not overflow, "%s: card text overflows its card at zoom %s: %s" % (bid, v["zoom"], overflow)
    page.get_by_role("button", name="Undo").click()
    skot.wait_state(lambda es: not any(e["id"].startswith("notifications_") for e in es), timeout=5,
                    what="Undo to remove the starter board")
    evidence.note(**seen)
    assert_no_console_errors(evidence)


@check("write-to-draw")
def test_write_to_draw(page, skot, evidence):
    skot.new_board()
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    bar.fill("app -> gateway -> server")
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len([e for e in es if is_shape(e)]) >= 3 and
                          len([e for e in es if e.get("kind") == "arrow"]) >= 2,
                          timeout=20, what="three nodes and two arrows from the Thought Bar")
    by_id = {e["id"]: e for e in els}
    chain = [(by_id[a["fromId"]]["label"], by_id[a["toId"]]["label"]) for a in els
             if a.get("kind") == "arrow" and a.get("fromId") in by_id and a.get("toId") in by_id]
    evidence.note(nodes=labels(els), arrows=chain)
    assert [n.lower() for n in labels(els)] == ["app", "gateway", "server"], labels(els)
    assert {(f.lower(), t.lower()) for f, t in chain} == {("app", "gateway"), ("gateway", "server")}, chain
    assert bar.input_value() == "", "the Thought Bar should clear after drawing"
    assert_no_console_errors(evidence)


@check("ghost-predictions")
def test_ghost_predictions(page, skot, evidence):
    skot.new_board()
    skot.add("box", "Web App", skot.to_world(400, 260))
    before = skot.suggestion_titles()
    assert len(before) == 3, "expected three predictions after adding a node, got %s" % before
    # 1A (22 Nov): a suggestion nobody picked is not highlighted and has no ghost; Tab picks the first.
    assert not [s for s in before if s["active"]], "no prediction is active until the user picks one: %s" % before
    assert ghosts(page) == {"shapes": [], "arrows": []}, ghosts(page)
    skot.press("Tab")
    page.wait_for_timeout(300)
    assert [s["n"] for s in skot.suggestion_titles(2) if s["active"]] == [1], "Tab picks prediction 1"
    assert ghosts(page)["shapes"], "the picked prediction is previewed"
    skot.press("Tab")
    page.wait_for_timeout(300)
    after_tab = skot.suggestion_titles(2)
    active = [s["n"] for s in after_tab if s["active"]]
    assert active == [2], "Tab should make prediction 2 active, got %s" % after_tab
    svg_bytes = page.locator("[role=application] svg").evaluate("s => s.innerHTML.length")
    n_before = len(skot.shapes())
    skot.press("Enter")
    els = skot.wait_state(lambda es: len([e for e in es if is_shape(e)]) > n_before, what="Enter to apply")
    new = [e.get("label") for e in els if is_shape(e) and e.get("label") != "Web App"]
    evidence.note(predictions=[s["title"] for s in before], applied=after_tab[1]["title"], new_nodes=new,
                  svg_bytes=svg_bytes)
    assert new and any(n and n in after_tab[1]["title"] for n in new), \
        "Enter should add the active prediction %r, added %s" % (after_tab[1]["title"], new)
    assert any(a.get("fromId") == skot.by_label("Web App")["id"] for a in skot.arrows()), \
        "the applied prediction should connect from Web App"
    assert_no_console_errors(evidence)


# ------------------------------------------------------------------ next-action options (3 tiers, small to big)

# CI has no AI keys, so the jev ranking is a fixed answer here; SKOT_REAL_AI=1 sends it to the real server
# (jev through the AI Gateway plus the Gateway LLM) instead.
NEXT_OPTIONS_FIXTURE = {
    "source": "gateway:typesafe-ai/jev", "model": "typesafe-ai/jev", "isHeuristic": False, "latencyMs": 120,
    "probabilities": {"minimal": 0.84, "cluster": 0.11, "full": 0.05}, "graphs": None,
}
TIERS = ["minimal", "cluster", "full"]
READ_OPTIONS_JS = """() => {
  const r = document.querySelector('[role=region][aria-label="Predictive drafting suggestions"]');
  if (!r) return null;
  const deciding = /deciding/.test(r.textContent);
  return {deciding, items: [...r.querySelectorAll('button[aria-pressed]')].map(b => {
    const leaves = [...b.querySelectorAll('span, p, div')].filter(n => n.children.length === 0)
      .map(n => n.textContent.trim()).filter(Boolean);
    const tier = b.querySelector('[data-option-tier]');
    const nodes = b.querySelector('[data-option-nodes]');
    return {title: leaves.filter(t => !/^\\d$/.test(t) && !t.endsWith('%'))[0] || '',
            pct: leaves.find(t => t.endsWith('%')) || null,
            tier: tier && tier.getAttribute('data-option-tier'),
            nodes: nodes ? +nodes.getAttribute('data-option-nodes') : null,
            category: b.getAttribute('data-option-category'),
            active: b.getAttribute('aria-pressed') === 'true', text: b.innerText.replace(/\\s+/g, ' ')};
  })};
}"""
READ_GHOSTS_JS = """() => ({
  shapes: [...document.querySelectorAll('[role=application] svg [data-ghost-shape]')]
    .map(g => ({id: g.getAttribute('data-ghost-shape'), label: g.getAttribute('data-label')})),
  arrows: [...document.querySelectorAll('[role=application] svg [data-ghost-arrow]')]
    .map(g => ({from: g.getAttribute('data-from'), to: g.getAttribute('data-to'), label: g.getAttribute('data-label')})),
})"""


def ai_mode(page):
    if os.environ.get("SKOT_REAL_AI") == "1":
        return "real"

    def handle(route):
        try:
            body = json.loads(route.request.post_data or "{}")
        except ValueError:
            body = {}
        if body.get("mode") == "next_options":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(NEXT_OPTIONS_FIXTURE))
        else:
            route.continue_()
    page.route("**/api/jev/decide", handle)
    return "mocked"


def read_options(page, wait_s=12.0):
    deadline = time.time() + wait_s
    got = None
    while time.time() < deadline:
        got = page.evaluate(READ_OPTIONS_JS)
        # Three options from the board; a fourth when the AI has named a node from it.
        if got and len(got["items"]) >= 3 and not got["deciding"]:
            break
        page.wait_for_timeout(150)
    return got["items"] if got else []


def ghosts(page):
    return page.evaluate(READ_GHOSTS_JS)


def shot(page, evidence, cid, step):
    """Screenshot for the judge: verify/out/<check>-<step>.png, and a copy in $SKOT_SHOTS_DIR when set."""
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "out")
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "%s-%s.png" % (cid, step))
    page.screenshot(path=path)
    extra = os.environ.get("SKOT_SHOTS_DIR")
    if extra:
        os.makedirs(extra, exist_ok=True)
        shutil.copy(path, os.path.join(extra, os.path.basename(path)))
    evidence.facts.setdefault("shots", []).append(os.path.basename(path))


def type_into_bar(page, text, delay=45):
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    page.keyboard.type(text, delay=delay)
    return bar


def tab_through(page, evidence, cid, board_ids):
    """Tab through all three options; for each, the ghost on the canvas must be that option, attached to the board."""
    seen = {}
    opts = read_options(page)
    if not any(o["active"] for o in opts):
        # 1A (22 Nov): suggestions for a click or a selection are not highlighted until Tab picks the first.
        assert ghosts(page) == {"shapes": [], "arrows": []}, "no ghost before a suggestion is picked: %s" % ghosts(page)
        page.keyboard.press("Tab")
        page.wait_for_timeout(200)
        opts = read_options(page, 3)
    for _ in range(3):
        active = next(i for i, o in enumerate(opts) if o["active"])
        page.wait_for_timeout(250)
        g = ghosts(page)
        seen[active] = {"option": opts[active], "ghosts": g}
        shot(page, evidence, cid, "option-%d-%s" % (active + 1, opts[active]["tier"]))
        page.keyboard.press("Tab")
        page.wait_for_timeout(200)
        opts = read_options(page, 3)
    return seen


def assert_three_tiers(opts):
    assert len(opts) == 3, "expected exactly 3 options, got %s" % opts
    assert [o["tier"] for o in opts] == TIERS, "options must go small, cluster, full: %s" % opts
    nodes = [o["nodes"] for o in opts]
    assert nodes[0] < nodes[1] < nodes[2], "options must grow in size: %s" % nodes
    assert all(o["title"] for o in opts)


def assert_ghost_matches(seen, board, existing_labels, typed=False):
    """The previewed ghost is the option itself: its node count, no copy of a board node, joined to the board.

    typed=True: the options are for Thought Bar text, so option 1 is the one node Enter adds, with no arrow
    (core loop, 22 Nov: connections are offered after the node exists, never drawn with it)."""
    board_ids = {e["id"] for e in board if is_shape(e)}
    for i, s in seen.items():
        g, o = s["ghosts"], s["option"]
        labels_ = [x["label"] for x in g["shapes"]]
        assert len(g["shapes"]) == o["nodes"], "option %d says +%s nodes but %d ghosts show: %s" % (
            i + 1, o["nodes"], len(g["shapes"]), labels_)
        if typed and i == 0:
            assert len(g["shapes"]) == 1 and not g["arrows"], "option 1 must be the one typed node, no arrows: %s" % g
            continue
        dup = [lab for lab in labels_ if lab.lower() in {x.lower() for x in existing_labels}]
        assert not dup, "option %d duplicates board nodes %s" % (i + 1, dup)
        if board_ids:
            assert any(a["from"] in board_ids or a["to"] in board_ids for a in g["arrows"]), \
                "option %d floats: no ghost arrow touches the board (%s)" % (i + 1, g["arrows"])


@check("next-options-typed")
def test_next_options_typed(page, skot, evidence):
    mode = ai_mode(page)
    skot.new_board()
    cd = skot.add("box", "Client Dashboard", skot.to_world(380, 260))
    skot.clear()
    type_into_bar(page, "apigateway")
    opts = read_options(page)
    shot(page, evidence, "next-options-typed", "typed")
    assert_three_tiers(opts)
    assert opts[0]["nodes"] == 1 and opts[0]["title"] == "API Gateway", "(a) must be one API Gateway node: %s" % opts[0]
    seen = tab_through(page, evidence, "next-options-typed", {cd["id"]})
    evidence.note(ai=mode, options=[{k: o[k] for k in ("title", "tier", "nodes", "pct", "text")} for o in opts],
                  ghosts={i + 1: s["ghosts"] for i, s in seen.items()})
    assert len(seen) == 3, "Tab must show all three options, saw %s" % sorted(seen)
    assert_ghost_matches(seen, skot.elements(), ["Client Dashboard"], typed=True)
    a, b = seen[0]["ghosts"], seen[1]["ghosts"]
    gw = next(x for x in a["shapes"] if x["label"] == "API Gateway")
    assert any(x["id"] == gw["id"] for x in b["shapes"]), "the API Gateway ghost must stay put when Tab moves to (b)"
    link = [x for x in b["arrows"] if x["from"] == cd["id"] and x["to"] == gw["id"]]
    assert link and link[0]["label"], "(b) must link Client Dashboard -> API Gateway with a label: %s" % b["arrows"]

    while not read_options(page, 3)[2]["active"]:
        page.keyboard.press("Tab")
        page.wait_for_timeout(150)
    n_full = read_options(page, 3)[2]["nodes"]
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len([e for e in es if is_shape(e)]) == 1 + n_full, timeout=10,
                          what="Enter to draw the full option")
    shot(page, evidence, "next-options-typed", "applied-full")
    assert [e["label"] for e in els if is_shape(e)].count("Client Dashboard") == 1
    assert any(e.get("fromId") == cd["id"] for e in els if e.get("kind") == "arrow"), "full option not attached"
    assert not overlapping_pairs(els), "full option overlaps: %s" % overlapping_pairs(els)
    assert_no_console_errors(evidence)


@check("next-options-app")
def test_next_options_app(page, skot, evidence):
    mode = ai_mode(page)
    skot.new_board()
    app = skot.add("box", "App", skot.to_world(380, 260))
    skot.clear()
    type_into_bar(page, "api gateway")
    opts = read_options(page)
    shot(page, evidence, "next-options-app", "typed")
    assert_three_tiers(opts)
    assert opts[0]["nodes"] == 1 and opts[0]["title"] == "API Gateway", "(a) must be one API Gateway node: %s" % opts[0]
    assert not any(o["pct"] for o in opts), "nothing is asked of the AI while typing (5A): %s" % opts
    seen = tab_through(page, evidence, "next-options-app", {app["id"]})
    evidence.note(ai=mode, options=[{k: o[k] for k in ("title", "tier", "nodes", "pct", "text")} for o in opts])
    assert_ghost_matches(seen, skot.elements(), ["App"], typed=True)
    assert any(x["from"] == app["id"] for x in seen[1]["ghosts"]["arrows"]), "(b) must hang off App: %s" % seen[1]["ghosts"]["arrows"]
    assert_no_console_errors(evidence)


@check("next-options-blank")
def test_next_options_blank(page, skot, evidence):
    mode = ai_mode(page)
    skot.new_board()
    type_into_bar(page, "url shortener")
    opts = read_options(page)
    shot(page, evidence, "next-options-blank", "typed")
    assert_three_tiers(opts)
    assert opts[0]["nodes"] == 1 and opts[0]["title"] == "URL Shortener", "(a) is the one typed node: %s" % opts[0]
    assert 2 <= opts[1]["nodes"] <= 5, "(b) should be a small start: %s" % opts[1]
    assert opts[2]["nodes"] >= 7, "(c) should be the full HLD: %s" % opts[2]
    seen = tab_through(page, evidence, "next-options-blank", set())
    evidence.note(ai=mode, options=[{k: o[k] for k in ("title", "tier", "nodes", "pct", "text")} for o in opts])
    assert len(seen) == 3
    assert_ghost_matches(seen, [], [], typed=True)
    while not read_options(page, 3)[1]["active"]:
        page.keyboard.press("Tab")
        page.wait_for_timeout(150)
    n = read_options(page, 3)[1]["nodes"]
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: len([e for e in es if is_shape(e)]) == n, what="Enter to draw the cluster")
    shot(page, evidence, "next-options-blank", "applied-cluster")
    assert len(skot.arrows()) >= n - 1, "the cluster should arrive connected"
    assert not overlapping_pairs(els)
    assert_no_console_errors(evidence)


@check("next-options-multi")
def test_next_options_multi(page, skot, evidence):
    mode = ai_mode(page)
    skot.new_board()
    x, y = skot.to_world(360, 220)
    co = skot.add("box", "Checkout", (x, y))
    inv = skot.add("box", "Inventory", (x, y + 260))
    skot.select("Checkout", "Inventory")
    page.get_by_text("Predictions for 2 selected nodes").wait_for(state="visible", timeout=10000)
    opts = read_options(page)
    assert_three_tiers(opts)
    a_title = opts[0]["title"]
    assert opts[0]["nodes"] == 0 and "Checkout" in a_title and "Inventory" in a_title, \
        "(a) should link Checkout and Inventory: %s" % opts[0]
    seen = tab_through(page, evidence, "next-options-multi", {co["id"], inv["id"]})
    evidence.note(ai=mode, options=[{k: o[k] for k in ("title", "tier", "nodes", "pct", "text")} for o in opts])
    link = seen[0]["ghosts"]["arrows"]
    assert len(link) == 1 and {link[0]["from"], link[0]["to"]} == {co["id"], inv["id"]} and link[0]["label"], link
    hub = next((s for s in seen[1]["ghosts"]["shapes"] if s["label"] == "Order Service"), None)
    assert hub, "(b) should add an Order Service: %s" % seen[1]["ghosts"]["shapes"]
    ends = {(a["from"], a["to"]) for a in seen[1]["ghosts"]["arrows"]}
    for node in (co, inv):
        assert (node["id"], hub["id"]) in ends or (hub["id"], node["id"]) in ends, "Order Service not wired to %s" % node["label"]
    assert_ghost_matches(seen, skot.elements(), ["Checkout", "Inventory"])
    while not read_options(page, 3)[1]["active"]:
        page.keyboard.press("Tab")
        page.wait_for_timeout(150)
    page.keyboard.press("Enter")
    skot.wait_state(lambda es: any(e.get("label") == "Order Service" for e in es), what="the Order Service")
    shot(page, evidence, "next-options-multi", "applied-cluster")
    assert_no_console_errors(evidence)


@check("next-options-node")
def test_next_options_node(page, skot, evidence):
    mode = ai_mode(page)
    skot.new_board()
    x, y = skot.to_world(260, 300)
    skot.add("box", "Client", (x, y))
    skot.add("box", "API", (x + 330, y))
    db = skot.add("database", "DB", (x + 660, y))
    skot.connect("Client", "API")
    skot.connect("API", "DB")
    skot.clear()
    skot.click_element("DB")
    page.get_by_text(re.compile(r'Next from "DB"')).wait_for(state="visible", timeout=10000)
    opts = read_options(page)
    shot(page, evidence, "next-options-node", "selected")
    assert_three_tiers(opts)
    assert opts[0]["nodes"] == 1
    seen = tab_through(page, evidence, "next-options-node", {db["id"]})
    evidence.note(ai=mode, options=[{k: o[k] for k in ("title", "tier", "nodes", "pct", "text")} for o in opts])
    named = " ".join(s["label"].lower() for v in seen.values() for s in v["ghosts"]["shapes"])
    hits = [w for w in ("replica", "cache", "backup") if w in named]
    assert len(hits) >= 2, "next steps should be named after the database (replica, cache, backups): %s" % named
    assert generic_count([o["title"] for o in opts]) == 0, "generic names in %s" % opts
    assert_ghost_matches(seen, skot.elements(), ["Client", "API", "DB"])
    a = seen[0]["ghosts"]
    assert any(x["from"] == db["id"] for x in a["arrows"]), "(a) should hang off DB: %s" % a["arrows"]
    assert_no_console_errors(evidence)


@check("type-tab-enter")
def test_type_tab_enter(page, skot, evidence):
    mode = ai_mode(page)
    skot.new_board()
    cd = skot.add("box", "Client Dashboard", skot.to_world(380, 260))
    skot.clear()
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    page.keyboard.type("a")
    t0 = time.time()
    page.keyboard.type("p")
    page.wait_for_function("s => document.querySelectorAll(s + ' button[aria-pressed]').length === 3",
                           arg=SUGGESTIONS, timeout=3000)
    appeared_s = round(time.time() - t0, 2)
    shot(page, evidence, "type-tab-enter", "1-typed-ap")
    assert appeared_s < 1.0, "options took %.2fs after the second keystroke; the lexicon answer must be instant" % appeared_s
    page.keyboard.type("i")
    page.wait_for_function("s => /^\\d?\\s*API\\b/.test(document.querySelector(s + ' button[aria-pressed]')?.innerText || '')",
                           arg=SUGGESTIONS, timeout=3000)
    opts = read_options(page)
    shot(page, evidence, "type-tab-enter", "2-ranked")
    assert len(opts) == 3 and opts[0]["title"] == "API", "option 1 is what Enter adds, the typed name: %s" % opts
    assert opts[1]["title"].startswith("API +") and opts[1]["nodes"] >= 2, "the bigger options build around the typed node: %s" % opts
    assert opts[0]["active"], "(a) should be highlighted: %s" % opts
    legend = page.locator(SUGGESTIONS + " [data-key-legend]").inner_text().replace("\n", " ")
    assert "add node" in legend and "complete to API Gateway" in legend, "the legend must say what Enter and Tab do: %r" % legend
    ghost = page.locator("[data-completion-ghost]")
    assert ghost.count() == 1 and ghost.inner_text() == " Gateway", "the bar should show what Tab completes, in grey"
    page.keyboard.press("Tab")
    page.wait_for_timeout(250)
    shot(page, evidence, "type-tab-enter", "3-tab")
    assert bar.input_value() == "API Gateway", "Tab should complete the word, bar is %r" % bar.input_value()
    assert read_options(page, 3)[0]["active"], "after completing, (a) stays highlighted"
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: any(e.get("label") == "API Gateway" for e in es), what="Enter to draw API Gateway")
    page.wait_for_timeout(300)
    shot(page, evidence, "type-tab-enter", "4-enter")
    gw = next(e for e in els if e.get("label") == "API Gateway")
    evidence.note(ai=mode, appeared_after_typing_s=appeared_s, shapes=labels(els))
    assert labels(els) == ["API Gateway", "Client Dashboard"], "exactly one new node: %s" % labels(els)
    assert not skot.arrows(), "the connection is offered, not drawn"
    assert bar.input_value() == "", "the bar should clear after drawing"
    first = read_options(page)[0]
    assert first["active"] and "Client Dashboard" in first["title"] and "API Gateway" in first["title"], first
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: any(e.get("kind") == "arrow" for e in es), what="the second Enter to connect")
    shot(page, evidence, "type-tab-enter", "5-enter-again")
    assert [(a["fromId"], a["toId"]) for a in skot.arrows()] == [(cd["id"], gw["id"])], "Client Dashboard -> API Gateway arrow missing"
    assert_no_console_errors(evidence)


@check("context-suggestions-single")
def test_context_suggestions_single(page, skot, evidence):
    skot.new_board("checkout")
    skot.clear()
    skot.click_element("Ledger DB")
    hint = page.get_by_text(re.compile(r'Next from "Ledger DB"'))
    hint.wait_for(state="visible", timeout=10000)
    titles = [s["title"] for s in skot.suggestion_titles()]
    evidence.note(selected="Ledger DB", suggestions=titles, generic=generic_count(titles))
    assert 1 <= len(titles) <= 3, "expected 1-3 suggestions for the selected node, got %s" % titles
    assert generic_count(titles) <= 1, "more than one generic suggestion: %s" % titles
    assert all(t.strip() for t in titles)
    assert_no_console_errors(evidence)


@check("context-suggestions-multi")
def test_context_suggestions_multi(page, skot, evidence):
    skot.new_board("checkout")
    skot.select("Checkout API", "Ledger DB")
    page.get_by_text("Predictions for 2 selected nodes").wait_for(state="visible", timeout=10000)
    titles = [s["title"] for s in skot.suggestion_titles()]
    evidence.note(selected=["Checkout API", "Ledger DB"], suggestions=titles)
    assert len(titles) >= 2, titles
    assert any("Checkout API" in t and "Ledger DB" in t for t in titles), \
        "one suggestion should link the two selected nodes by name: %s" % titles
    assert generic_count(titles) <= 1, "more than one generic suggestion: %s" % titles
    assert_no_console_errors(evidence)


@check("arrows-connect")
def test_arrows_connect(page, skot, evidence):
    skot.new_board()
    origin = skot.to_world(300, 300)
    cart = skot.add("box", "Cart", origin)
    pricing = skot.add("box", "Pricing", (origin[0] + 450, origin[1]))
    tax = skot.add("box", "Tax", (origin[0] + 450, origin[1] + 260))
    skot.connect("Cart", "Pricing")
    skot.clear()
    sx, sy = skot.to_screen(*center(cart))
    page.mouse.move(sx, sy)
    handle = page.locator('.jev-edge-handle[data-side="bottom"]').first
    handle.wait_for(state="visible", timeout=3000)
    hb = handle.bounding_box()
    tx, ty = skot.to_screen(*center(tax))
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
    page.mouse.down()
    page.mouse.move(tx, ty, steps=12)
    page.mouse.up()
    skot.wait_state(lambda es: any(e.get("fromId") == cart["id"] and e.get("toId") == tax["id"] for e in es),
                    what="an arrow from the edge handle drag")
    pairs = sorted((a["fromId"], a["toId"]) for a in skot.arrows())
    evidence.note(arrows=[[skot_label(skot, f), skot_label(skot, t)] for f, t in pairs])
    assert (cart["id"], pricing["id"]) in pairs and (cart["id"], tax["id"]) in pairs, pairs
    assert_no_console_errors(evidence)


def skot_label(skot, el_id):
    return next((e.get("label") for e in skot.elements() if e["id"] == el_id), None)


@check("pen-strokes")
def test_pen_strokes(page, skot, evidence):
    skot.new_board()
    x, y = skot.to_world(300, 260)
    skot.add("box", "Orders", (x, y))
    skot.add("database", "Orders DB", (x + 450, y))
    seen = {}

    skot.stroke([(x, y), (x + 150, y + 10), (x + 300, y - 5), (x + 450, y)])
    seen["connect"] = [s["title"] for s in skot.suggestion_titles()]
    assert seen["connect"] and seen["connect"][0] == "Connect Orders → Orders DB", seen["connect"]
    skot.press("Enter")
    skot.wait_state(lambda es: any(e.get("kind") == "arrow" for e in es), what="the stroke to become an arrow")
    assert not [e for e in skot.elements() if e.get("kind") == "freedraw"], "the accepted stroke should be removed"

    skot.stroke([(x, y + 250), (x + 180, y + 250), (x + 180, y + 330), (x, y + 330), (x, y + 252)])
    seen["shape"] = [s["title"] for s in skot.suggestion_titles()]
    assert seen["shape"] and all(t.startswith("Turn into a node: ") for t in seen["shape"]), seen["shape"]
    assert generic_count(seen["shape"]) == 0, "turn-into names must come from context: %s" % seen["shape"]
    n = len(skot.shapes())
    skot.press("Enter")
    skot.wait_state(lambda es: len([e for e in es if is_shape(e)]) == n + 1, what="the stroke to become a node")
    seen["shape_applied"] = seen["shape"][0].split(": ", 1)[1]
    assert seen["shape_applied"] in labels(skot.elements())

    cx, cy = x + 225, y + 36
    loop = [(cx + 420 * math.cos(a), cy + 150 * math.sin(a)) for a in [i * 2 * math.pi / 24 for i in range(25)]]
    skot.stroke(loop)
    seen["lasso"] = [s["title"] for s in skot.suggestion_titles()]
    assert seen["lasso"] and seen["lasso"][0].startswith("Group these"), seen["lasso"]
    skot.press("Enter")
    skot.wait_state(lambda es: any(e.get("kind") == "frame" for e in es), what="the lasso to become a group")
    evidence.note(**seen)
    assert not [e for e in skot.elements() if e.get("kind") == "freedraw"], "accepted strokes must not linger"
    assert_no_console_errors(evidence)


@check("fork-no-overlap")
def test_fork_no_overlap(page, skot, evidence, new_page, base_url):
    results = []
    for take in (1, 2, 3):
        panel = open_fork_takes(page, skot)
        tabs = panel.locator("[role=tab]")
        assert tabs.count() == 3, "Fork It should offer three takes"
        title = tabs.nth(take - 1).inner_text().split("\n")
        before = len(skot.elements())
        for _ in range(take - 1):
            skot.press("Tab")
        skot.press("Enter")
        els = skot.wait_state(lambda es: len(es) != before, timeout=15, what="take %d to swap in" % take)
        panel.wait_for(state="detached", timeout=10000)
        overlaps = overlapping_pairs(els)
        results.append({"take": take, "title": [t for t in title if t.strip()][:2], "nodes": len(labels(els)),
                        "overlaps": overlaps})
        assert not overlaps, "take %d left overlapping shapes: %s" % (take, overlaps)
    evidence.note(takes=results)
    # A second visitor (own client IP) so the decide calls of both halves stay under one visitor's rate limit.
    visitor = new_page("reuse")
    evidence.note(reuse=fork_reuses_existing_nodes(visitor, Driver(visitor, base_url), evidence))
    assert_no_console_errors(evidence)


COMPONENT_KINDS = {"node", "database", "cache", "queue", "lb", "blob", "external", "actor", "ellipse"}
CACHE_WORDS = re.compile(r"cache|redis|memcache", re.I)
DATABASE_WORDS = re.compile(r"\b(db|database|postgres(ql)?|mysql|sql)\b", re.I)
NOT_PRIMARY_DB = re.compile(r"replica|standby|follower|secondary|shard|analytics|warehouse", re.I)


def singleton_roles(els):
    """The board's caches and primary databases, by kind and label (the same reading as singletonRoleOf)."""
    roles = {"cache": [], "database": []}
    for e in els:
        if e.get("kind") not in COMPONENT_KINDS or e.get("morphMeta"):
            continue
        text = "%s %s" % (e.get("label") or "", e.get("sublabel") or "")
        if e["kind"] == "cache" or CACHE_WORDS.search(e.get("label") or ""):
            roles["cache"].append(e.get("label"))
        elif DATABASE_WORDS.search(e.get("label") or "") and not NOT_PRIMARY_DB.search(text):
            roles["database"].append(e.get("label"))
    return roles


def tab_title(tab):
    return tab.locator("span.truncate").first.inner_text().strip()


def fork_reuses_existing_nodes(page, skot, evidence):
    """SD Sensei, 21 Nov 2026: on a URL-shortener board that already had a Redis cache and a URL DB, Fork's
    Cache-First take added a second cache, a replica and a ghost Postgres, and its labels overlapped. Every
    take must reuse Redis and URL DB (no second cache or database) and leave no overlapping shapes."""
    skot.new_board()
    w = lambda sx, sy: skot.to_world(sx, sy)
    for shape, label, at in [("actor", "Client", (150, 360)), ("box", "Edge: CDN + LB", (400, 360)),
                             ("box", "API service", (680, 360)), ("box", "ID generator", (1000, 200)),
                             ("database", "URL DB", (1000, 360)), ("box", "Redis cache", (1000, 520)),
                             ("box", "Click queue", (680, 540))]:
        skot.add(shape, label, w(*at))
    for frm, to in [("Client", "Edge: CDN + LB"), ("Edge: CDN + LB", "API service"), ("API service", "ID generator"),
                    ("API service", "URL DB"), ("API service", "Redis cache"), ("API service", "Click queue")]:
        skot.connect(frm, to)
    board = skot.elements()
    ids = {e.get("label"): e["id"] for e in board if is_shape(e)}
    roles_before = singleton_roles(board)
    assert roles_before == {"cache": ["Redis cache"], "database": ["URL DB"]}, roles_before
    seen = []
    for take in (1, 2, 3):
        skot.select("API service")
        skot.press("Alt+f")
        step = page.locator(FORK_PRESSURE)
        step.wait_for(state="visible", timeout=20000)
        step.get_by_role("button", name="Skip: classic takes").click()
        page.mouse.move(8, 500)  # off the take cards, which select on hover
        panel = page.locator(FORK_PANEL)
        panel.wait_for(state="visible", timeout=20000)
        page.wait_for_function("s => !/Evaluating takes/.test(document.querySelector(s)?.textContent || '')",
                               arg=FORK_PANEL, timeout=20000)
        titles = [tab_title(t) for t in panel.locator("[role=tab]").all()]
        wanted = titles[take - 1] if not seen else next(t for t in titles if t not in [r["title"] for r in seen])
        for _ in range(3):
            if tab_title(panel.locator("[role=tab][aria-selected=true]")) == wanted:
                break
            skot.press("Tab")
        title = tab_title(panel.locator("[role=tab][aria-selected=true]"))
        assert title == wanted, "could not make %r the active take (active: %r)" % (wanted, title)
        skot.settle(600)
        shot(page, evidence, "fork-no-overlap", "reuse-take-%d-ghost" % take)
        skot.press("Enter")
        els = skot.wait_state(lambda es: not any(e["id"] == ids["API service"] for e in es), timeout=15,
                              what="take %d to swap in" % take)
        panel.wait_for(state="detached", timeout=10000)
        skot.settle(600)
        shot(page, evidence, "fork-no-overlap", "reuse-take-%d" % take)
        roles = singleton_roles(els)
        overlaps = overlapping_pairs(els)
        kept = {name: any(e["id"] == ids[name] for e in els) for name in ("Redis cache", "URL DB")}
        seen.append({"take": take, "title": title, "roles": roles, "overlaps": overlaps, "kept": kept})
        assert roles == roles_before, "take %d %r added a second cache/database: %s" % (take, title, roles)
        assert kept == {"Redis cache": True, "URL DB": True}, "take %d replaced the existing nodes: %s" % (take, kept)
        assert not overlaps, "take %d %r left overlapping shapes: %s" % (take, title, overlaps)
        skot.press("Control+z")
        skot.wait_state(lambda es: any(e["id"] == ids["API service"] for e in es), timeout=10,
                        what="undo to restore the board after take %d" % take)
    assert len({r["title"] for r in seen}) == 3, "all three takes should be applied once: %s" % seen
    return seen


COST_AXES = ["latency", "money", "consistency", "complexity", "ops"]


def take_costs(panel):
    return panel.locator("[role=tab]").evaluate_all("""tabs => tabs.map(t => ({
        title: t.querySelector('span.truncate')?.textContent || '',
        text: t.textContent,
        costs: [...t.querySelectorAll('ul[aria-label="What it costs"] li')].map(li => li.getAttribute('aria-label')),
    }))""")


@check("fork-pressure")
def test_fork_pressure(page, skot, evidence):
    # 1. Latency chip: three takes, each with a buy line, one cost line per axis and a failure mode.
    panel = open_fork_takes(page, skot, "Latency")
    takes = take_costs(panel)
    status = panel.locator("span:has(svg)").filter(has_text=re.compile("AI ·|Pattern catalogue")).first.inner_text()
    evidence.note(latency_takes=takes, ran=status)
    assert len(takes) == 3, "Fork should offer three takes for Latency, got %d" % len(takes)
    for t in takes:
        assert "Buys" in t["text"], "take %r has no buy line" % t["title"]
        assert "New failure:" in t["text"], "take %r has no failure mode" % t["title"]
        axes = [c.split(" cost ")[0] for c in t["costs"]]
        assert axes == COST_AXES, "take %r cost lines: %s" % (t["title"], t["costs"])
    assert panel.get_by_role("button", name=re.compile("For Latency")).count() == 1, "the stated pressure is not shown"

    # 2. Accept the active take: the board changes and the HUD closes.
    before = skot.elements()
    skot.press("Enter")
    after = skot.wait_state(lambda es: len(es) != len(before), timeout=15, what="the latency take to swap in")
    panel.wait_for(state="detached", timeout=10000)
    assert not overlapping_pairs(after), "the accepted take left overlapping shapes"
    if "Pattern catalogue" in status:
        assert any(e.get("kind") == "cache" for e in after), "cache-aside should draw a cache: %s" % labels(after)

    # 3. A typed target is parsed and the buy lines answer it.
    skot.new_board("fork")
    step = page.locator(FORK_PRESSURE)
    step.wait_for(state="visible", timeout=20000)
    step.get_by_role("textbox", name="Target").fill("p99 < 100 ms")
    reading = step.locator("#fork-pressure-reading").inner_text()
    assert "Latency · p99 < 100 ms" in reading, "the target was read as %r" % reading
    step.get_by_role("textbox", name="Target").press("Enter")
    panel = page.locator(FORK_PANEL)
    panel.wait_for(state="visible", timeout=20000)
    page.wait_for_function("s => !/Evaluating takes/.test(document.querySelector(s)?.textContent || '')",
                           arg=FORK_PANEL, timeout=20000)
    typed = take_costs(panel)
    evidence.note(typed_takes=[t["text"][:240] for t in typed])
    if "Pattern catalogue" in panel.inner_text():
        assert all("100 ms" in t["text"] for t in typed), "buy lines should answer p99 < 100 ms"

    # 4. Undo restores the board in one step after an accepted take.
    skot.press("Enter")
    skot.wait_state(lambda es: not any(e.get("id") == "arch_orders_api" for e in es), timeout=15,
                    what="the typed-target take to swap in")
    skot.press("Control+z")
    skot.wait_state(lambda es: any(e.get("id") == "arch_orders_api" for e in es), timeout=10,
                    what="undo to restore the forked nodes")
    assert_no_console_errors(evidence)


NOTATION_GLYPHS = ("activation", "fragment", "initial", "final")


def node_labels(els):
    """Labels of the user's nodes: notation glyphs a morph adds (activation bars, fragments) are left out."""
    return labels([e for e in els if e.get("kind") not in NOTATION_GLYPHS])


def morph_selection(page, skot, notation, tab):
    skot.clear()
    page.keyboard.press("Control+a")
    bar = page.locator(MULTI_BAR).first
    bar.wait_for(state="visible", timeout=5000)
    bar.locator('[role=tablist][aria-label="Notation morph switcher"]').get_by_role("tab", name=tab, exact=True).click()
    if notation == "sketch":
        els = skot.wait_state(lambda es: not any((e.get("morphMeta") or {}).get("notation") not in (None, "sketch")
                                                 for e in es), timeout=20, what="the morph back to sketch")
    else:
        skot.wait_state(lambda es: any((e.get("morphMeta") or {}).get("notation") == notation for e in es),
                        timeout=20, what="the %s morph" % notation)
        page.locator('[aria-label="Refining semantic notation"]').wait_for(state="detached", timeout=20000)
        els = skot.elements()
    skot.settle(400)
    return els


URL_SHORTENER_HLD = os.path.join(REPO, "src", "lib", "jev", "__fixtures__", "url-shortener-hld.json")
WRITE_PATH = ["Client", "Edge: CDN + LB", "API service", "ID generator", "URL DB"]
MESSAGE_NUMBER = re.compile(r"^\d+\.\s*")


def import_link(elements):
    """The app's #import= payload (src/lib/jev/board-import.ts): base64url(gzip(JSON)), no padding."""
    raw = json.dumps({"elements": elements}, separators=(",", ":")).encode()
    return "#import=" + base64.urlsafe_b64encode(gzip.compress(raw, mtime=0)).rstrip(b"=").decode()


def morph_subflow(page, skot, picked, notation, tab):
    skot.select(*picked)
    bar = page.locator(MULTI_BAR).first
    bar.wait_for(state="visible", timeout=5000)
    bar.locator('[role=tablist][aria-label="Notation morph switcher"]').get_by_role("tab", name=tab, exact=True).click()
    skot.wait_state(lambda es: any((e.get("morphMeta") or {}).get("notation") == notation for e in es),
                    timeout=20, what="the %s morph" % notation)
    page.locator('[aria-label="Refining semantic notation"]').wait_for(state="detached", timeout=20000)
    skot.settle(400)
    return skot.elements()


def assert_subflow_sequence(page, skot, evidence, base_url):
    """SD Sensei, 21 Nov: morphing the write path of a URL-shortener HLD pulled the read-path arrows R1/R4 onto
    the URL DB lifeline and invented an "ack / result" return. Only arrows with both ends selected may become
    messages, and an arrow reaching an unselected node stays on its own participant."""
    with open(URL_SHORTENER_HLD, encoding="utf-8") as f:
        board = json.load(f)
    page.goto(base_url + "/" + import_link(board), wait_until="load")
    page.wait_for_function("() => /#room=/.test(location.hash)", timeout=30000)
    before = skot.wait_state(lambda els: len(els) == len(board), what="the URL-shortener HLD")
    skot.settle(600)
    label_of = {e["id"]: e.get("label") for e in before}
    picked = {skot.by_label(lab)["id"] for lab in WRITE_PATH}
    arrows = [a for a in before if a.get("kind") == "arrow"]
    own = sorted(a["label"] for a in arrows if a.get("fromId") in picked and a.get("toId") in picked)
    crossing_before = sorted(
        (label_of[a["fromId"] if a["fromId"] in picked else a["toId"]],
         a["toId"] if a["fromId"] in picked else a["fromId"], a["label"])
        for a in arrows if (a.get("fromId") in picked) != (a.get("toId") in picked))

    after = morph_subflow(page, skot, WRITE_PATH, "sequence", "Sequence")
    role = lambda e: (e.get("morphMeta") or {}).get("role")
    messages = sorted(MESSAGE_NUMBER.sub("", m["label"]) for m in after if role(m) == "message")
    participants = {e["id"]: e["label"] for e in after if role(e) == "actor"}
    crossing_after = sorted(
        (participants[a["fromId"]] if a.get("fromId") in participants else participants[a["toId"]],
         a["toId"] if a.get("fromId") in participants else a["fromId"], a["label"])
        for a in after
        if a.get("kind") == "arrow" and not a.get("morphMeta")
        and (a.get("fromId") in participants or a.get("toId") in participants))
    evidence.note(subflow_messages=messages, subflow_arrows=own, crossing_before=crossing_before,
                  crossing_after=crossing_after)
    assert messages == own, \
        "every message must be one of the selected flow's own arrows (no invented returns): %s vs arrows %s" % (
            messages, own)
    assert crossing_after == crossing_before, \
        "an arrow to an unselected node moved to another lifeline: before %s, after %s" % (
            crossing_before, crossing_after)


@check("notation-morph")
def test_notation_morph(page, skot, evidence, base_url):
    assert_subflow_sequence(page, skot, evidence, base_url)
    skot.new_board("checkout")
    original = labels(skot.elements())
    without_zones = labels([e for e in skot.elements() if e.get("kind") != "frame"])

    seq = morph_selection(page, skot, "sequence", "Sequence")
    bars = [e for e in seq if e.get("kind") == "activation"]
    drawn_bars = [skot.rendered(b["id"]) for b in bars]
    back = morph_selection(page, skot, "sketch", "Sketch")
    assert node_labels(seq) == without_zones, \
        "sequence morph lost nodes (zones aside): %s -> %s" % (without_zones, node_labels(seq))
    assert bars, "the sequence morph drew no activation bars: %s" % sorted({e.get("kind") for e in seq})
    assert all(r and r["kind"] == "activation" and r["paths"] for r in drawn_bars), \
        "activation bars are stored but not drawn: %s" % drawn_bars
    assert labels(back) == original, "morphing back lost nodes: %s -> %s" % (original, labels(back))
    assert not [e for e in back if e.get("kind") == "activation"], "activation bars outlived the morph back"

    er = morph_selection(page, skot, "er", "ER")
    entities = [e for e in er if e.get("kind") == "entity"]
    rows = {e["label"]: (e.get("sublabel") or "").split("\n") for e in entities}
    relations = [a for a in er if a.get("kind") == "arrow"]
    ends = [(a.get("startEnd"), a.get("endEnd")) for a in relations]
    drawn = {a["id"]: skot.rendered(a["id"]) for a in relations}
    markers = {i: sorted({p["end"] for p in r["paths"] if p["end"]}) for i, r in drawn.items() if r}
    entity_text = {e["label"]: [t["text"] for t in (skot.rendered(e["id"]) or {"texts": []})["texts"]]
                   for e in entities}
    back_er = morph_selection(page, skot, "sketch", "Sketch")
    evidence.note(original=original, sequence=node_labels(seq), activation_bars=len(bars), back=labels(back),
                  er_rows=rows, er_ends=ends, er_markers=markers, back_from_er=labels(back_er))
    assert entities, "the ER morph made no entities: %s" % sorted({e.get("kind") for e in er})
    assert all(any(r.endswith(" PK") or " PK " in r for r in rs) for rs in rows.values()), \
        "every entity needs a PK row: %s" % rows
    assert any(" FK" in r for rs in rows.values() for r in rs), "no FK row on any entity: %s" % rows
    assert any(any(t == "PK" for t in ts) for ts in entity_text.values()), \
        "PK badges are not drawn: %s" % entity_text
    assert relations and all((s or "").startswith("er_") and (t or "").startswith("er_") for s, t in ends), \
        "every relation needs crow's-foot ends on both sides: %s" % ends
    assert all(markers.get(a["id"]) == ["end", "start"] for a in relations), \
        "crow's-foot markers are not drawn on both ends: %s" % markers
    assert labels(back_er) == original, "morphing back from ER lost nodes: %s -> %s" % (original, labels(back_er))
    assert_no_console_errors(evidence)


def morph_roles(els, notation):
    return [(e.get("morphMeta") or {}).get("role") for e in els
            if (e.get("morphMeta") or {}).get("notation") == notation]


@check("command-palette")
def test_command_palette(page, skot, evidence):
    skot.new_board()
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    bar.fill("/")
    options = page.get_by_role("listbox", name="Commands").get_by_role("option")
    options.first.wait_for(state="visible", timeout=5000)
    listed = [t.split()[0] for t in options.all_inner_texts()]
    assert listed == ["/er", "/seq", "/state", "/class", "/api", "/estimate", "/break", "/trace", "/schema", "/failure",
                      "/transitions", "/consistency"], listed
    assert options.nth(0).get_attribute("aria-selected") == "true", "the first command should be selected"
    page.keyboard.press("ArrowDown")
    assert options.nth(1).get_attribute("aria-selected") == "true", "ArrowDown should select /seq"
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: morph_roles(es, "sequence").count("lifeline") == 3, timeout=10,
                          what="a sequence starter with three lifelines")
    seq = morph_roles(els, "sequence")
    returns = [e for e in els if (e.get("morphMeta") or {}).get("role") == "message" and e.get("dashed")]
    assert seq.count("activation") >= 2, "the sequence starter has no activation bars: %s" % seq
    assert returns and all(r.get("endEnd") == "open" for r in returns), "returns should be dashed open arrows"
    assert bar.input_value() == "", "the Thought Bar should clear after a command"

    bar.click()
    bar.fill("/er")
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: sum(1 for e in es if e.get("kind") == "entity") == 2, timeout=10,
                          what="two ER entities from /er")
    entities = [e for e in els if e.get("kind") == "entity"]
    rel = [e for e in els if e.get("kind") == "arrow" and (e.get("morphMeta") or {}).get("notation") == "er"]
    assert all(" PK" in (e.get("sublabel") or "") for e in entities), [e.get("sublabel") for e in entities]
    assert any(" FK" in (e.get("sublabel") or "") for e in entities), "no FK row in the ER starter"
    assert rel and rel[0].get("startEnd") == "er_only_one" and rel[0].get("endEnd") == "er_zero_many", rel

    bar.click()
    bar.fill("/estimate 50M DAU, 5 writes/user/day, 2KB, 3y")
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: any(e.get("kind") == "card" for e in es), timeout=10,
                          what="a numbers card from /estimate")
    card = next(e for e in els if e.get("kind") == "card")
    assert card["label"] == "Numbers · 50M DAU", card["label"]
    assert "50M DAU × 5 / 86 400 s ≈ 2.89K QPS" in card["sublabel"], card["sublabel"]
    overlaps = overlapping_pairs([e for e in els if e.get("kind") != "activation"])
    evidence.note(listed=listed, kinds=sorted({e["kind"] for e in els}), card=card["sublabel"].split("\n"),
                  overlaps=overlaps)
    assert not overlaps, "inserts landed on top of each other: %s" % overlaps
    skot.clear()
    page.keyboard.press("Shift+1")
    assert_no_console_errors(evidence)


def run_command(page, text):
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    bar.fill(text)
    page.keyboard.press("Enter")
    assert bar.input_value() == "", "the Thought Bar should clear after %s" % text


def three_node_board(skot):
    o = skot.to_world(320, 340)
    skot.add("actor", "User", o)
    skot.add("box", "API", (o[0] + 300, o[1]))
    skot.add("database", "Orders DB", (o[0] + 600, o[1]))
    skot.connect("User", "API")
    skot.connect("API", "Orders DB")


def move_notice(page):
    n = page.get_by_test_id("move-notice")
    n.wait_for(state="visible", timeout=5000)
    return n.inner_text()


@check("moves-break")
def test_moves_break(page, skot, evidence):
    skot.new_board()
    three_node_board(skot)
    before = {e["id"] for e in skot.elements()}
    skot.clear()
    page.get_by_role("button", name="Moves", exact=True).click()
    page.get_by_role("menuitem").filter(has_text="Where does this break at 10×?").click()
    els = skot.wait_state(lambda es: any(e.get("kind") == "card" for e in es), timeout=8, what="a Breaks at 10× card")
    card = next(e for e in els if e.get("kind") == "card")
    db = skot.by_label("Orders DB")
    pointer = [e for e in els if e["id"] not in before and e.get("kind") == "arrow"]
    notice = move_notice(page)
    evidence.note(card=card["label"], lines=card["sublabel"].split("\n"), notice=notice,
                  gap=card["x"] - (db["x"] + db["width"]))
    assert card["label"] == "Breaks at 10×", card["label"]
    assert "Orders DB" in card["sublabel"].split("\n")[0], card["sublabel"]
    assert any(l.startswith("Fix: ") for l in card["sublabel"].split("\n")), "no fixes on the card"
    assert card["sublabel"].split("\n")[-1].startswith("Source: "), "the card does not say where its words came from"
    assert 0 <= card["x"] - (db["x"] + db["width"]) <= 200, "the card is not next to the database"
    assert card["y"] < db["y"] + db["height"] and card["y"] + card["height"] > db["y"], "the card is not beside the DB"
    assert len(pointer) == 1 and pointer[0].get("fromId") == card["id"] and pointer[0].get("toId") == db["id"], pointer
    assert re.search(r"Rule-based|AI", notice), notice
    assert page.get_by_test_id("move-highlight").count() == 1, "the culprit is not highlighted"
    assert not overlapping_pairs([e for e in els if is_shape(e)]), "the card landed on another shape"
    skot.press("Control+z")
    after = skot.wait_state(lambda es: {e["id"] for e in es} == before, timeout=5, what="one undo to remove the move")
    assert {e["id"] for e in after} == before
    assert page.get_by_test_id("move-highlight").count() == 0, "undo removed the card but its highlight stayed"
    assert_no_console_errors(evidence)


@check("moves-trace")
def test_moves_trace(page, skot, evidence):
    skot.new_board()
    three_node_board(skot)
    before = sorted(e["id"] for e in skot.elements())
    skot.clear()
    run_command(page, "/trace write")
    legend = page.get_by_test_id("trace-legend")
    legend.wait_for(state="visible", timeout=5000)
    pulse = page.get_by_test_id("trace-pulse")
    pulse.wait_for(state="attached", timeout=3000)
    a = (pulse.get_attribute("data-x"), pulse.get_attribute("data-y"))
    page.wait_for_timeout(400)
    b = (pulse.get_attribute("data-x"), pulse.get_attribute("data-y"))
    page.wait_for_function("() => document.querySelectorAll('[data-trace-step]').length >= 2", timeout=4000)
    steps = page.locator("[data-trace-step]").count()
    write_pressed = legend.get_by_role("button", name="Write path").get_attribute("aria-pressed")
    evidence.note(pulse=[a, b], steps=steps, legend=legend.inner_text())
    assert a != b, "the pulse did not move along the path"
    assert steps == 2, "a 3-node path has 2 numbered steps, saw %d" % steps
    assert write_pressed == "true", "the legend should show the write path"
    legend.get_by_role("button", name="Read path").click()
    assert legend.get_by_role("button", name="Read path").get_attribute("aria-pressed") == "true"
    assert sorted(e["id"] for e in skot.elements()) == before, "the trace must be overlay only, never board elements"
    skot.press("Escape")
    page.get_by_test_id("move-overlay").wait_for(state="detached", timeout=3000)
    assert page.get_by_test_id("trace-legend").count() == 0, "Esc should stop the trace"
    assert_no_console_errors(evidence)


@check("moves-schema")
def test_moves_schema(page, skot, evidence):
    skot.new_board()
    run_command(page, "/api")
    skot.wait_state(lambda es: any(e.get("kind") == "api" for e in es), timeout=8, what="an API card")
    skot.clear()
    api = skot.click_element("POST /orders")
    run_command(page, "/schema")
    els = skot.wait_state(lambda es: sum(1 for e in es if e.get("kind") == "entity") >= 2, timeout=8,
                          what="entities from /schema")
    entities = {e["label"]: e for e in els if e.get("kind") == "entity"}
    rel = [e for e in els if e.get("kind") == "arrow" and e.get("endEnd") == "er_zero_many"]
    evidence.note(entities={k: v["sublabel"].split("\n") for k, v in entities.items()}, notice=move_notice(page))
    assert set(entities) == {"orders", "items"}, list(entities)
    assert entities["orders"]["sublabel"].split("\n")[0] == "id uuid PK", entities["orders"]["sublabel"]
    assert "item_id uuid FK" in entities["orders"]["sublabel"], entities["orders"]["sublabel"]
    assert "idempotency_key text UK" in entities["orders"]["sublabel"]
    assert all(e["x"] >= api["x"] + api["width"] for e in entities.values()), "entities should sit right of the API card"
    assert rel and rel[0].get("startEnd") == "er_only_one", "no crow's-foot relation between the entities"
    assert not overlapping_pairs([e for e in els if is_shape(e)]), "entities landed on other shapes"
    assert_no_console_errors(evidence)


@check("moves-consistency")
def test_moves_consistency(page, skot, evidence):
    skot.new_board()
    run_command(page, "/api")
    skot.wait_state(lambda es: any(e.get("kind") == "api" for e in es), timeout=8, what="an API card")
    skot.clear()
    run_command(page, "/er")
    skot.wait_state(lambda es: sum(1 for e in es if e.get("kind") == "entity") == 2, timeout=8, what="the ER starter")
    skot.clear()
    run_command(page, "/consistency")
    els = skot.wait_state(lambda es: any(e.get("label") == "Consistency check" for e in es), timeout=8,
                          what="a consistency card")
    card = next(e for e in els if e.get("label") == "Consistency check")
    api = next(e for e in els if e.get("kind") == "api")
    pinned = [h.get_attribute("data-element-id") for h in page.get_by_test_id("move-highlight").all()]
    evidence.note(lines=card["sublabel"].split("\n"), pinned=pinned, notice=move_notice(page))
    assert any("POST /orders takes item_id, not stored in orders" in l for l in card["sublabel"].split("\n")), card
    assert api["id"] in pinned, "the API card is not pinned"
    assert not overlapping_pairs([e for e in els if is_shape(e) and e.get("kind") != "activation"]), "card overlaps"
    assert_no_console_errors(evidence)


def chip(page, title):
    return page.locator('[role=group][aria-label="Pack suggestion"]').filter(has_text=title)


@check("pack-chips")
def test_pack_chips(page, skot, evidence):
    skot.new_board()
    o = skot.to_world(300, 300)
    db = skot.add("database", "users table", o)
    skot.clear()
    er = chip(page, "ER pack: turn into entity with PK/FK")
    er.wait_for(state="visible", timeout=5000)
    er.get_by_role("button", name="ER pack: turn into entity with PK/FK", exact=True).click()
    els = skot.wait_state(lambda es: any(e["id"] == db["id"] and e["kind"] == "entity" for e in es),
                          what="the users table to become an entity")
    ent = next(e for e in els if e["id"] == db["id"])
    assert ent["label"] == "users" and ent["sublabel"].startswith("id uuid PK"), ent
    assert page.get_by_role("complementary", name="Notation packs").is_visible(), "the ER pack should open"
    assert page.get_by_role("tab", name="ER", exact=True).get_attribute("aria-selected") == "true"
    assert er.count() == 0, "the chip should go once used"
    page.get_by_role("button", name="Close packs").click()

    skot.select("users")
    page.get_by_role("button", name="Edit rows").click()
    rows = page.get_by_role("textbox", name="Edit entity rows")
    rows.wait_for(state="visible", timeout=3000)
    assert rows.input_value().startswith("id uuid PK"), rows.input_value()
    page.keyboard.press("Escape")

    skot.add("database", "orders table", (o[0] + 420, o[1]))
    skot.clear()
    chip(page, "ER pack").get_by_role("button", name="Dismiss ER pack: turn into entity with PK/FK").click()
    arrow = skot.connect("users", "orders table")
    skot.clear()
    sx, sy = skot.to_screen(*_arrow_mid(skot, arrow))
    page.mouse.click(sx, sy)
    page.wait_for_timeout(200)
    page.keyboard.press("Enter")
    skot.type_into_editor("1:N")
    skot.wait_state(lambda es: any(e["id"] == arrow["id"] and e.get("label") == "1:N" for e in es),
                    what="the arrow label 1:N")
    skot.clear()
    cf = chip(page, "Crow's foot")
    cf.wait_for(state="visible", timeout=5000)
    assert chip(page, "ER pack").count() == 0, "a dismissed chip came back"
    cf.get_by_role("button", name="Crow's foot", exact=True).click()
    els = skot.wait_state(lambda es: any(e["id"] == arrow["id"] and e.get("endEnd") == "er_zero_many" for e in es),
                          what="crow's-foot ends on the 1:N arrow")
    rel = next(e for e in els if e["id"] == arrow["id"])
    assert rel.get("startEnd") == "er_only_one" and rel.get("label") == "", rel
    page.mouse.click(sx, sy)
    ends = page.get_by_role("group", name="Arrow ends")
    ends.wait_for(state="visible", timeout=3000)
    assert ends.get_by_role("button", name="Start end: Only one").count() == 1
    assert ends.get_by_role("button", name="End end: Zero or many").count() == 1
    evidence.note(entity=ent, relation={k: rel.get(k) for k in ("label", "startEnd", "endEnd")})
    assert_no_console_errors(evidence)


def _arrow_mid(skot, arrow):
    by_id = {e["id"]: e for e in skot.elements()}
    a, b = center(by_id[arrow["fromId"]]), center(by_id[arrow["toId"]])
    return (a[0] + b[0]) / 2, (a[1] + b[1]) / 2


@check("packs-panel")
def test_packs_panel(page, skot, evidence, new_page, base_url):
    skot.new_board()
    panel = page.get_by_role("complementary", name="Notation packs")
    assert panel.count() == 0, "the packs panel should be closed by default"
    page.get_by_role("button", name="More shapes").click()
    page.get_by_role("button", name=re.compile("Browse packs")).click()
    panel.wait_for(state="visible", timeout=3000)
    tabs = panel.get_by_role("tab").all_inner_texts()
    assert tabs == ["HLD", "ER", "Sequence", "State", "Class", "API"], tabs
    panel.get_by_role("tab", name="API", exact=True).click()
    panel.get_by_role("button", name="Add API card").click()
    els = skot.wait_state(lambda es: any(e["kind"] == "api" for e in es), what="an API card from the panel")
    panel.get_by_role("tab", name="Class", exact=True).click()
    panel.get_by_role("button", name=re.compile("Insert a class starter")).click()
    els = skot.wait_state(lambda es: sum(1 for e in es if e["kind"] == "class") == 2, what="the class starter")
    inherits = [e for e in els if e["kind"] == "arrow" and e.get("endEnd") == "triangle"]
    assert len(inherits) == 1, "the class starter needs one inheritance arrow"
    panel.get_by_role("tab", name="ER", exact=True).click()
    item = panel.get_by_role("button", name="Add ER entity")
    box = item.bounding_box()
    target = skot.to_screen(*skot.to_world(380, 520))
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(target[0] - 40, target[1] - 20, steps=6)
    page.mouse.move(*target, steps=6)
    page.mouse.up()
    els = skot.wait_state(lambda es: any(e["kind"] == "entity" for e in es), what="an entity dragged onto the canvas")
    ent = next(e for e in els if e["kind"] == "entity")
    wx, wy = skot.to_world(*target)
    assert abs(center(ent)[0] - wx) < 20 and abs(center(ent)[1] - wy) < 20, "drop landed at %s, not %s" % (
        center(ent), (wx, wy))
    panel.get_by_role("button", name="Close packs").click()
    assert panel.count() == 0
    page.get_by_role("button", name="Board menu").click()
    page.get_by_role("menuitem", name="Notation Packs").click()
    panel.wait_for(state="visible", timeout=3000)

    phone = new_page("phone")
    phone.set_viewport_size({"width": 390, "height": 844})
    phone.goto(base_url + "/", wait_until="load", timeout=60000)
    phone.wait_for_selector("[role=application] svg", timeout=30000)
    phone.get_by_role("button", name="Board menu").click()
    phone.get_by_role("menuitem", name="Notation Packs").click()
    pp = phone.get_by_role("complementary", name="Notation packs")
    pp.wait_for(state="visible", timeout=3000)
    pbox = pp.bounding_box()
    scroll_w = phone.evaluate("document.documentElement.scrollWidth")
    evidence.note(tabs=tabs, phone_panel=pbox, scroll_width=scroll_w)
    assert pbox["x"] >= 0 and pbox["x"] + pbox["width"] <= 390, "panel overflows a 390px phone: %s" % pbox
    assert scroll_w <= 390, "the page scrolls sideways on a phone (%dpx)" % scroll_w
    assert pp.get_by_role("button", name=re.compile("Insert ")).is_visible(), "starter button hidden on a phone"
    assert_no_console_errors(evidence)


HLINE = re.compile(r"^M 0 ([\d.]+) L ([\d.]+) \1$")


def outline_drawn(r):
    return bool(r and any(p["d"] and p["stroke"] not in (None, "none") for p in r["paths"]))


def text_y(r, text):
    ys = [t["y"] for t in r["texts"] if t["text"] == text]
    assert ys, "%r is not drawn; drawn text: %s" % (text, [t["text"] for t in r["texts"]])
    return ys[0]


@check("more-shapes")
def test_more_shapes(page, skot, evidence):
    skot.new_board()
    o = skot.to_world(380, 300)
    queue = skot.add_more("Queue / stream", "Orders stream", o)
    entity = skot.add_more("ER entity", "orders", (o[0] + 460, o[1]))
    stored = {e["label"]: e["kind"] for e in skot.shapes()}
    drawn = {e["label"]: skot.rendered(e["id"]) for e in (queue, entity)}
    evidence.note(stored=stored, drawn_kinds={k: (v or {}).get("kind") for k, v in drawn.items()},
                  entity_text=[t["text"] for t in drawn["orders"]["texts"]] if drawn["orders"] else None)
    assert stored == {"Orders stream": "queue", "orders": "entity"}, stored
    for label, r in drawn.items():
        assert outline_drawn(r), "%r is stored but no outline is drawn: %s" % (label, r)
    assert drawn["Orders stream"]["kind"] == "queue" and drawn["orders"]["kind"] == "entity"
    assert "orders" in [t["text"] for t in drawn["orders"]["texts"]], "the entity name is not drawn"
    assert "PK" in [t["text"] for t in drawn["orders"]["texts"]], "the default PK row badge is not drawn"
    assert_no_console_errors(evidence)


@check("arrow-end-picker")
def test_arrow_end_picker(page, skot, evidence):
    skot.new_board()
    o = skot.to_world(330, 320)
    users = skot.add_more("ER entity", "users", o)
    orders = skot.add_more("ER entity", "orders", (o[0] + 520, o[1]))
    arrow = skot.connect("users", "orders")
    skot.clear()
    (ux, uy), (ox, oy) = center(users), center(orders)
    skot.click_world((ux + ox) / 2, (uy + oy) / 2)
    toolbar = page.get_by_role("toolbar", name="Selected element controls")
    ends = toolbar.get_by_role("group", name="Arrow ends")
    ends.wait_for(state="visible", timeout=5000)
    ends.get_by_role("button", name=re.compile(r"^Start end:")).click()
    page.get_by_role("button", name="Only one", exact=True).click()
    page.get_by_role("button", name="Only one", exact=True).wait_for(state="detached", timeout=3000)
    ends.get_by_role("button", name=re.compile(r"^End end:")).click()
    page.get_by_role("button", name="Zero or many", exact=True).click()
    stored = skot.wait_state(lambda es: any(e["id"] == arrow["id"] and e.get("endEnd") == "er_zero_many"
                                            for e in es), what="the end marker to be stored")
    a = next(e for e in stored if e["id"] == arrow["id"])
    r = skot.rendered(arrow["id"])
    by_end = {side: [p["d"] for p in r["paths"] if p["end"] == side] for side in ("start", "end")}
    evidence.note(startEnd=a.get("startEnd"), endEnd=a.get("endEnd"),
                  marker_paths={k: len(v) for k, v in by_end.items()},
                  start_label=ends.get_by_role("button", name=re.compile(r"^Start end:")).get_attribute("aria-label"))
    assert (a.get("startEnd"), a.get("endEnd")) == ("er_only_one", "er_zero_many"), (a.get("startEnd"), a.get("endEnd"))
    assert len(by_end["start"]) >= 2, "'only one' needs two bars at the start, drew %s" % by_end["start"]
    assert len(by_end["end"]) >= 2, "'zero or many' needs a ring and a crow's foot, drew %s" % by_end["end"]
    assert ends.get_by_role("button", name="End end: Zero or many").count() == 1, "the picker does not show the choice"
    assert_no_console_errors(evidence)


@check("multiline-rows")
def test_multiline_rows(page, skot, evidence):
    skot.new_board()
    entity = skot.add_more("ER entity", "orders", skot.to_world(380, 300))
    before = (entity.get("sublabel") or "").split("\n")
    page.get_by_role("toolbar", name="Selected element controls").get_by_role("button", name="Edit rows").click()
    editor = page.get_by_role("textbox", name="Edit entity rows")
    editor.wait_for(state="visible", timeout=3000)
    editor.press("Control+End")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("user_id uuid FK", delay=8)
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: any(e["id"] == entity["id"] and "user_id uuid FK" in (e.get("sublabel") or "")
                                         for e in es), what="the new row to be stored")
    rows = next(e for e in els if e["id"] == entity["id"])["sublabel"].split("\n")
    texts = [t["text"] for t in skot.rendered(entity["id"])["texts"]]
    evidence.note(rows_before=before, rows_after=rows, drawn_text=texts)
    assert rows == before + ["user_id uuid FK"], "expected one new row at the end: %s -> %s" % (before, rows)
    assert page.get_by_role("textbox", name="Edit entity rows").count() == 0, "Enter should close the row editor"
    assert any("user_id" in t for t in texts), "the new row is not drawn: %s" % texts
    assert "FK" in texts, "the FK badge for the new row is not drawn: %s" % texts
    assert_no_console_errors(evidence)


@check("lld-shapes")
def test_lld_shapes(page, skot, evidence):
    skot.new_board()
    o = skot.to_world(330, 330)
    cls = skot.add_more("UML class", "Order", o)
    r = skot.rendered(cls["id"])
    dividers = sorted(float(m.group(1)) for m in (HLINE.match(p["d"]) for p in r["paths"]) if m)
    name_y, attr_y, op_y = text_y(r, "Order"), text_y(r, "- id: UUID"), text_y(r, "+ pay(): Receipt")
    seen = {"class_dividers": dividers, "class_text_y": [name_y, attr_y, op_y]}
    assert len(dividers) == 2, "a UML class needs two compartment dividers, drew %s" % dividers
    assert name_y < dividers[0] < attr_y < dividers[1] < op_y, \
        "name, attributes and operations must sit in three compartments: %s" % seen

    frag = skot.add_more("Fragment (alt/loop/opt)", "alt", (o[0] + 520, o[1] - 60))
    fr = skot.rendered(frag["id"])
    seen["fragment_text"] = [t["text"] for t in fr["texts"]]
    for want in ("alt", "[cache hit]", "[miss]"):
        text_y(fr, want)
    assert sum(1 for p in fr["paths"] if p["dash"]) == 1, "two operands need one dashed divider: %s" % fr["paths"]
    for op in ("loop", "opt"):
        skot.press("F2")
        skot.type_into_editor(op)
        skot.wait_state(lambda es: any(e["id"] == frag["id"] and e.get("label") == op for e in es),
                        what="the fragment operator %r" % op)
        skot.settle(300)
        seen["fragment_" + op] = [t["text"] for t in skot.rendered(frag["id"])["texts"]]
        assert op in seen["fragment_" + op], "the %r operator tag is not drawn: %s" % (op, seen["fragment_" + op])
    evidence.note(**seen)
    assert_no_console_errors(evidence)


PRACTICE_PROMPT = '[role=region][aria-label="Practice prompt"]'
PRACTICE_REVIEW = '[role=region][aria-label="Practice review"]'
REVIEW_PINS = '[aria-label="Review pins"] button'
GHOSTS = "[role=application] svg [class*=jev-ghost]"


@check("practice-mode")
def test_practice_mode(page, skot, evidence):
    decide_modes = []

    def on_request(req):
        if req.method == "POST" and req.url.endswith("/api/jev/decide"):
            decide_modes.append((json.loads(req.post_data or "{}")).get("mode"))
    page.on("request", on_request)

    skot.new_board()
    skot.open_examples()
    page.get_by_role("button", name=re.compile("^Practice a problem")).click()
    page.get_by_role("dialog").get_by_role("button", name=re.compile("^URL shortener")).click()
    page.get_by_role("dialog").wait_for(state="detached", timeout=5000)
    prompt = page.locator(PRACTICE_PROMPT)
    prompt.wait_for(state="visible", timeout=5000)
    timer = page.get_by_role("timer")
    clock_start = timer.inner_text()
    assert "URL shortener" in prompt.inner_text(), prompt.inner_text()
    assert page.get_by_role("textbox", name=THOUGHT_BAR).count() == 0, "the Thought Bar should be hidden in practice"
    assert page.locator('[role=region][aria-label="Start sketching on Skot"]').count() == 0, \
        "the first-run starters (with Fork) should give way to the practice prompt"

    skot.add("box", "Redirect API", skot.to_world(520, 420))
    skot.add("database", "Links DB", skot.to_world(900, 420))
    skot.connect("Redirect API", "Links DB")
    skot.select("Redirect API", "Links DB")
    skot.press("Alt+f")
    skot.settle(2500)
    multi_bar = page.locator(MULTI_BAR)
    surfaces = {
        "suggestions": page.locator(SUGGESTIONS).count(),
        "fork_panel": page.locator(FORK_PANEL).count(),
        "ghosts": page.locator(GHOSTS).count(),
        "fork_button": multi_bar.get_by_role("button", name=re.compile("Fork it")).count() if multi_bar.count() else 0,
        "morph_switcher": multi_bar.locator('[role=tablist][aria-label="Notation morph switcher"]').count()
        if multi_bar.count() else 0,
    }
    clock_later = timer.inner_text()
    modes_before_review = list(decide_modes)

    page.get_by_role("button", name="Review", exact=True).click()
    review = page.locator(PRACTICE_REVIEW)
    review.wait_for(state="visible", timeout=10000)
    page.wait_for_function("() => !document.body.innerText.includes('Asking AI for comments')", timeout=20000)
    score = review.get_by_label(re.compile(r"^Score \d+ out of 10$")).inner_text()
    source = review.get_by_test_id("review-source").inner_text()
    pins = page.locator(REVIEW_PINS)
    pin_anchors = [pins.nth(i).get_attribute("data-anchor-id") for i in range(pins.count())]
    db_id = skot.by_label("Links DB")["id"]

    page.reload(wait_until="load")
    page.locator(PRACTICE_REVIEW).wait_for(state="visible", timeout=20000)
    persisted = page.locator(PRACTICE_PROMPT).count() == 1 and page.locator(REVIEW_PINS).count() == len(pin_anchors)

    page.get_by_role("button", name="End practice").click()
    page.locator(PRACTICE_REVIEW).wait_for(state="detached", timeout=5000)
    after_exit = {"pins": page.locator(REVIEW_PINS).count(),
                  "thought_bar": page.get_by_role("textbox", name=THOUGHT_BAR).count()}

    evidence.note(clock=[clock_start, clock_later], surfaces=surfaces, modes_before_review=modes_before_review,
                  modes=decide_modes, score=score, source=source, pin_anchors=pin_anchors, persisted=persisted,
                  after_exit=after_exit)
    assert clock_start.startswith(("35:00", "34:5")), "the URL shortener timer should start at 35:00, got %r" % clock_start
    assert clock_later != clock_start, "the timer is not counting down: %r" % clock_later
    assert surfaces == {"suggestions": 0, "fork_panel": 0, "ghosts": 0, "fork_button": 0, "morph_switcher": 1}, \
        "AI surfaces must be silent in practice (Notation Morph stays): %s" % surfaces
    assert modes_before_review == [], "no AI calls before Review, saw %s" % modes_before_review
    assert set(decide_modes) <= {"practice_review"}, "only the review may call the AI: %s" % decide_modes
    assert source in ("Rule-based review", "AI review"), source
    assert re.fullmatch(r"\d+/10", score.replace(" ", "")), score
    assert db_id in pin_anchors, "a DB on the read path without a cache should carry a pin: %s" % pin_anchors
    assert persisted, "a reload must keep the practice prompt, review and pins"
    assert after_exit == {"pins": 0, "thought_bar": 1}, after_exit
    assert_no_console_errors(evidence)


@check("write-to-draw-kinds")
def test_write_to_draw_kinds(page, skot, evidence):
    skot.new_board()
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    bar.fill("kafka")
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: any(is_shape(e) for e in es), timeout=20, what="the Thought Bar to draw")
    shapes = [(e.get("label"), e.get("kind")) for e in els if is_shape(e)]
    queue = next((e for e in els if e.get("kind") == "queue"), None)
    r = skot.rendered(queue["id"]) if queue else None
    evidence.note(shapes=shapes, drawn_kind=(r or {}).get("kind"))
    assert queue, "typing 'kafka' should draw a queue, drew %s" % shapes
    assert outline_drawn(r) and r["kind"] == "queue", "the queue is stored but not drawn: %s" % r
    assert_no_console_errors(evidence)


def dblclick_world(page, skot, wx, wy):
    """Double-click at a world point; returns the ids of elements the gesture created."""
    before = {e["id"] for e in skot.elements()}
    skot.clear()
    page.mouse.dblclick(*skot.to_screen(wx, wy))
    page.wait_for_timeout(400)
    return [e for e in skot.elements() if e["id"] not in before]


def open_editor(page):
    for name in ("Edit element label", "Edit element sublabel", "Edit entity rows", "Edit fragment guards"):
        loc = page.locator('[aria-label="%s"]' % name)
        if loc.count():
            return name, loc.first.input_value()
    return None, None


@check("text-note-fit")
def test_text_note_fit(page, skot, evidence):
    skot.new_board()
    text = "100M URLs/day, 10:1 read:write, 1.2k writes/s, 12k reads/s, 5 years = 180B rows ~ 90 TB"
    skot.add("box", "Shortener API", skot.to_world(380, 260))
    el = skot.add("text", text, skot.to_world(380, 480))
    skot.clear()
    clipped = page.evaluate("""id => {
        const g = document.querySelector(`[role=application] svg [data-element-id="${CSS.escape(id)}"]`);
        const span = g && g.querySelector('foreignObject span');
        const fo = g && g.querySelector('foreignObject');
        if (!span || !fo) return null;
        return span.getBoundingClientRect().height > fo.getBoundingClientRect().height + 1;
    }""", el["id"])
    evidence.note(size=[el["width"], el["height"]], clipped=clipped)
    assert el["width"] > 180 and el["height"] >= 42, "the note kept the fixed size: %sx%s" % (el["width"], el["height"])
    assert clipped is False, "the note's text overflows its box (clipped=%r)" % clipped
    assert_no_console_errors(evidence)


@check("inline-edit")
def test_inline_edit(page, skot, evidence):
    skot.new_board()
    o = skot.to_world(250, 220)
    node = skot.add("box", "Billing", o)
    entity = skot.add_more("ER entity", "orders", (o[0] + 310, o[1] + 40))
    skot.add("box", "Ledger", (o[0], o[1] + 250))
    arrow = skot.connect("Billing", "Ledger")
    frag = skot.add_more("Fragment (alt/loop/opt)", "alt", (o[0] + 750, o[1] + 20))
    zone = skot.add_more("Zone / boundary", "VPC", (o[0] + 750, o[1] + 300))
    seen = {}

    def expect_editor(key, x, y, want_editor, want_value):
        created = dblclick_world(page, skot, x, y)
        name, value = open_editor(page)
        seen[key] = {"editor": name, "value": value, "created": [e["kind"] for e in created]}
        assert not [e for e in created if e["kind"] == "text"], \
            "double-click on the %s created a text note instead of editing it: %s" % (key, seen[key])
        assert not created, "double-click on the %s created %s" % (key, seen[key]["created"])
        assert (name, value) == (want_editor, want_value), "%s: expected %s %r, got %s" % (
            key, want_editor, want_value, seen[key])
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

    nx, ny = center(node)
    expect_editor("node title", nx, ny, "Edit element label", "Billing")
    expect_editor("entity rows", entity["x"] + entity["width"] / 2, entity["y"] + entity["height"] - 30,
                  "Edit entity rows", entity["sublabel"])
    expect_editor("entity name", entity["x"] + entity["width"] / 2, entity["y"] + 12, "Edit element label", "orders")
    expect_editor("fragment guards", frag["x"] + frag["width"] / 2, frag["y"] + frag["height"] * 0.7,
                  "Edit fragment guards", frag["sublabel"])
    lx, ly = center(skot.by_label("Ledger"))
    expect_editor("arrow", (nx + lx) / 2, (ny + ly) / 2, "Edit element label", arrow.get("label") or "")
    expect_editor("zone label", zone["x"] + 40, zone["y"] + 14, "Edit element label", "VPC")

    created = dblclick_world(page, skot, nx, ny)
    assert not created
    page.keyboard.press("Control+a")
    page.keyboard.type("Invoices")
    page.keyboard.press("Enter")
    skot.wait_state(lambda es: any(e["id"] == node["id"] and e.get("label") == "Invoices" for e in es),
                    what="the edited title")

    empty = dblclick_world(page, skot, o[0] + 330, o[1] + 300)
    seen["empty canvas"] = {"created": [e["kind"] for e in empty], "editor": open_editor(page)[0]}
    evidence.note(**seen)
    assert [e["kind"] for e in empty] == ["text"], "double-click on empty canvas should start one text note"
    assert seen["empty canvas"]["editor"] == "Edit element label"
    page.keyboard.press("Escape")
    assert_no_console_errors(evidence)


@check("select-drag")
def test_select_drag(page, skot, evidence):
    skot.new_board()
    o = skot.to_world(300, 240)
    a = skot.add("box", "Orders", o)
    skot.add("box", "Payments", (o[0] + 360, o[1]))
    skot.add("box", "Ledger", (o[0] + 360, o[1] + 180))
    skot.clear()
    sx, sy = skot.to_screen(*center(a))
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + 60, sy + 90, steps=4)
    tb = page.get_by_role("textbox", name=THOUGHT_BAR).bounding_box()
    page.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2, steps=8)
    page.mouse.up()
    els = skot.wait_state(lambda es: any(e["id"] == a["id"] and e["y"] - a["y"] > 200 for e in es),
                          what="the dragged node to land near the Thought Bar")
    dropped = next(e for e in els if e["id"] == a["id"])
    page.mouse.move(sx, sy - 100, steps=8)
    skot.settle(1500)
    after = skot.by_label("Orders")
    assert (after["x"], after["y"]) == (dropped["x"], dropped["y"]), \
        "releasing over the Thought Bar did not end the drag: the node kept following the mouse"

    skot.clear()
    # Suggestion ghosts for the dropped node may pan the view; drag the marquee around where the two nodes are now.
    pay, led = skot.by_label("Payments"), skot.by_label("Ledger")
    x0, y0 = skot.to_screen(min(pay["x"], led["x"]) - 40, min(pay["y"], led["y"]) - 40)
    x1, y1 = skot.to_screen(max(pay["x"] + pay["width"], led["x"] + led["width"]) + 40,
                            max(pay["y"] + pay["height"], led["y"] + led["height"]) + 40)
    if y0 < 70 or y1 > 900:
        skot.press("Shift+1")
        skot.settle(600)
        x0, y0 = skot.to_screen(min(pay["x"], led["x"]) - 40, min(pay["y"], led["y"]) - 40)
        x1, y1 = skot.to_screen(max(pay["x"] + pay["width"], led["x"] + led["width"]) + 40,
                                max(pay["y"] + pay["height"], led["y"] + led["height"]) + 40)
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=12)
    page.mouse.up()
    bar = page.locator(MULTI_BAR).first
    bar.wait_for(state="visible", timeout=5000)
    texts = [e for e in skot.elements() if e.get("kind") == "text"]
    evidence.note(drag_dy=dropped["y"] - a["y"], after_release=[after["x"], after["y"]],
                  marquee_bar=bar.is_visible(), stray_text=len(texts))
    assert not texts, "a drag or marquee created a text note"
    assert_no_console_errors(evidence)


@check("zoom-keys")
def test_zoom_keys(page, skot, evidence):
    skot.new_board()
    seq = {"start": skot.zoom()}
    for key, name in [("Control+Equal", "ctrl+="), ("Control+Minus", "ctrl+-"), ("Control+Minus", "ctrl+- again"),
                      ("Control+Digit0", "ctrl+0")]:
        skot.press(key)
        page.wait_for_timeout(350)
        seq[name] = round(skot.zoom(), 3)
    browser_zoom = page.evaluate("Math.round(window.devicePixelRatio * 100) / 100")
    evidence.note(zoom=seq, devicePixelRatio=browser_zoom,
                  label=page.get_by_role("group", name="Canvas zoom controls").inner_text())
    assert seq["ctrl+="] > seq["start"], seq
    assert seq["ctrl+-"] < seq["ctrl+="] and seq["ctrl+- again"] < seq["ctrl+-"], seq
    assert seq["ctrl+0"] == 1, seq
    assert browser_zoom == 1, "the page itself zoomed instead of the canvas"
    assert "100%" in page.get_by_role("group", name="Canvas zoom controls").inner_text()
    assert_no_console_errors(evidence)


@check("duplicate-arrows")
def test_duplicate_arrows(page, skot, evidence):
    skot.new_board()
    o = skot.to_world(300, 300)
    a = skot.add("box", "Billing", o)
    b = skot.add("database", "Billing DB", (o[0] + 420, o[1]))
    arrow = skot.connect("Billing", "Billing DB")
    skot.clear()
    page.keyboard.press("Control+a")
    page.wait_for_timeout(200)
    page.keyboard.press("Control+d")
    els = skot.wait_state(lambda es: len(es) == 6, what="the duplicated nodes and arrow")
    originals = {a["id"], b["id"], arrow["id"]}
    copies = [e for e in els if e["id"] not in originals]
    copy_nodes = {e["label"]: e for e in copies if is_shape(e)}
    copy_arrows = [e for e in copies if e.get("kind") == "arrow"]
    evidence.note(copies=[(e["kind"], e.get("label"), e.get("fromId"), e.get("toId")) for e in copies])
    assert set(copy_nodes) == {"Billing", "Billing DB"}, copies
    assert len(copy_arrows) == 1, "the arrow was not duplicated: %s" % copies
    assert copy_arrows[0]["fromId"] == copy_nodes["Billing"]["id"], "copied arrow still starts at the original"
    assert copy_arrows[0]["toId"] == copy_nodes["Billing DB"]["id"], "copied arrow still ends at the original"
    dx = copy_nodes["Billing"]["x"] - a["x"]
    assert dx > 0, "the copy should be offset from the original"
    assert_no_console_errors(evidence)


# ------------------------------------------------------------------ brand surfaces

@check("no-emoji-icons")
def test_no_emoji_icons(page, skot, evidence, server):
    skot.new_board()
    scans = {"first_load": page.evaluate(SCAN_UI_JS)}
    page.get_by_role("button", name="Board menu").click()
    page.wait_for_timeout(200)
    scans["board_menu"] = page.evaluate(SCAN_UI_JS)
    page.keyboard.press("Escape")
    if server["launched"]:  # drawing calls the rank API, so production only scans the static UI
        skot.new_board("fork")
        page.locator(FORK_PRESSURE).wait_for(state="visible", timeout=20000)
        scans["fork_pressure"] = page.evaluate(SCAN_UI_JS)
        open_fork_takes(page, skot, "Latency")
        scans["fork_panel"] = page.evaluate(SCAN_UI_JS)
        skot.new_board("checkout")
        skot.clear()
        skot.click_element("Ledger DB")
        page.locator(SUGGESTIONS).wait_for(state="visible", timeout=10000)
        scans["suggestions_and_inspector"] = page.evaluate(SCAN_UI_JS)
    evidence.note(scans=scans)
    for state, s in scans.items():
        assert not s["pictographic"], "emoji in the %s UI: %s" % (state, s["pictographic"])
        assert not s["stock"], "stock icon set in the %s UI: %s" % (state, s["stock"])
        assert s["svgCount"] > 5, "no icons rendered in %s (icons are inline SVG)" % state
    assert_no_console_errors(evidence)


# ------------------------------------------------------------------ board import / files

IMPORT_FIXTURE = os.path.join(REPO, "src", "lib", "jev", "__fixtures__", "import-link.json")
ROOM_HASH = re.compile(r"#room=[A-Za-z0-9_-]{22,}&k=[A-Za-z0-9_-]{22,}$")


@check("board-import")
def test_board_import(page, skot, new_page, evidence, base_url, tmp_path):
    with open(IMPORT_FIXTURE, encoding="utf-8") as f:
        fixture = json.load(f)
    want = [(e["id"], e["label"]) for e in fixture["snapshot"]["elements"]]

    # 1. An #import= link (encoded by skot-bot's Python encoder) opens as a fresh room with those elements.
    page.goto(base_url + "/" + fixture["pythonHash"], wait_until="load")
    page.wait_for_function("() => /#room=/.test(location.hash)", timeout=30000)
    got = skot.wait_state(lambda els: len(els) == len(want), what="the imported board")
    assert ROOM_HASH.search(page.url) and "import=" not in page.url, "URL after import: %s" % page.url
    assert [(e["id"], e["label"]) for e in got] == want
    canvas_text = page.locator("[role=application] svg").text_content()
    assert all(label in canvas_text for _, label in want), "imported labels not drawn on the canvas"

    # 2. Save board (.json), then Open board (.json) through the file chooser: a new room, identical elements.
    page.get_by_role("button", name="Board menu").click()
    with page.expect_download() as dl:
        page.get_by_role("menuitem", name="Save board (.json)").click()
    saved_path = str(tmp_path / "board.json")
    dl.value.save_as(saved_path)
    with open(saved_path, encoding="utf-8") as f:
        saved = json.load(f)
    assert saved["format"] == "skot-board/1"
    assert saved["snapshot"]["elements"] == fixture["snapshot"]["elements"]
    first_room = page.url
    page.get_by_role("button", name="Board menu").click()
    with page.expect_file_chooser() as fc:
        page.get_by_role("menuitem", name="Open board (.json)").click()
    with page.expect_navigation(wait_until="load"):
        fc.value.set_files(saved_path)
    page.wait_for_function("() => /#room=/.test(location.hash)", timeout=30000)
    reopened = skot.wait_state(lambda els: len(els) == len(want), what="the opened board")
    assert page.url != first_room, "Open board did not start a new room"
    assert reopened == fixture["snapshot"]["elements"]
    evidence.note(imported_url=first_room, opened_url=page.url, saved_file=dl.value.suggested_filename)
    assert_no_console_errors(evidence)

    # 3. A broken link: blank board, the error toast, no console errors.
    bad = new_page("broken-link")
    bad.goto(base_url + "/" + fixture["pythonHash"][:60], wait_until="load")
    notice = bad.locator("[data-testid=board-notice]")
    notice.wait_for(state="visible", timeout=15000)
    bad.wait_for_function("() => /#room=/.test(location.hash)", timeout=30000)
    bad_skot = type(skot)(bad, base_url)
    bad_skot.settle(800)
    assert "Could not open that board" in notice.inner_text()
    assert bad_skot.elements() == [], "a broken link must leave a blank board"
    assert "import=" not in bad.url
    assert_no_console_errors(evidence)


@check("link-preview")
def test_link_preview(base_url, evidence):
    status, ctype, body = fetch(base_url + "/")
    html = body.decode("utf-8", "replace")
    meta = dict(re.findall(r'<meta (?:property|name)="((?:og|twitter):[a-z:_]+)" content="([^"]*)"', html))
    evidence.note(meta={k: v for k, v in meta.items() if k in (
        "og:title", "og:image", "og:image:type", "og:image:width", "og:image:height", "twitter:card",
        "twitter:image", "og:url")})
    assert status == 200 and "text/html" in ctype
    for key in ["og:title", "og:description", "og:image", "og:url", "twitter:card", "twitter:image"]:
        assert meta.get(key), "missing <meta %s>" % key
    assert meta["twitter:card"] == "summary_large_image"
    img = meta["og:image"]
    assert img.startswith("http"), "og:image must be an absolute URL, got %r" % img
    s, t, data = fetch(img)
    evidence.note(og_image_status=s, og_image_type=t, og_image_bytes=len(data))
    assert s == 200 and t.split(";")[0] == "image/png", "og:image %s served %s %s" % (img, s, t)
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "og:image is not a PNG"
    width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    evidence.note(og_image_size=[width, height])
    assert (width, height) == (int(meta.get("og:image:width", width)), int(meta.get("og:image:height", height)))


@check("manifest-icons")
def test_manifest_icons(base_url, evidence):
    html = fetch(base_url + "/")[2].decode("utf-8", "replace")
    links = re.findall(r'<link rel="(icon|apple-touch-icon|manifest)" href="([^"]+)"(?: [^>]*type="([^"]+)")?', html)
    rels = {r for r, _, _ in links}
    assert {"icon", "apple-touch-icon", "manifest"} <= rels, "missing icon links, found %s" % links
    served = []
    for rel, href, want_type in links:
        url = href if href.startswith("http") else base_url + href
        s, t, data = fetch(url)
        served.append({"rel": rel, "href": href, "status": s, "type": t, "bytes": len(data)})
        assert s == 200 and data, "%s %s served %s" % (rel, href, s)
        if want_type:
            assert same_type(t, want_type), "%s served %s, the link says %s" % (href, t, want_type)
        if rel == "manifest":
            manifest = json.loads(data)
            assert manifest.get("name") and manifest.get("start_url") and manifest.get("display") == "standalone"
            for icon in manifest.get("icons", []):
                iu = icon["src"] if icon["src"].startswith("http") else base_url + icon["src"]
                s2, t2, d2 = fetch(iu)
                served.append({"rel": "manifest-icon", "href": icon["src"], "status": s2, "type": t2,
                               "bytes": len(d2)})
                assert s2 == 200 and t2.split(";")[0] == icon["type"], "%s served %s %s" % (icon["src"], s2, t2)
                w, h = int.from_bytes(d2[16:20], "big"), int.from_bytes(d2[20:24], "big")
                assert "%dx%d" % (w, h) == icon["sizes"], "%s is %dx%d, manifest says %s" % (iu, w, h, icon["sizes"])
            assert len(manifest.get("icons", [])) >= 2, "manifest needs 192 and 512 icons"
    evidence.note(served=served)


# ------------------------------------------------------------------ collaboration

@check("two-person-sync")
def test_two_person_sync(page, skot, new_page, evidence, base_url):
    skot.new_board()
    o = skot.to_world(400, 300)
    skot.add("box", "Shared Node", o)
    guest = new_page("guest")
    guest.goto(page.url, wait_until="load")
    guest.wait_for_selector("[role=application] svg", timeout=30000)
    has = "l => (document.querySelector('[role=application] svg')?.textContent || '').includes(l)"
    guest.wait_for_function(has, arg="Shared Node", timeout=30000)
    skot.add("box", "Live Edit", (o[0] + 400, o[1]))
    guest.wait_for_function(has, arg="Live Edit", timeout=20000)
    peers = page.get_by_role("banner").locator("button", has_text="P2P").inner_text()
    evidence.note(room=page.url.split("&")[0], host_peers_label=peers)
    assert "2" in peers, "the share button should count two peers, says %r" % peers
    assert_no_console_errors(evidence)
