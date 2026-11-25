"""Real-use bugs from Charles's engineering interview on Skot (25 Nov 2026, prod 25c7e1e).

1. Double-clicking a node did not edit its text; it created a new text note.
2. Zoom was not fluid: wheel / pinch input was dropped and every tick re-rendered the whole app.
3. General lag: typing in the Thought Bar and dragging a node re-render the whole app per event.

Investigation and numbers: INVESTIGATION.md. Every check here drives real input (mouse, wheel, keys). The render
budgets count React components per input event through the DevTools global hook, so they are exact, not timings.
"""
from conftest import assert_no_console_errors, check
from driver import center
from test_core_loop import bar_of

# Same rule as React DevTools' "did this component render": new fiber, or the PerformedWork flag (1).
RENDER_COUNTER = r"""
(() => {
  const st = (window.__renders = { on: false, commits: 0, components: 0, wheel: 0, moves: 0, keys: 0 });
  const TAGS = new Set([0, 1, 11, 14, 15]);
  const walk = (root) => {
    let n = 0;
    const stack = [root];
    while (stack.length) {
      const f = stack.pop();
      const prev = f.alternate;
      if (TAGS.has(f.tag) && (!prev || (f.flags & 1))) n++;
      if (!prev || f.child !== prev.child) for (let c = f.child; c; c = c.sibling) stack.push(c);
    }
    return n;
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(_id, root) { if (st.on) { st.commits++; st.components += walk(root.current); } },
    onPostCommitFiberRoot() {}, onCommitFiberUnmount() {}, onScheduleFiberRoot() {},
    setStrictMode() {}, checkDCE() {}, on() {}, off() {}, emit() {}, sub() { return () => {}; },
  };
  const count = (type, key) => window.addEventListener(type, () => { if (st.on) st[key]++; }, { capture: true, passive: true });
  count("wheel", "wheel"); count("pointermove", "moves"); count("input", "keys");
})();
"""


def start_counting(page):
    page.evaluate("() => Object.assign(window.__renders, {on: true, commits: 0, components: 0, wheel: 0, moves: 0, keys: 0})")


def stop_counting(page):
    return page.evaluate("() => { window.__renders.on = false; return {...window.__renders}; }")


def load_url_shortener(page, skot):
    """The 59-element URL shortener starter board: the size of a real interview board."""
    skot.new_board()
    skot.open_examples()
    page.get_by_role("button", name="Starter board: URL shortener").click()
    els = skot.wait_state(lambda es: len(es) >= 50, timeout=20, what="the starter board")
    skot.settle(1500)
    return els


def editor_value(page):
    return page.evaluate("""() => {
        const ed = document.querySelector('[role=application] input, [role=application] textarea');
        return ed ? ed.value : null;
    }""")


def text_notes_drawn(page):
    return page.evaluate("""() => {
        const snap = window.__skotDebug && window.__skotDebug.getSceneSnapshot && window.__skotDebug.getSceneSnapshot();
        if (snap) return snap.elements.filter(e => e.kind === 'text').length;
        return document.querySelectorAll('[role=application] svg [data-kind=text]').length;
    }""")


def dblclick(page, sx, sy, wobble=0):
    """A double-click; with `wobble`, the pointer moves that many px while the button is down the second time."""
    page.mouse.move(sx, sy)
    page.mouse.down(click_count=1)
    page.mouse.up(click_count=1)
    page.wait_for_timeout(70)
    page.mouse.down(click_count=2)
    if wobble:
        page.mouse.move(sx + wobble, sy)
    page.mouse.up(click_count=2)
    page.wait_for_timeout(300)


@check("dblclick-edits-node")
def test_dblclick_edits_node(page, skot, evidence):
    """Charles: "double-clicking a node (e.g. a user node) did NOT edit its text; it created a NEW text element
    beneath it". Three ways it happens on 25c7e1e, all because a double-click is routed by the DOM element under
    the pointer while a single click is routed by the node's box."""
    skot.new_board()
    seen = {}

    def expect_edit(key, sx, sy, want, wobble=0):
        skot.clear()
        notes = text_notes_drawn(page)
        dblclick(page, sx, sy, wobble)
        seen[key] = {"editor_value": editor_value(page), "new_text_notes": text_notes_drawn(page) - notes}
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        evidence.note(**seen)
        assert seen[key]["new_text_notes"] == 0, \
            "double-click on %s created a text note instead of editing it: %s" % (key, seen[key])
        assert seen[key]["editor_value"] == want, "double-click on %s: expected an editor holding %r, got %s" % (
            key, want, seen[key])

    # 1. A plain box, dead centre, with one pixel of hand movement during the second click.
    box = skot.add("box", "User", skot.to_world(520, 300))
    expect_edit("a box (still pointer)", *skot.to_screen(*center(box)), want="User")
    expect_edit("a box (pointer moved 1 px during the second click)", *skot.to_screen(*center(box)), want="User", wobble=1)

    # 2. The stick-figure user the Thought Bar draws for "User": the name under the figure.
    bar_of(page).click()
    page.keyboard.type("Customer", delay=25)
    page.keyboard.press("Enter")
    els = skot.wait_state(lambda es: any(e.get("label") == "Customer" for e in es), what="the Customer node")
    skot.settle(600)
    page.keyboard.press("Escape")
    actor = next(e for e in els if e.get("label") == "Customer")
    evidence.note(customer_kind=actor["kind"])
    expect_edit("the name under a %s" % actor["kind"],
                *skot.to_screen(actor["x"] + actor["width"] / 2, actor["y"] + actor["height"] - 9), want="Customer")
    expect_edit("the open area of a %s" % actor["kind"],
                *skot.to_screen(actor["x"] + actor["width"] * 0.15, actor["y"] + actor["height"] * 0.3), want="Customer")

    # 3. An existing text note.
    note = skot.add("text", "p99 under 50 ms", skot.to_world(900, 300))
    expect_edit("an existing text note", *skot.to_screen(*center(note)), want="p99 under 50 ms")
    assert_no_console_errors(evidence)


def ctrl_wheel(cdp, x, y, delta_y, n):
    """Mouse ctrl+wheel ticks. Each call returns once the page handled the event."""
    for _ in range(n):
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y, "deltaX": 0, "deltaY": delta_y,
                                              "modifiers": 2})


@check("wheel-zoom-follows-input")
def test_wheel_zoom_follows_input(page, skot, evidence):
    """A pinch must zoom the canvas by what the fingers did, however busy the page is. The pinch is Chromium's own
    (Input.synthesizePinchGesture, touchpad source): it reaches the page as ctrl+wheel with scale = exp(-deltaY/100),
    exactly like a MacBook trackpad. On 25c7e1e a 2x pinch zooms 1.11x, and 1.04x under a 4x CPU slowdown (a laptop
    sharing its screen on a call): the sensitivity is 0.0022 instead of 0.01, and the wheel listener computes from
    the viewport of the last render, so events that arrive before React re-subscribes it overwrite each other."""
    load_url_shortener(page, skot)
    cdp = page.context.new_cdp_session(page)
    page.mouse.move(800, 480)
    got = {}
    for name, rate in (("full speed", 1), ("4x CPU slowdown", 4)):
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
        page.wait_for_timeout(400)
        z0 = skot.zoom()
        cdp.send("Input.synthesizePinchGesture", {"x": 800, "y": 480, "scaleFactor": 2, "relativeSpeed": 300,
                                                  "gestureSourceType": "mouse"})
        page.wait_for_timeout(700)
        z1 = skot.zoom()
        cdp.send("Input.synthesizePinchGesture", {"x": 800, "y": 480, "scaleFactor": 0.5, "relativeSpeed": 300,
                                                  "gestureSourceType": "mouse"})
        page.wait_for_timeout(700)
        got[name] = {"zoom_before": round(z0, 3), "after_2x_pinch": round(z1, 3), "canvas_scale": round(z1 / z0, 3),
                     "after_pinching_back": round(skot.zoom(), 3)}
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    evidence.note(pinch_2x=got)
    for name, g in got.items():
        assert 1.9 <= g["canvas_scale"] <= 2.1, "at %s a 2x pinch zoomed the canvas %sx: %s" % (name, g["canvas_scale"], got)
        assert abs(g["after_pinching_back"] / g["zoom_before"] - 1) <= 0.05, \
            "at %s pinching 2x out and back did not return to the start: %s" % (name, got)
    assert_no_console_errors(evidence)


@check("render-budget-zoom")
def test_render_budget_zoom(page, skot, evidence):
    """A wheel tick moves the canvas; it must not re-render the app. On 25c7e1e each tick re-renders JevWorkspace,
    JevCanvas and every toolbar, tooltip and dialog (214 components) because the viewport is JevWorkspace state."""
    page.add_init_script(RENDER_COUNTER)
    load_url_shortener(page, skot)
    cdp = page.context.new_cdp_session(page)
    page.mouse.move(800, 480)
    page.wait_for_timeout(300)
    start_counting(page)
    ctrl_wheel(cdp, 800, 480, -2, 30)
    ctrl_wheel(cdp, 800, 480, 2, 30)
    r = stop_counting(page)
    per_event = r["components"] / max(1, r["wheel"])
    evidence.note(renders=r, components_per_wheel_event=round(per_event, 1))
    assert r["wheel"] >= 20, "the wheel events did not reach the page: %s" % r
    assert per_event <= 20, "zooming re-rendered %.0f React components per wheel event (budget 20): %s" % (per_event, r)
    assert_no_console_errors(evidence)


@check("render-budget-typing")
def test_render_budget_typing(page, skot, evidence):
    """A keystroke in the Thought Bar must not re-render the canvas and the toolbars. On 25c7e1e each one commits
    three times at ~217 components (the text is JevWorkspace state and the type-ahead sets two more states)."""
    page.add_init_script(RENDER_COUNTER)
    load_url_shortener(page, skot)
    bar_of(page).click()
    page.wait_for_timeout(400)
    start_counting(page)
    page.keyboard.type("redis cache", delay=60)
    page.wait_for_timeout(500)
    r = stop_counting(page)
    per_key = r["components"] / max(1, r["keys"])
    evidence.note(renders=r, components_per_keystroke=round(per_key, 1))
    page.keyboard.press("Escape")
    assert r["keys"] == 11, "expected 11 input events, saw %s" % r
    assert per_key <= 150, "typing re-rendered %.0f React components per keystroke (budget 150): %s" % (per_key, r)
    assert_no_console_errors(evidence)


@check("render-budget-drag")
def test_render_budget_drag(page, skot, evidence):
    """Dragging one node must re-render that node and its arrows, not the app. On 25c7e1e each pointer move
    re-renders ~227 components, about 1.6 commits per move."""
    page.add_init_script(RENDER_COUNTER)
    els = load_url_shortener(page, skot)
    node = next(e for e in els if e.get("label") == "Analytics")
    sx, sy = skot.to_screen(*center(node))
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx - 10, sy + 8, steps=4)
    start_counting(page)
    page.mouse.move(sx - 110, sy + 90, steps=40)
    r = stop_counting(page)
    page.mouse.up()
    page.wait_for_timeout(300)
    page.keyboard.press("Control+z")
    per_move = r["components"] / max(1, r["moves"])
    evidence.note(renders=r, components_per_pointer_move=round(per_move, 1))
    assert r["moves"] >= 20, "the pointer moves did not reach the page: %s" % r
    assert per_move <= 60, "dragging re-rendered %.0f React components per pointer move (budget 60): %s" % (per_move, r)
    assert_no_console_errors(evidence)
