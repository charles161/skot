"""Charles's answers to the round-2 decision list (22 Nov 2026, 15:03 IST): "A".

1A  Enter on the empty bar accepts only a connection of the node just added. Any other suggestion needs Tab first.
5A  On a phone the text stays readable and the view pans to the newest node; it does not zoom out to fit the board.
8A  When a Fork take renames the selected node, its arrows stay on that node (test_fork_rename.py).
"""
from conftest import assert_no_console_errors, check
from driver import is_shape
from test_core_loop import ai, arrows_named, bar_of, board, by_creation, type_enter  # noqa: F401 (ai is a fixture)
from test_features import SUGGESTIONS, ghosts, read_options, shot

KEY_LEGEND = SUGGESTIONS + " [data-key-legend]"


def labels(skot):
    return [e["label"] for e in by_creation(skot.elements())]


def legend(page):
    return " ".join(page.locator(KEY_LEGEND).inner_text().split())


def highlighted(page):
    return [o["title"] for o in read_options(page) if o["active"]]


@check("enter-needs-pick")
def test_enter_needs_pick(page, skot, evidence, ai):
    ai(page, "ok")
    skot.new_board()

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
    # More Enters accept further connections of Postgres at most; they never add a node.
    for _ in range(3):
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
    els = skot.elements()
    assert len([e for e in els if is_shape(e)]) == 3, "Enter after the connection added nodes: %s" % labels(skot)
    extra = [a for a in arrows_named(els) if a not in before and "Postgres" not in a]
    assert not extra, "Enter added arrows that are not connections of the node just added: %s" % extra

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
    assert len([e for e in els if is_shape(e)]) == 3 and len(arrows_named(els)) == n_arrows, \
        "Enter after a click added something: %s %s" % (labels(skot), arrows_named(els))
    evidence.note(nodes=labels(skot), arrows=arrows_named(els))
    assert_no_console_errors(evidence)
