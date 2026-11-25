"""Hands and eyes for Skot: drives the real UI the way a person does (keys, clicks, typing).

Tools are picked with Alt+letter: a bare letter typed on the board goes to the Thought Bar (22 Nov 2026).

Vendored from the agent driver /home/clover_mj/tools/skot-bot/skot_bot.py (its Daemon class), minus the
socket daemon: the feature suite owns one Playwright page per check. Page evaluation only reads state
(the board the app persists in localStorage, the canvas transform); every change goes through the UI.
"""
import json
import re
import time
import urllib.parse

BOARD_PATH = re.compile(r"/b/([^/?#]+)/?$")
VIEWPORT = {"width": 1600, "height": 1000}
SAFE = {"left": 70, "top": 120, "right": 1530, "bottom": 600}

SHAPES = {
    "box": {"kind": "node", "key": "Alt+r", "w": 172, "h": 72},
    "decision": {"kind": "diamond", "key": "Alt+d", "w": 148, "h": 96},
    "database": {"kind": "database", "key": "Alt+o", "w": 156, "h": 86},
    "actor": {"kind": "ellipse", "key": "Alt+c", "w": 152, "h": 74},
    "text": {"kind": "text", "key": "Alt+t", "w": 180, "h": 42},
}
STARTERS = {"checkout": "Draw a checkout system", "sequence": "Morph to sequence",
            "fork": "Fork my architecture"}


class DriverError(AssertionError):
    pass


def is_shape(el):
    return el.get("kind") not in ("arrow", "freedraw")


def center(el):
    return el["x"] + el["width"] / 2.0, el["y"] + el["height"] / 2.0


def boxes_overlap(a, b, pad=0):
    return not (a["x"] + a["width"] + pad <= b["x"] or b["x"] + b["width"] + pad <= a["x"] or
                a["y"] + a["height"] + pad <= b["y"] or b["y"] + b["height"] + pad <= a["y"])


def overlapping_pairs(elements, pad=0):
    """Pairs of shapes whose boxes intersect. Frames (zones) are containers, so they are left out."""
    shapes = [e for e in elements if is_shape(e) and e.get("kind") != "frame"]
    out = []
    for i, a in enumerate(shapes):
        for b in shapes[i + 1:]:
            if boxes_overlap(a, b, pad):
                out.append((a.get("label") or a["id"], b.get("label") or b["id"]))
    return out


class Driver:
    def __init__(self, page, base):
        self.page = page
        self.base = base.rstrip("/")

    # ---------------- reading state

    def room_id(self):
        found = BOARD_PATH.search(urllib.parse.urlsplit(self.page.url).path)
        return urllib.parse.unquote(found.group(1)) if found else None

    def snapshot(self):
        rid = self.room_id()
        if not rid:
            raise DriverError("no board open: call new_board() first")
        raw = self.page.evaluate("k => localStorage.getItem(k)", "jev_board_" + rid)
        snap = json.loads(raw) if raw else {"elements": []}
        snap.setdefault("elements", [])
        return snap

    def elements(self):
        return self.snapshot()["elements"]

    def shapes(self):
        return [e for e in self.elements() if is_shape(e)]

    def arrows(self):
        return [e for e in self.elements() if e.get("kind") == "arrow"]

    def wait_state(self, pred, timeout=10.0, what="the board to change"):
        deadline = time.time() + timeout
        while time.time() < deadline:
            els = self.elements()
            if pred(els):
                return els
            self.page.wait_for_timeout(150)
        raise DriverError("timed out after %.0fs waiting for %s" % (timeout, what))

    def by_label(self, label):
        hits = [e for e in self.elements() if (e.get("label") or "").strip().lower() == label.strip().lower()]
        if len(hits) != 1:
            raise DriverError("expected one element labelled %r, found %d" % (label, len(hits)))
        return hits[0]

    def viewport(self):
        v = self.page.evaluate("""() => {
            const app = document.querySelector('[role=application]');
            if (!app) return null;
            const r = app.getBoundingClientRect();
            const dbg = window.__skotDebug && window.__skotDebug.getViewport && window.__skotDebug.getViewport();
            if (dbg) return {x: dbg.x, y: dbg.y, zoom: dbg.zoom, left: r.left, top: r.top};
            const raw = app.getAttribute('data-viewport');
            if (raw) {
                const [x, y, zoom] = raw.split(',').map(Number);
                if (Number.isFinite(zoom)) return {x, y, zoom, left: r.left, top: r.top};
            }
            const svg = app.querySelector('svg');
            const g = svg && svg.querySelector(':scope > g[transform]');
            if (!g) return null;
            const m = g.getAttribute('transform').match(/translate\\(([-\\d.e]+),\\s*([-\\d.e]+)\\)\\s*scale\\(([-\\d.e]+)\\)/);
            return m && {x: +m[1], y: +m[2], zoom: +m[3], left: r.left, top: r.top};
        }""")
        if not v:
            raise DriverError("canvas viewport not found on [role=application]")
        return v

    def to_screen(self, wx, wy, v=None):
        v = v or self.viewport()
        return v["left"] + v["x"] + wx * v["zoom"], v["top"] + v["y"] + wy * v["zoom"]

    def to_world(self, sx, sy, v=None):
        v = v or self.viewport()
        return (sx - v["left"] - v["x"]) / v["zoom"], (sy - v["top"] - v["y"]) / v["zoom"]

    def on_canvas(self, sx, sy):
        return self.page.evaluate("""([x, y]) => {
            const el = document.elementFromPoint(x, y);
            const app = document.querySelector('[role=application]');
            return !!(el && app && (el === app || app.contains(el)));
        }""", [sx, sy])

    # ---------------- user-like primitives

    def wait_board(self, timeout=30000):
        """The board in the address bar is the one on screen."""
        self.page.wait_for_selector('[role=application] canvas[data-canvas-layer="static"], [role=application] svg', timeout=timeout)
        self.page.wait_for_function("() => /\\/b\\/[^/]+$/.test(location.pathname)", timeout=timeout)

    def new_board(self, starter=None):
        self.page.goto(self.base + "/new", wait_until="load", timeout=60000)
        self.wait_board()
        self.page.wait_for_timeout(500)
        if starter:
            self.open_examples()
            self.page.get_by_role("button", name=STARTERS[starter]).click()
            self.wait_state(lambda els: any(is_shape(e) for e in els), timeout=20, what="the starter to load")
            self.settle()
        return self.room_id()

    def open_examples(self):
        """The first screen is the bar and one Examples button; starters and starter boards are behind it."""
        self.page.get_by_role("region", name="Start sketching on Skot").get_by_role("button", name="Examples", exact=True).click()
        self.page.get_by_role("button", name="Close examples").wait_for(state="visible", timeout=5000)

    def settle(self, ms=1200):
        self.page.wait_for_timeout(ms)

    def blur(self):
        self.page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")

    def clear(self):
        """Escape twice: the first dismisses suggestions, the second clears the selection."""
        self.blur()
        self.page.keyboard.press("Escape")
        self.page.keyboard.press("Escape")
        self.page.wait_for_timeout(120)

    def press(self, key):
        self.blur()
        self.page.keyboard.press(key)

    def edit_input(self, timeout=3000):
        loc = self.page.locator('input[aria-label="Edit element label"], input[aria-label="Edit element sublabel"]')
        loc.first.wait_for(state="visible", timeout=timeout)
        return loc.first

    def type_into_editor(self, text):
        inp = self.edit_input()
        inp.press("Control+a")
        self.page.keyboard.type(text, delay=8)
        self.page.keyboard.press("Enter")

    def add(self, shape, label, at):
        """Tool key, click at world point `at`, type the label into the inline editor, Enter."""
        spec = SHAPES[shape]
        before = {e["id"] for e in self.elements()}
        self.clear()
        sx, sy = self.to_screen(*at)
        if not self.on_canvas(sx, sy):
            raise DriverError("world point %s is covered by UI; pick another spot" % (at,))
        self.page.keyboard.press(spec["key"])
        self.page.mouse.click(sx, sy)
        self.type_into_editor(label)
        els = self.wait_state(lambda es: any(e["id"] not in before and e.get("label") == label for e in es),
                              what="the new %s %r" % (spec["kind"], label))
        return next(e for e in els if e["id"] not in before and e.get("label") == label)

    def add_more(self, kind_label, label, at):
        """More shapes flyout: open it, pick `kind_label` (its button name), click at world point `at`, name it."""
        before = {e["id"] for e in self.elements()}
        self.clear()
        sx, sy = self.to_screen(*at)
        if not self.on_canvas(sx, sy):
            raise DriverError("world point %s is covered by UI; pick another spot" % (at,))
        self.page.get_by_role("button", name="More shapes", exact=True).click()
        self.page.get_by_role("button", name=kind_label, exact=True).click()
        self.page.mouse.click(sx, sy)
        self.type_into_editor(label)
        els = self.wait_state(lambda es: any(e["id"] not in before and e.get("label") == label for e in es),
                              what="the new %s %r" % (kind_label, label))
        return next(e for e in els if e["id"] not in before and e.get("label") == label)

    def rendered(self, el_id):
        """What the canvas drew for one element: its path data and text, in the element's own coordinates."""
        return self.page.evaluate("""id => {
            const snap = window.__skotDebug && window.__skotDebug.getSceneSnapshot && window.__skotDebug.getSceneSnapshot();
            if (snap) {
                const hit = snap.elements.find(e => e.id === id);
                if (!hit) return null;
                return {
                    kind: hit.kind,
                    paths: hit.paths.map(p => ({d: p.d || '', stroke: p.stroke || null, dash: p.dash || null, end: p.end || null})),
                    texts: hit.texts,
                };
            }
            const g = document.querySelector(`[role=application] svg [data-element-id="${CSS.escape(id)}"]`);
            if (!g) return null;
            const num = (n, a) => parseFloat(n.getAttribute(a));
            return {
                kind: g.getAttribute('data-kind'),
                paths: [...g.querySelectorAll('path')].map(p => ({d: p.getAttribute('d') || '',
                    stroke: p.getAttribute('stroke'), dash: p.getAttribute('stroke-dasharray'),
                    end: p.getAttribute('data-arrow-end')})),
                texts: [...g.querySelectorAll('text')].map(t => ({text: t.textContent, y: num(t, 'y')})),
            };
        }""", el_id)

    def click_world(self, wx, wy):
        self.page.mouse.click(*self.to_screen(wx, wy))
        self.page.wait_for_timeout(200)

    def connect(self, frm, to):
        f, t = self.by_label(frm), self.by_label(to)
        existing = {e["id"] for e in self.arrows()}
        self.clear()
        v = self.viewport()
        s1, s2 = self.to_screen(*center(f), v), self.to_screen(*center(t), v)
        self.page.keyboard.press("Alt+a")
        self.page.mouse.move(*s1)
        self.page.mouse.down()
        self.page.mouse.move((s1[0] + s2[0]) / 2, (s1[1] + s2[1]) / 2, steps=6)
        self.page.mouse.move(*s2, steps=10)
        self.page.wait_for_timeout(80)
        self.page.mouse.up()
        els = self.wait_state(lambda es: any(e.get("kind") == "arrow" and e["id"] not in existing and
                                             e.get("fromId") == f["id"] and e.get("toId") == t["id"] for e in es),
                              what="an arrow %r -> %r" % (frm, to))
        return next(e for e in els if e.get("kind") == "arrow" and e["id"] not in existing)

    def click_element(self, label, modifier=None):
        el = self.by_label(label)
        sx, sy = self.to_screen(el["x"] + el["width"] / 2, el["y"] + el["height"] * 0.55)
        if modifier:
            self.page.keyboard.down(modifier)
        self.page.mouse.click(sx, sy)
        if modifier:
            self.page.keyboard.up(modifier)
        self.page.wait_for_timeout(150)
        return el

    def select(self, *labels):
        self.clear()
        for i, lab in enumerate(labels):
            self.click_element(lab, "Shift" if i else None)
        self.page.wait_for_timeout(250)

    def stroke(self, points_world, steps=4):
        """Ink pen (P) stroke through world points, like a person dragging the mouse."""
        self.clear()
        self.page.keyboard.press("Alt+p")
        v = self.viewport()
        pts = [self.to_screen(x, y, v) for x, y in points_world]
        self.page.mouse.move(*pts[0])
        self.page.mouse.down()
        for p in pts[1:]:
            self.page.mouse.move(*p, steps=steps)
        self.page.mouse.up()
        self.page.wait_for_timeout(300)

    def zoom(self):
        return self.viewport()["zoom"]

    def suggestions_region(self):
        return self.page.locator('[role=region][aria-label="Predictive drafting suggestions"]')

    def suggestion_titles(self, wait_s=8.0):
        """Titles of the visible suggestion buttons once the engine has finished deciding."""
        deadline = time.time() + wait_s
        got = None
        while time.time() < deadline:
            got = self.page.evaluate("""() => {
                const r = document.querySelector('[role=region][aria-label="Predictive drafting suggestions"]');
                if (!r) return null;
                const deciding = /deciding/.test(r.textContent);
                const btns = [...r.querySelectorAll('button[aria-pressed]')];
                return {deciding, items: btns.map(b => ({active: b.getAttribute('aria-pressed') === 'true',
                  parts: [...b.querySelectorAll('span, p, div')].filter(n => n.children.length === 0)
                    .map(n => n.textContent.trim()).filter(Boolean)}))};
            }""")
            if got and got["items"] and not got["deciding"]:
                break
            self.page.wait_for_timeout(200)
        if not got or not got["items"]:
            return []
        out = []
        for i, it in enumerate(got["items"]):
            parts = [p for p in it["parts"] if p != str(i + 1) and not p.endswith("%")]
            out.append({"n": i + 1, "title": parts[0] if parts else "", "active": it["active"]})
        return out
