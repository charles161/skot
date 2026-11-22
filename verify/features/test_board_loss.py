"""Saved boards are never lost: the 22 Nov 2026 data-loss bug (501 elements, reload, blank, overwritten)."""
import json

import pytest

from conftest import assert_no_console_errors, check

THOUGHT_BAR = "Describe a component or diagram flow to draw"
LONG_A = "Checkout orchestration service that validates carts and reserves stock before charging cards"
LONG_B = "Settlement reconciliation worker that replays failed captures from the ledger every night"


@pytest.fixture(autouse=True)
def no_ai(page):
    """These checks are about storage, and also run against prod: no AI calls."""
    body = json.dumps({"source": "heuristic", "model": "heuristic", "isHeuristic": True, "latencyMs": 0})
    page.route("**/api/jev/**", lambda route: route.fulfill(status=200, content_type="application/json", body=body))


def element(i, **extra):
    el = {"id": "n%d" % i, "kind": "node", "x": (i % 25) * 230, "y": (i // 25) * 110, "width": 160, "height": 64,
          "label": "Node %d" % i, "tone": "ink", "seed": i + 1, "createdAt": 1, "updatedAt": 1}
    el.update(extra)
    return el


def raw_board(skot):
    return skot.page.evaluate("k => localStorage.getItem(k)", "jev_board_" + skot.room_id())


def reopen(page):
    page.reload(wait_until="load")
    page.wait_for_selector("[role=application] svg", timeout=30000)
    page.wait_for_timeout(1500)


def seed_raw(skot, raw):
    """Set-up only writes storage, as an older build left it. Every change under test goes through the UI."""
    skot.settle()
    skot.page.evaluate("([k, v]) => localStorage.setItem(k, v)", ["jev_board_" + skot.room_id(), raw])


def seed(skot, elements):
    seed_raw(skot, json.dumps({"elements": elements, "hasLocalEdits": True}))
    reopen(skot.page)


def drawn(page):
    return page.locator("[data-element-id]").count()


def type_node(skot, label):
    bar = skot.page.get_by_label(THOUGHT_BAR)
    bar.fill(label)
    bar.press("Enter")
    skot.page.wait_for_timeout(1500)


@check("board-full-reload")
def test_board_full_reload(page, skot, evidence):
    skot.new_board()
    seed(skot, [element(i) for i in range(500)])
    type_node(skot, "extra node")
    page.get_by_test_id("board-notice").filter(has_text="500").wait_for(timeout=6000)
    assert len(skot.elements()) == 500, "a 501st element was saved"
    skot.clear()
    page.keyboard.press("Control+a")
    page.keyboard.press("Control+d")
    page.wait_for_timeout(1500)
    assert len(skot.elements()) == 500, "duplicate (the board's paste) got past the limit"
    reopen(page)
    assert drawn(page) == 500, "the board did not come back after a reload"
    type_node(skot, "probe")
    assert len(skot.elements()) == 500, "the edit after the reload overwrote the saved board"
    evidence.note(stored=len(skot.elements()), drawn=drawn(page))
    assert_no_console_errors(evidence)


@check("board-morph-reload")
def test_board_morph_reload(page, skot, evidence):
    skot.new_board()
    seed(skot, [element(0, label=LONG_A), element(1, label=LONG_B, x=420),
                element(2, kind="arrow", label="", width=0, height=0, fromId="n0", toId="n1")])
    assert drawn(page) == 3
    skot.clear()
    page.keyboard.press("Control+a")
    page.locator('[aria-label="Notation morph switcher"]').get_by_role("tab", name="Sequence").click()
    skot.wait_state(lambda els: any(e.get("morphMeta") for e in els), what="the morph to save")
    count = len(skot.elements())
    reopen(page)
    assert drawn(page) >= 2, "Morph of two long labels lost the board on reload"
    assert len(skot.elements()) == count
    type_node(skot, "after morph")
    assert len(skot.elements()) == count + 1, "the edit after the reload replaced the morphed board"
    evidence.note(stored=count + 1, drawn=drawn(page))
    assert_no_console_errors(evidence)


@check("board-stuck-recovers")
def test_board_stuck_recovers(page, skot, evidence):
    # 1. Saved at 501 by the old build: all of it loads, it can shrink, and it can't grow.
    skot.new_board()
    seed(skot, [element(i) for i in range(501)])
    assert drawn(page) == 501, "a board already saved at 501 is still blank"
    type_node(skot, "no room")
    assert len(skot.elements()) == 501, "a stuck board grew, or was overwritten"
    skot.clear()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    skot.wait_state(lambda els: len(els) == 0, what="the delete")
    page.keyboard.press("Control+z")
    skot.wait_state(lambda els: len(els) == 501, what="undo to bring all 501 back")
    reopen(page)
    assert drawn(page) == 501, "undo at 501 did not survive a reload"

    # 2. Morph text saved over the limit by the old build.
    skot.new_board()
    page.reload()  # a second board in this context: make sure the new room is the one loaded
    page.wait_for_selector("[role=application] svg", timeout=30000)
    over = {"groupId": "g1", "notation": "er", "groupRecord": {
        "groupId": "g1", "anchorBounds": {"x": 0, "y": 0, "width": 400, "height": 200},
        "spec": {"summary": "s" * 400, "actors": [], "messages": [], "steps": [], "states": [], "transitions": [],
                 "relations": [], "entities": [{"id": "e1", "name": "Orders", "attributes": ["a" * 300]}]},
        "sketchSnapshot": [{"id": "s1", "kind": "node", "x": 0, "y": 0, "width": 160, "height": 64,
                            "label": "Orders", "tone": "ink", "seed": 1}]}}
    seed(skot, [element(0, kind="entity", label="Orders", morphMeta=over), element(1)])
    assert drawn(page) == 2, "a board stuck on long Morph text is still blank"
    type_node(skot, "saved again")
    assert len(skot.elements()) == 3, "the recovered board was overwritten"

    # 3. Can't be read at all: untouched, said so, downloadable, and still there after starting a new board.
    broken = '{"elements":[{"id":"cut short'
    seed_raw(skot, broken)
    key = "jev_board_" + skot.room_id()
    page.reload(wait_until="load")
    panel = page.get_by_role("alert").filter(has_text="couldn't be opened")
    panel.wait_for(timeout=20000)
    page.keyboard.type("probe")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    assert raw_board(skot) == broken, "the unreadable copy was overwritten"
    with page.expect_download() as download:
        panel.get_by_role("button", name="Download saved copy").click()
    with open(download.value.path(), encoding="utf-8") as f:
        assert f.read() == broken, "the download is not the saved copy"
    panel.get_by_role("button", name="Start a new board").click()
    page.wait_for_selector("[role=application] svg", timeout=30000)
    page.wait_for_function("k => !location.pathname.endsWith(k) && /\\/b\\//.test(location.pathname)",
                           arg=key[len("jev_board_"):])
    assert "jev_board_" + skot.room_id() != key, "the new board reused the stuck board's room"
    type_node(skot, "fresh")
    assert page.evaluate("k => localStorage.getItem(k)", key) == broken, "starting fresh deleted the saved copy"
    evidence.note(over_500=501, morph=3, unreadable="kept")
    assert_no_console_errors(evidence)
