"""Clean board links and My boards (Charles, 22 Nov 2026). No board may be lost, hidden or written into another.

These run on a server like production (collab off); board-self-host runs on the self-hosted one.
"""
import datetime
import json
import os
import re

import pytest

from conftest import ANALYTICS, REPO, assert_no_console_errors, check, launched_app
from driver import Driver
from test_board_loss import drawn, no_ai, type_node  # noqa: F401 (no_ai is autouse)

with open(os.path.join(REPO, "src", "lib", "jev", "__fixtures__", "prod-storage-e7fe246.json"), encoding="utf-8") as f:
    PROD = json.load(f)
TITLE = "Board title"
PHONE = {"width": 390, "height": 844}
HAS = "l => (document.querySelector('[role=application] svg')?.textContent || '').includes(l)"
STORAGE = "() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))"
THEIR_ID, THEIR_KEY = "A" * 22, "b" * 32


@pytest.fixture(scope="session")
def prod_like(pytestconfig, server):
    if not server["launched"]:
        yield server["base"]
        return
    with launched_app(pytestconfig.getoption("--out"), "vercel-like-server.log", {"VERCEL": "1"}) as base:
        yield base


@pytest.fixture(autouse=True)
def no_beacons(page):
    page.context.route(ANALYTICS, lambda r: r.fulfill(status=200, content_type="text/javascript", body=""))


@pytest.fixture
def app(page, prod_like):
    return Driver(page, prod_like)


@pytest.fixture
def shot(request):
    out = request.config.getoption("--out")
    return lambda page, name: page.screenshot(path=os.path.join(out, "boards-%s.png" % name))


def old(name):
    link = PROD["boards"][name]
    room, key = re.search(r"room=([^&]+)&k=(.+)$", link).groups()
    raw = PROD["storage"].get("jev_board_" + room)
    return {"link": link, "id": room, "key": key, "elements": json.loads(raw)["elements"] if raw else []}


def as_prod_left_it(page, base):
    """Storage exactly as the build before /b/ wrote it, on a clock just after it was written."""
    written = max(json.loads(v).get("baseTimestamp", 0) for k, v in PROD["storage"].items() if k.startswith("jev_board_"))
    page.clock.install(time=datetime.datetime.fromtimestamp(written / 1000 + 60, datetime.timezone.utc))
    page.goto(base + "/api/health")
    page.evaluate("e => Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v))", PROD["storage"])


def at_board(app, board_id):
    app.page.wait_for_function("id => location.pathname.endsWith('/b/' + id)", arg=board_id, timeout=20000)
    app.wait_board()


def is_clean(url):
    return bool(re.search(r"^https?://[^?#]+/b/[A-Za-z0-9_-]{22,}$", url))


def saved(page, board_id):
    raw = page.evaluate("k => localStorage.getItem(k)", "jev_board_" + board_id)
    return json.loads(raw) if raw else None


def labels(page, board_id):
    return sorted(e.get("label") for e in (saved(page, board_id) or {"elements": []})["elements"] if e.get("label"))


def open_menu(page, item):
    page.get_by_role("button", name="Board menu").click()
    entry = page.get_by_role("menuitem", name=item, exact=True)
    entry.wait_for(timeout=5000)
    entry.click()


def my_boards(page):
    open_menu(page, "My boards")
    dialog = page.get_by_role("dialog", name="My boards")
    dialog.wait_for(timeout=5000)
    page.wait_for_timeout(250)  # the open animation
    return dialog


def new_from_menu(app):
    before = app.room_id()
    open_menu(app.page, "New board")
    app.page.wait_for_function(
        "id => /\\/b\\//.test(location.pathname) && !location.pathname.endsWith(id)", arg=before, timeout=20000)
    app.wait_board()
    app.settle(600)
    return app.room_id()


def fits(page, box):
    size = page.viewport_size
    return (box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= size["width"]
            and box["y"] + box["height"] <= size["height"])


@check("board-link")
def test_board_link(page, app, prod_like, evidence, shot):
    board = app.new_board()
    assert is_clean(page.url), "not a clean link: %s" % page.url
    type_node(app, "Linked")
    assert page.evaluate("k => localStorage.getItem(k)", "jev_room_secret_" + board), "the secret was not kept"

    response = page.reload(wait_until="load")
    page.wait_for_function(HAS, arg="Linked", timeout=20000)
    assert is_clean(page.url) and app.room_id() == board
    nonce = re.search(r"'nonce-([^']+)'", response.headers["content-security-policy"]).group(1)
    nonces = page.evaluate("() => [...document.querySelectorAll('script[nonce]')].map(s => s.nonce)")
    assert nonces and set(nonces) == {nonce}, "the CSP nonce did not reach the board route's scripts"
    assert response.headers["referrer-policy"] == "strict-origin"

    preview = "() => [...document.querySelectorAll('meta[property^=\"og:\"], meta[name^=\"twitter:\"]')]" \
              ".map(m => [m.getAttribute('property') || m.getAttribute('name'), m.content]).sort()"
    on_board = page.evaluate(preview)
    assert any(k == "og:image" for k, _ in on_board), "no link preview on /b/<id>"
    assert board not in json.dumps(on_board), "the preview carries the board id"
    shot(page, "link")

    page.goto("%s/b/%s?utm=x#k=%s" % (prod_like, board, THEIR_KEY))
    page.wait_for_function(HAS, arg="Linked", timeout=20000)
    page.wait_for_function("() => !location.search && !location.hash", timeout=10000)

    page.goto(prod_like + "/")
    at_board(app, board)
    page.wait_for_function(HAS, arg="Linked", timeout=20000)
    assert page.evaluate(preview) == on_board
    evidence.note(url=page.url, preview=on_board)
    assert_no_console_errors(evidence)


@check("board-migration")
def test_board_migration(page, app, prod_like, evidence, shot):
    as_prod_left_it(page, prod_like)
    page.goto(prod_like + "/")
    at_board(app, old("latest")["id"])
    page.wait_for_function(HAS, arg="Card Network", timeout=20000)

    rows = my_boards(page).get_by_role("listitem")
    text = "\n".join(rows.all_inner_texts())
    assert rows.count() == len(PROD["boards"]), "My boards hides a board: %s" % text
    for title in ("Payments sketch", "Checkout", "Only a title", "URL shortener"):
        assert title in text
    shot(page, "migrated-list")

    for name in PROD["boards"]:
        board = old(name)
        page.goto("about:blank")  # a fresh arrival by the old bookmark
        page.goto(prod_like + board["link"], wait_until="load")
        at_board(app, board["id"])
        page.wait_for_timeout(1200)  # longer than the save debounce
        assert is_clean(page.url), page.url
        assert drawn(page) == len(board["elements"]), "%s did not draw" % name
        assert page.evaluate("k => localStorage.getItem(k)", "jev_room_secret_" + board["id"]) == board["key"]
        if name == "practice":
            assert page.get_by_role("button", name=re.compile("Review")).count(), "the practice session was lost"
        if name == "checkout":
            shot(page, "migrated-checkout")
            open_menu(page, "Restore earlier copy")
            copies = page.get_by_role("dialog", name="Restore earlier copy").get_by_role("listitem")
            copies.first.wait_for(timeout=5000)
            assert copies.count() >= 2, "saved copies were lost"

    page.goto("about:blank")
    page.goto(prod_like + "/b/" + old("checkout")["id"])
    at_board(app, old("checkout")["id"])
    now = page.evaluate(STORAGE)
    changed = [k for k, v in PROD["storage"].items() if k != "jev_suggestion_feedback_v1" and now.get(k) != v]
    assert not changed, "opening existing boards changed their storage: %s" % changed

    type_node(app, "After the move")
    assert len(saved(page, old("checkout")["id"])["elements"]) == len(old("checkout")["elements"]) + 1
    assert saved(page, old("checkout")["id"])["editedAt"]
    page.goto(prod_like + "/")
    at_board(app, old("checkout")["id"])
    evidence.note(boards=len(PROD["boards"]))
    assert_no_console_errors(evidence)


@check("board-switch")
def test_board_switch(page, app, prod_like, evidence):
    a = app.new_board()
    page.get_by_label(TITLE).fill("Board A")
    type_node(app, "Alpha")
    b = new_from_menu(app)
    assert b != a and drawn(page) == 0
    type_node(app, "Beta")

    # Left inside the 350 ms save debounce.
    page.get_by_label(TITLE).fill("Renamed at the last moment")
    page.go_back()
    at_board(app, a)
    page.wait_for_function(HAS, arg="Alpha", timeout=20000)
    assert saved(page, b)["boardTitle"] == "Renamed at the last moment", "Back lost the last edit"
    assert page.get_by_label(TITLE).input_value() == "Board A"
    assert labels(page, a) == ["Alpha"] and labels(page, b) == ["Beta"]
    page.go_forward()
    at_board(app, b)
    page.wait_for_function(HAS, arg="Beta", timeout=20000)
    assert page.get_by_label(TITLE).input_value() == "Renamed at the last moment"

    # Left with a label still being typed.
    app.settle(700)
    app.click_element("Beta")
    page.keyboard.press("F2")
    editor = app.edit_input()
    editor.fill("Beta edited")
    page.go_back()
    at_board(app, a)
    page.wait_for_function(HAS, arg="Alpha", timeout=20000)
    assert labels(page, b) == ["Beta edited"], "Back lost the label being typed"

    # An old link typed into this tab changes only the fragment, so both entries share one document.
    page.evaluate("h => { location.hash = h }", "room=%s&k=%s" % (b, THEIR_KEY))
    at_board(app, b)
    page.wait_for_function(HAS, arg="Beta edited", timeout=20000)
    page.get_by_label(TITLE).fill("B again")
    page.go_back()
    at_board(app, a)
    page.wait_for_function(HAS, arg="Alpha", timeout=20000)
    page.wait_for_timeout(800)
    assert saved(page, b)["boardTitle"] == "B again"
    assert saved(page, a)["boardTitle"] == "Board A" and labels(page, a) == ["Alpha"], "B was written into A"

    # A page brought back from the back/forward cache shows what is saved, and does not save over it.
    newer = dict(saved(page, a), boardTitle="Edited elsewhere")
    page.evaluate("([k, v]) => localStorage.setItem(k, v)", ["jev_board_" + a, json.dumps(newer)])
    page.evaluate("() => { dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})) }")
    page.wait_for_function("() => document.querySelector('[aria-label=\"Board title\"]')?.value === 'Edited elsewhere'",
                           timeout=20000)
    assert saved(page, a)["boardTitle"] == "Edited elsewhere"
    evidence.note(a=labels(page, a), b=labels(page, b))
    assert_no_console_errors(evidence)


@check("my-boards")
def test_my_boards(page, app, evidence, shot):
    made = []
    for i, title in enumerate(("Oldest", "Middle", "Newest")):
        made.append(app.new_board() if i == 0 else new_from_menu(app))
        page.get_by_label(TITLE).fill(title)
        for n in range(i + 1):
            type_node(app, "%s %d" % (title, n))
    dialog = my_boards(page)
    rows = dialog.get_by_role("listitem")
    assert [t.split("\n")[0].strip() for t in rows.all_inner_texts()] == ["Newest", "Middle", "Oldest"]
    for i, board in enumerate(reversed(made)):
        count = len(saved(page, board)["elements"])
        assert "%d element" % count in rows.nth(i).inner_text()
        assert "Today" in rows.nth(i).inner_text()
    assert rows.nth(0).get_by_role("link").get_attribute("aria-current") == "page"
    shot(page, "list")
    page.keyboard.press("Escape")
    dialog.wait_for(state="hidden")

    # By keyboard alone.
    page.get_by_role("button", name="Board menu").focus()
    page.keyboard.press("Enter")
    page.get_by_role("menuitem", name="My boards").wait_for()
    focus = "() => (document.activeElement.textContent || '').trim()"
    for _ in range(30):
        if page.evaluate(focus) == "My boards":
            break
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(60)
    page.keyboard.press("Enter")
    dialog.wait_for()
    page.wait_for_timeout(250)
    for _ in range(8):
        if page.evaluate(focus).startswith("Oldest"):
            break
        page.keyboard.press("Tab")
    page.keyboard.press("Enter")
    at_board(app, made[0])
    page.wait_for_function(HAS, arg="Oldest 0", timeout=20000)

    page.set_viewport_size(PHONE)
    dialog = my_boards(page)
    assert fits(page, dialog.bounding_box()), "My boards does not fit a phone"
    assert dialog.evaluate("d => d.scrollWidth <= d.clientWidth"), "My boards scrolls sideways"
    row = dialog.get_by_role("link").filter(has_text="Middle")
    assert row.bounding_box()["height"] >= 44
    shot(page, "list-phone")
    row.click()
    at_board(app, made[1])
    page.wait_for_function(HAS, arg="Middle 1", timeout=20000)

    new_from_menu(app)
    assert drawn(page) == 0, "New board is not empty"
    assert my_boards(page).get_by_role("listitem").count() == 4, "the board on screen is not listed"
    evidence.note(boards=4)
    assert_no_console_errors(evidence)


@check("board-two-tabs")
def test_board_two_tabs(page, app, prod_like, evidence):
    a = app.new_board()
    type_node(app, "A One")
    other = page.context.new_page()
    evidence.watch(other, "second tab")
    second = Driver(other, prod_like)
    b = second.new_board()
    type_node(second, "B One")
    for tab, label in ((app, "A Two"), (second, "B Two"), (app, "A Three"), (second, "B Three")):
        tab.page.bring_to_front()
        type_node(tab, label)
    assert labels(page, a) == ["A One", "A Three", "A Two"], labels(page, a)
    assert labels(page, b) == ["B One", "B Three", "B Two"], labels(page, b)

    # The same board twice, still empty when the second tab opens it.
    c = app.new_board()
    other.goto("%s/b/%s" % (prod_like, c))
    at_board(second, c)
    second.settle(700)
    type_node(app, "C First")
    other.wait_for_function(HAS, arg="C First", timeout=15000)
    type_node(second, "C Second")
    page.wait_for_function(HAS, arg="C Second", timeout=15000)
    page.wait_for_timeout(900)
    assert labels(page, c) == ["C First", "C Second"], labels(page, c)
    other.close()
    page.reload()
    page.wait_for_function(HAS, arg="C Second", timeout=20000)
    assert labels(page, a) == ["A One", "A Three", "A Two"], "the tab on C wrote into A"
    evidence.note(a=3, b=3, c=2)


@check("board-unknown")
def test_board_unknown(page, app, prod_like, evidence, shot):
    mine = app.new_board()
    type_node(app, "Mine")
    before = page.evaluate(STORAGE)
    unknown = page.get_by_role("main").filter(has_text="isn't in this browser")
    for link in ("/b/" + THEIR_ID, "/b/not-a-board", "/b/%s#k=%s" % (THEIR_ID, THEIR_KEY),
                 "/#room=%s&k=%s" % (THEIR_ID, THEIR_KEY)):
        page.goto("about:blank")
        page.goto(prod_like + link)
        unknown.wait_for(timeout=20000)
        assert "saved in the browser they were made in" in unknown.inner_text()
        assert not page.locator("[role=application] svg").count(), "an empty board passes for the sender's"
        page.keyboard.type("probe")
        page.wait_for_timeout(700)
        assert page.evaluate(STORAGE) == before, "%s created storage" % link
        assert "#" not in page.url, "the key stayed in the address: %s" % page.url
    shot(page, "unknown")
    page.set_viewport_size(PHONE)
    button = unknown.get_by_role("button", name="New board")
    assert fits(page, button.bounding_box())
    shot(page, "unknown-phone")
    button.focus()
    page.keyboard.press("Enter")
    page.wait_for_function("id => /\\/b\\//.test(location.pathname) && !location.pathname.endsWith(id)", arg=THEIR_ID,
                           timeout=20000)
    app.wait_board()
    assert app.room_id() not in (THEIR_ID, mine) and drawn(page) == 0
    assert labels(page, mine) == ["Mine"]
    evidence.note(new=page.url)
    assert_no_console_errors(evidence)


@check("board-storage-full")
def test_board_storage_full(page, app, evidence):
    a = app.new_board()
    type_node(app, "Kept A")
    b = new_from_menu(app)
    type_node(app, "Kept B")
    before = page.evaluate(STORAGE)
    page.evaluate("""() => {
        let i = 0;
        for (let size = 1 << 20; size >= 1; size >>= 1)
          for (;;) { try { localStorage.setItem('filler_' + i, 'x'.repeat(size)); i++ } catch { break } }
    }""")
    page.get_by_label(TITLE).fill("A change with no room to be saved, longer than what was there before it")
    page.get_by_test_id("board-notice").filter(has_text="Not saved").wait_for(timeout=8000)
    open_menu(page, "New board")
    page.wait_for_timeout(1500)
    assert app.room_id() == b, "left a board that could not be saved"
    assert page.get_by_label(TITLE).input_value().startswith("A change with no room")
    page.get_by_test_id("board-notice").get_by_role("button", name="Dismiss notice").click()
    my_boards(page).get_by_role("link").filter(has_not_text="Open now").first.click()
    page.get_by_role("dialog", name="My boards").wait_for(state="hidden", timeout=5000)
    page.get_by_test_id("board-notice").filter(has_text="Not saved").wait_for(timeout=5000)
    assert app.room_id() == b, "My boards left a board that could not be saved"
    now = page.evaluate(STORAGE)
    lost = [k for k in before if k.startswith("jev_board_") and now.get(k) != before[k]]
    assert not lost, "a full storage cost a board: %s" % lost

    page.evaluate("() => Object.keys(localStorage).filter(k => k.startsWith('filler_'))"
                  ".forEach(k => localStorage.removeItem(k))")
    new_from_menu(app)
    assert saved(page, b)["boardTitle"].startswith("A change with no room"), "the change was dropped on leaving"
    assert labels(page, a) == ["Kept A"]
    evidence.note(boards_kept=2)


@check("board-analytics")
def test_board_analytics(page, app, server, evidence):
    board = app.new_board()
    type_node(app, "Counted")
    page.reload()
    app.wait_board()
    page.wait_for_function("() => (window.vaq || []).some(([t]) => t === 'pageview')", timeout=15000)
    sent = page.evaluate("""() => {
        const scrub = q => (q || []).find(([t]) => t === 'beforeSend')[1];
        return {
          views: window.vaq.filter(([t]) => t === 'pageview').map(([, v]) => v),
          analytics: scrub(window.vaq)({type: 'pageview', url: location.href}).url,
          vitals: scrub(window.siq)({type: 'vital', url: location.href}).url,
          routes: [...document.querySelectorAll('script[data-route]')].map(s => s.dataset.route),
        };
    }""")
    evidence.note(sent=sent)
    assert board not in json.dumps(sent), "analytics would record the board id: %s" % sent
    assert [v["path"] for v in sent["views"]] == ["/b/[id]"] and sent["views"][0]["route"] == "/b/[id]"
    assert sent["analytics"].endswith("/b/[id]") and sent["vitals"].endswith("/b/[id]")
    assert sent["routes"] and set(sent["routes"]) == {"/b/[id]"}


@check("board-self-host")
def test_board_self_host(page, skot, new_page, evidence, base_url, server):
    if not server["launched"]:
        pytest.skip("collaboration is only on when self-hosted: run with --launch")
    board = skot.new_board()
    assert re.search(r"/b/%s#k=[A-Za-z0-9_-]{22,}$" % board, page.url), "the key left the self-hosted link"
    type_node(skot, "Hosted")
    page.get_by_role("banner").locator("button", has_text="P2P").click()
    link = page.get_by_label("Room share URL").input_value()
    assert link == page.url, "the share link is not the board's link"
    room, key = re.search(r"/b/([^#]+)#k=(.+)$", link).groups()
    for who, url in (("guest", link), ("old-link guest", "%s/#room=%s&k=%s" % (base_url, room, key))):
        guest = new_page(who)
        guest.goto(url)
        guest.wait_for_function(HAS, arg="Hosted", timeout=30000)
        assert guest.url == link
    stranger = new_page("no key")
    stranger.goto("%s/b/%s" % (base_url, room))
    stranger.get_by_role("main").filter(has_text="isn't in this browser").wait_for(timeout=20000)
    evidence.note(link=link.split("#")[0])
