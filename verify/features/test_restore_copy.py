"""Board menu > Restore earlier copy: the way back from the 22 Nov 2026 board loss, without a console."""
import json
import os

import pytest

from conftest import assert_no_console_errors, check
from test_board_loss import drawn, element, no_ai, reopen, type_node  # noqa: F401 (no_ai is autouse)

TITLE = "Board title"


def storage(skot, name):
    return skot.page.evaluate("k => localStorage.getItem(k)", "jev_%s_%s" % (name, skot.room_id()))


def put(skot, name, value):
    skot.page.evaluate("([k, v]) => localStorage.setItem(k, v)",
                       ["jev_%s_%s" % (name, skot.room_id()), json.dumps(value)])


def saved_copy(at, elements, title="Older"):
    return {"id": "rec_%d" % at, "savedAt": at, "reason": "periodic", "removedCount": 0,
            "previousElementCount": min(len(elements), 500),
            "snapshot": {"elements": elements, "boardTitle": title, "hasLocalEdits": True}}


def menu_item(page):
    return page.get_by_role("menuitem", name="Restore earlier copy")


def open_menu(page):
    page.get_by_role("button", name="Board menu").click()
    menu_item(page).wait_for(timeout=5000)
    return menu_item(page)


def open_copies(page):
    open_menu(page).click()
    return copies_dialog(page)


def copies_dialog(page):
    dialog = page.get_by_role("dialog", name="Restore earlier copy")
    dialog.wait_for(timeout=5000)
    page.wait_for_timeout(250)  # the open animation
    return dialog


def focused(page):
    return page.evaluate("() => document.activeElement.textContent")


@pytest.fixture
def shot(request):
    out = request.config.getoption("--out")
    return lambda page, name: page.screenshot(path=os.path.join(out, "restore-%s.png" % name))


@check("restore-earlier-copy")
def test_restore_earlier_copy(page, skot, evidence, shot):
    page.clock.install()
    skot.new_board()
    item = open_menu(page)
    assert item.get_attribute("aria-disabled") == "true", "nothing is saved yet, but the item is live"
    assert "No earlier copy saved" in item.inner_text()
    shot(page, "0-none")
    page.keyboard.press("Escape")

    # A real snapshot: edits, then the app's own 2-minute timer.
    page.get_by_label(TITLE).fill("Checkout")
    for name in ("Gateway", "Orders", "Ledger"):
        type_node(skot, name)
    full = len(skot.elements())
    assert full >= 3
    page.clock.fast_forward(140_000)
    page.wait_for_function("k => !!localStorage.getItem(k)", arg="jev_recovery_" + skot.room_id(), timeout=10000)
    newest = json.loads(storage(skot, "recovery"))
    assert len(newest[0]["snapshot"]["elements"]) == full

    # Seven older ones, so the 8 are full: one more save would push one out.
    at = newest[0]["savedAt"]
    older = [saved_copy(at - i * 120_000, [element(n) for n in range(12 if i == 5 else 2)], "Older %d" % i)
             for i in range(1, 8)]
    put(skot, "recovery", newest + older)
    eight = storage(skot, "recovery")

    skot.clear()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    skot.wait_state(lambda els: not els, what="the delete")
    page.get_by_label(TITLE).fill("Shrunk")
    type_node(skot, "Leftover")
    skot.wait_state(lambda els: len(els) == 1, what="the shrunk board")
    shot(page, "1-shrunk")

    # Looking costs nothing.
    dialog = open_copies(page)
    rows = dialog.get_by_role("listitem")
    assert rows.count() == 8
    assert "Newest" in rows.nth(0).inner_text() and "%d elements" % full in rows.nth(0).inner_text()
    assert "Fullest" in rows.nth(5).inner_text() and "12 elements" in rows.nth(5).inner_text()
    shot(page, "2-list")
    page.keyboard.press("Escape")
    dialog.wait_for(state="hidden")
    assert storage(skot, "recovery") == eight, "opening the list changed the saved copies"
    assert storage(skot, "before_restore") is None, "opening the list saved a copy"

    # By keyboard alone, with a node selected: Enter on the Board menu opens it rather than renaming the node.
    skot.click_element("Leftover")
    skot.suggestions_region().wait_for(timeout=10000)
    page.keyboard.press("Escape")  # takes the suggestions away, not the selection
    page.get_by_role("button", name="Board menu").focus()
    page.keyboard.press("Enter")
    menu_item(page).wait_for()
    for _ in range(25):
        if "Restore earlier copy" in focused(page) and page.evaluate(
                "() => document.activeElement.getAttribute('role') === 'menuitem'"):
            break
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(60)
    page.keyboard.press("Enter")
    copies_dialog(page)
    assert "Newest" in focused(page), "the newest copy is not focused first"
    page.keyboard.press("Tab")
    assert "Older 1" in focused(page), "Tab does not move through the copies"
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Enter")
    skot.wait_state(lambda els: len(els) == full, what="the restore")
    assert page.get_by_label(TITLE).input_value() == "Checkout"
    assert storage(skot, "recovery") == eight, "restoring changed the 8 saved copies"
    kept = json.loads(storage(skot, "before_restore"))
    assert [e["label"] for e in kept[0]["snapshot"]["elements"]] == ["Leftover"], "the replaced board was not kept"
    page.wait_for_timeout(500)
    shot(page, "3-restored")

    page.keyboard.press("Control+z")
    els = skot.wait_state(lambda els: len(els) == 1, what="one undo")
    assert els[0]["label"] == "Leftover"
    assert page.get_by_label(TITLE).input_value() == "Shrunk", "undo left the restored title"
    shot(page, "4-undone")
    page.clock.fast_forward(140_000)
    page.wait_for_timeout(500)
    assert storage(skot, "recovery") == eight, "restore and undo pushed a good copy out of the 8"
    page.keyboard.press("Control+Shift+z")
    skot.wait_state(lambda els: len(els) == full, what="redo")
    reopen(page)
    assert drawn(page) == full, "the restored board did not survive a reload"

    # On a phone.
    page.set_viewport_size({"width": 390, "height": 844})
    dialog = open_copies(page)
    box = dialog.bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 390 and box["y"] >= 0 and box["y"] + box["height"] <= 844
    assert dialog.evaluate("d => d.scrollWidth <= d.clientWidth"), "the list scrolls sideways"
    row = dialog.get_by_role("button").filter(has_text="Fullest")
    assert row.bounding_box()["height"] >= 44
    shot(page, "5-phone")
    row.click()
    skot.wait_state(lambda els: len(els) == 12, what="the restore on a phone")
    page.wait_for_timeout(500)
    shot(page, "6-phone-restored")
    evidence.note(snapshot=full, copies=8)
    assert_no_console_errors(evidence)


@check("restore-copy-tolerant")
def test_restore_copy_tolerant(page, skot, evidence, shot):
    skot.new_board()
    type_node(skot, "Leftover")
    broken = {"id": "rec_broken", "savedAt": 2, "snapshot": {"elements": [{"id": "cut short"}]}}
    put(skot, "recovery", [broken, saved_copy(1, [element(i) for i in range(501)])])
    was = storage(skot, "recovery")

    skot.suggestions_region().wait_for(timeout=10000)
    dialog = open_copies(page)
    shot(page, "7-unreadable")
    # The board's suggestions are showing behind the list: Tab and Enter are still the list's.
    assert "501 elements" in focused(page)
    page.keyboard.press("Tab")
    assert "Download" in focused(page), "Tab went to the suggestions behind the list"
    with page.expect_download() as download:
        dialog.get_by_role("button", name="Download").click()
    with open(download.value.path(), encoding="utf-8") as f:
        assert json.load(f) == broken, "the download is not the unreadable copy"
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Enter")
    skot.wait_state(lambda els: len(els) == 501, what="all 501 to come back")
    assert storage(skot, "recovery") == was, "the unreadable copy was touched"
    reopen(page)
    assert drawn(page) == 501, "the restored 501 did not survive a reload"
    evidence.note(restored=501, unreadable="kept")
    assert_no_console_errors(evidence)
