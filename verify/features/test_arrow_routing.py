"""2A (Charles, 22 Nov 2026): arrows go around nodes, drawn and suggested. Nodes never move to make room.

Every judge in rounds 1 and 2 saw an arrow drawn straight through the node between its two ends.
"""
import json
import re

from conftest import check
from driver import Driver, is_shape
from test_core_loop import arrows_named, bar_of, board, frozen
from test_features import SUGGESTIONS, ghosts, read_options, shot

# Points along an arrow as it is drawn on screen: the longest path of its group is the shaft.
SHAFT_JS = """(sel) => {
  const g = document.querySelector(sel);
  if (!g) return null;
  const shaft = [...g.querySelectorAll('path')].sort((a, b) => b.getTotalLength() - a.getTotalLength())[0];
  if (!shaft) return null;
  const m = shaft.getScreenCTM();
  const len = shaft.getTotalLength();
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const p = shaft.getPointAtLength((len * i) / 80);
    pts.push([p.x * m.a + p.y * m.c + m.e, p.x * m.b + p.y * m.d + m.f]);
  }
  return pts;
}"""


def through(skot, points, node, shrink=2):
    """Sampled screen points of an arrow that lie inside a node's box."""
    v = skot.viewport()
    x1, y1 = skot.to_screen(node["x"], node["y"], v)
    x2, y2 = skot.to_screen(node["x"] + node["width"], node["y"] + node["height"], v)
    return [(round(x), round(y)) for x, y in points if x1 + shrink < x < x2 - shrink and y1 + shrink < y < y2 - shrink]


def drawn_shaft(page, arrow_id):
    pts = page.evaluate(SHAFT_JS, '[role=application] svg [data-element-id="%s"][data-kind="arrow"]' % arrow_id)
    assert pts, "the arrow %s is not drawn" % arrow_id
    return pts


@check("arrows-route-around")
def test_arrows_route_around(page, skot, evidence):
    # The AI is not part of this: suggestions are the board's own.
    page.route("**/api/jev/decide", lambda r: r.fulfill(status=500, content_type="application/json", body='{"error":"off"}'))
    skot.new_board()
    row = [(260, 330), (620, 330), (980, 330)]

    # 1. Drawn with the arrow tool, from the first node to the third, across the second.
    skot.add("box", "Client", skot.to_world(*row[0]))
    middle = skot.add("box", "Roadmap", skot.to_world(*row[1]))
    skot.add("box", "Ledger", skot.to_world(*row[2]))
    before = frozen(skot.elements())
    arrow = skot.connect("Client", "Ledger")
    page.wait_for_timeout(500)
    page.mouse.move(8, 500)
    shot(page, evidence, "arrows-route-around", "1-drawn")
    hits = through(skot, drawn_shaft(page, arrow["id"]), middle)
    assert not hits, "the drawn arrow Client -> Ledger passes through Roadmap at %s" % hits[:4]
    assert frozen(skot.elements()) == before, "routing an arrow must not move a node"

    # 2. Suggested: a node drawn past another one; its offered connection is a ghost arrow that goes around.
    skot.new_board()
    app = skot.add("box", "App", skot.to_world(*row[0]))
    middle = skot.add("box", "Roadmap", skot.to_world(*row[1]))
    gateway = skot.add("box", "API Gateway", skot.to_world(*row[2]))
    before = frozen(skot.elements())
    first = read_options(page)[0]
    assert first["active"] and "App" in first["title"] and "API Gateway" in first["title"], \
        "the connection App -> API Gateway should be offered and highlighted: %s" % first
    page.wait_for_timeout(400)
    ghost = [a for a in ghosts(page)["arrows"] if {a["from"], a["to"]} == {app["id"], gateway["id"]}]
    assert len(ghost) == 1, "the offered connection should be previewed as one ghost arrow: %s" % ghosts(page)
    shot(page, evidence, "arrows-route-around", "2-suggested")
    pts = page.evaluate(SHAFT_JS, '[role=application] svg [data-ghost-arrow][data-from="%s"][data-to="%s"]' % (ghost[0]["from"], ghost[0]["to"]))
    hits = through(skot, pts, middle)
    assert not hits, "the suggested arrow App -> API Gateway passes through Roadmap at %s" % hits[:4]

    skot.press("Enter")
    els = skot.wait_state(lambda es: ("App", "API Gateway") in arrows_named(es), what="the accepted connection")
    page.wait_for_timeout(500)
    page.mouse.move(8, 500)
    shot(page, evidence, "arrows-route-around", "3-accepted")
    accepted = next(a for a in els if a.get("kind") == "arrow")
    hits = through(skot, drawn_shaft(page, accepted["id"]), middle)
    assert not hits, "the accepted arrow passes through Roadmap at %s" % hits[:4]
    assert frozen(els) == before, "accepting a connection must not move a node"
    assert len([e for e in els if is_shape(e)]) == 3
    console = [e for e in evidence.errors() if "/api/jev/decide" not in e["text"] and "500" not in e["text"]]
    assert not console, console[:4]


ALL_SHAFTS_JS = """() => {
  const sample = (g) => {
    const shaft = [...g.querySelectorAll('path')].sort((a, b) => b.getTotalLength() - a.getTotalLength())[0];
    if (!shaft) return [];
    const m = shaft.getScreenCTM();
    const len = shaft.getTotalLength();
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const p = shaft.getPointAtLength((len * i) / 80);
      pts.push([p.x * m.a + p.y * m.c + m.e, p.x * m.b + p.y * m.d + m.f]);
    }
    return pts;
  };
  const svg = document.querySelector('[role=application] svg');
  return {
    drawn: [...svg.querySelectorAll('[data-element-id][data-kind="arrow"]')].map((g) => ({id: g.getAttribute('data-element-id'), pts: sample(g)})),
    ghost: [...svg.querySelectorAll('[data-ghost-arrow]')].map((g) => ({from: g.getAttribute('data-from'), to: g.getAttribute('data-to'), pts: sample(g)})),
  };
}"""


def arrows_through_nodes(page, skot):
    """Every arrow on screen, drawn or ghost, that passes through a board node it does not connect."""
    els = skot.elements()
    nodes = [e for e in els if is_shape(e)]
    ends = {a["id"]: (a.get("fromId"), a.get("toId")) for a in els if a.get("kind") == "arrow"}
    name = {e["id"]: e.get("label") for e in nodes}
    shafts = page.evaluate(ALL_SHAFTS_JS)
    found = []
    for a in shafts["drawn"]:
        frm, to = ends.get(a["id"], (None, None))
        found += [("drawn %s -> %s" % (name.get(frm), name.get(to)), n["label"]) for n in nodes
                  if n["id"] not in (frm, to) and through(skot, a["pts"], n)]
    for a in shafts["ghost"]:
        found += [("suggested %s -> %s" % (name.get(a["from"], "new"), name.get(a["to"], "new")), n["label"]) for n in nodes
                  if n["id"] not in (a["from"], a["to"]) and through(skot, a["pts"], n)]
    return found


@check("arrows-route-stack")
def test_arrows_route_stack(browser, server, base_url, evidence):
    """Caren on prod, 22 Nov: on a phone's single column the suggested arrow Auth Service -> Kafka ran through Redis
    and Postgres, and Postgres -> Object Storage through Kafka and Worker."""
    headers = {"CF-Connecting-IP": "198.18.240.11"} if server["launched"] else {}
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                              device_scale_factor=2, extra_http_headers=headers)
    ctx.route(re.compile(r"/_vercel/(insights|speed-insights)/"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=""))
    page = ctx.new_page()
    evidence.watch(page, "phone")
    page.route("**/api/jev/decide", lambda r: r.fulfill(status=500, content_type="application/json", body=json.dumps({"error": "off"})))
    skot = Driver(page, base_url)
    try:
        skot.new_board()
        bar_of(page).tap()
        names = ["app", "api gateway", "auth service", "redis", "postgres", "kafka", "worker", "object storage"]
        seen, skipping = [], 0
        for i, name in enumerate(names, 1):
            page.keyboard.type(name, delay=20)
            page.keyboard.press("Enter")
            els = board(skot, i)
            before = frozen(els)
            page.wait_for_timeout(700)
            found = arrows_through_nodes(page, skot)
            shafts = page.evaluate(ALL_SHAFTS_JS)
            if shafts["ghost"]:
                shot(page, evidence, "arrows-route-stack", "%d-%s-suggested" % (i, name.replace(" ", "-")))
            assert not found, "after %r an arrow runs through a node: %s" % (name, found)
            # Accept the offered connection (the highlighted first chip) and look at it drawn.
            chip = page.locator(SUGGESTIONS + ' button[aria-pressed="true"]')
            if chip.count() and shafts["ghost"]:
                arrows_before = len(arrows_named(els))
                label = " ".join(chip.first.inner_text().split())
                chip.first.tap()
                els = skot.wait_state(lambda es: len(arrows_named(es)) == arrows_before + 1, what="the tapped connection")
                page.wait_for_timeout(500)
                seen.append(label)
                by_id = {e["id"]: e for e in els}
                new = [a for a in els if a.get("kind") == "arrow"][-1]
                ys = sorted([by_id[new["fromId"]]["y"], by_id[new["toId"]]["y"]])
                skipping += 1 if [e for e in els if is_shape(e) and ys[0] < e["y"] < ys[1]] else 0
                found = arrows_through_nodes(page, skot)
                assert not found, "after accepting %r an arrow runs through a node: %s" % (label, found)
                assert frozen(els) == before, "accepting a connection moved a node"
        shot(page, evidence, "arrows-route-stack", "9-all-accepted")
        evidence.note(accepted=seen, arrows=arrows_named(skot.elements()), arrows_past_a_node=skipping)
        assert skipping >= 1, "the scenario must include an arrow that skips a node in the stack: %s" % seen
        console = [e for e in evidence.errors() if "/api/jev/decide" not in e["text"] and "500" not in e["text"]]
        assert not console, console[:4]
    finally:
        ctx.close()

