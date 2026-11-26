"""User feedback pass (26 Nov 2026):
1. Blank boards default to Type-only suggestions (element typing works, zero unsolicited next-box ghosts, Tab asks on demand, Full/Off persist).
2. Explicit hamburger Board menu separated from Skot wordmark (which opens My boards) + top-bar Practice pill.
"""
from conftest import assert_no_console_errors, check
from test_features import SUGGESTIONS, THOUGHT_BAR, ghosts, read_options, shot


@check("ux-blank-board-type-only-default")
def test_ux_blank_board_type_only_default(page, skot, evidence):
    skot.new_board()
    btn = page.get_by_test_id("suggestions-mode-btn")
    btn.wait_for(state="visible", timeout=8000)
    assert "Type only" in (btn.get_attribute("aria-label") or ""), btn.get_attribute("aria-label")

    # 1. Typing "api" + Tab completes to "API Gateway" and Enter drops ONLY that element — zero unsolicited next-box ghosts
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    page.keyboard.type("api", delay=20)
    page.keyboard.press("Tab")
    assert bar.input_value() == "API Gateway", f"Expected Tab completion to API Gateway, got {bar.input_value()!r}"
    # No multi-option prediction panel while typing in Type only mode
    assert page.locator(SUGGESTIONS).count() == 0, "Type only must not show unsolicited multi-option cards while typing"
    page.keyboard.press("Enter")
    skot.wait_state(lambda es: len(es) == 1 and es[0].get("label") == "API Gateway", what="API Gateway added")
    page.wait_for_timeout(450)
    assert page.locator(SUGGESTIONS).count() == 0, "Type only must not pop up unsolicited next-box suggestions after adding a node"
    assert ghosts(page) == {"shapes": [], "arrows": []}, f"Expected zero ghosts in Type only, got {ghosts(page)}"
    shot(page, evidence, "ux-blank-board-type-only-default", "1-type-only-quiet")

    # 2. Pressing Tab on empty bar requests suggestions on demand; Escape dismisses them
    page.keyboard.press("Tab")
    opts = read_options(page, wait_s=5.0)
    assert len(opts) >= 1 and opts[0]["active"], f"Tab on demand should show and highlight an option: {opts}"
    shot(page, evidence, "ux-blank-board-type-only-default", "2-tab-on-demand")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    assert page.locator(SUGGESTIONS).count() == 0

    # 3. Switching to Off disables inline word completion too, while typing a plain node still works
    skot.set_suggestions_mode("off")
    bar.click()
    page.keyboard.type("red", delay=20)
    page.keyboard.press("Tab")
    assert bar.input_value() == "red", f"Off mode must not autocomplete 'red', got {bar.input_value()!r}"
    page.keyboard.press("Enter")
    skot.wait_state(lambda es: len([e for e in es if e.get("kind") != "arrow"]) == 2, what="second node added in Off mode")
    page.wait_for_timeout(300)
    assert page.locator(SUGGESTIONS).count() == 0

    # 4. Switching to Full persists across reload and re-enables proactive next-box suggestions
    skot.set_suggestions_mode("full")
    page.reload(wait_until="domcontentloaded")
    page.get_by_test_id("suggestions-mode-btn").wait_for(state="visible", timeout=10000)
    assert "Full" in (page.get_by_test_id("suggestions-mode-btn").get_attribute("aria-label") or "")
    bar = page.get_by_role("textbox", name=THOUGHT_BAR)
    bar.click()
    bar.fill("Postgres")
    page.keyboard.press("Enter")
    opts_full = read_options(page, wait_s=6.0)
    assert len(opts_full) >= 1, "Full mode should proactively suggest next steps after adding a node"
    shot(page, evidence, "ux-blank-board-type-only-default", "3-full-mode")
    assert_no_console_errors(evidence)


@check("ux-topbar-menu-and-practice")
def test_ux_topbar_menu_and_practice(page, skot, evidence):
    skot.new_board()
    menu_btn = page.get_by_test_id("topbar-menu-btn")
    brand_btn = page.get_by_test_id("topbar-brand-btn")
    practice_btn = page.get_by_test_id("topbar-practice-btn")

    menu_btn.wait_for(state="visible", timeout=8000)
    brand_btn.wait_for(state="visible", timeout=8000)
    practice_btn.wait_for(state="visible", timeout=8000)
    assert menu_btn.get_attribute("aria-label") == "Board menu"

    # 1. Explicit hamburger opens the dropdown menu
    menu_btn.click()
    page.get_by_role("menuitem", name="Export Diagram (.svg)").wait_for(state="visible", timeout=4000)
    shot(page, evidence, "ux-topbar-menu-and-practice", "1-hamburger-menu")
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)

    # 2. Clicking Skot wordmark opens My boards (NOT a surprise menu)
    brand_btn.click()
    page.get_by_role("dialog", name="My boards").wait_for(state="visible", timeout=4000)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)

    # 3. Top-bar Practice button opens Practice picker directly without opening the menu
    practice_btn.click()
    page.get_by_role("dialog", name="Practice a problem").wait_for(state="visible", timeout=4000)
    shot(page, evidence, "ux-topbar-menu-and-practice", "2-practice-from-topbar")
    page.keyboard.press("Escape")
    assert_no_console_errors(evidence)
