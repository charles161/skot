"""Feature-verification suite: one user-level check per feature in verify/features.yml.

  python -m pytest verify/features --launch                 # build first; starts `next start` itself
  python -m pytest verify/features --base-url URL           # attach to a running app
  python -m pytest verify/features --base-url https://skot.lightslips.ai --subset prod   # read-only subset

Evidence for every check: verify/out/<check>.png and one JSON line in verify/out/results.jsonl.
"""
import contextlib
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from driver import VIEWPORT, Driver  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
MANIFEST = os.path.join(REPO, "verify", "features.yml")
ANALYTICS = re.compile(r"/_vercel/(insights|speed-insights)/")


def pytest_addoption(parser):
    g = parser.getgroup("skot")
    g.addoption("--base-url", default=os.environ.get("SKOT_URL"), help="app to verify (default $SKOT_URL)")
    g.addoption("--launch", action="store_true", help="start `next start` from this checkout on a free port")
    g.addoption("--subset", choices=["all", "prod"], default="all",
                help="prod = only features marked prod: true (read-only, no AI calls)")
    g.addoption("--out", default=os.path.join(REPO, "verify", "out"), help="evidence directory")
    g.addoption("--long-running", action="store_true",
                help="the attached server is one long-running process (enables needs: long-running-server)")


def pytest_configure(config):
    config.addinivalue_line("markers", "check(id): the feature check id from verify/features.yml")


def load_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        doc = yaml.safe_load(f)
    return {f["check"]: f for f in doc["features"]}


def check(check_id):
    return pytest.mark.check(check_id)


def _check_id(item):
    m = item.get_closest_marker("check")
    return m.args[0] if m else None


def pytest_collection_modifyitems(config, items):
    manifest = load_manifest()
    ids = [_check_id(i) for i in items]
    unknown = sorted({c for c in ids if c and c not in manifest} | {i.nodeid for i, c in zip(items, ids) if not c})
    missing = sorted(set(manifest) - set(ids))
    if unknown or missing:
        raise pytest.UsageError("verify/features.yml and the checks disagree. Not in the manifest: %s. "
                                "No check implemented: %s" % (unknown, missing))
    keep, drop = [], []
    for item in items:
        feat = manifest[_check_id(item)]
        if config.getoption("--subset") == "prod" and not feat.get("prod"):
            drop.append(item)
            continue
        if feat.get("known_failure"):
            item.add_marker(pytest.mark.xfail(strict=True, reason="known failure: " + feat["known_failure"]))
        if feat.get("needs") == "long-running-server" and not (
                config.getoption("--launch") or config.getoption("--long-running")):
            item.add_marker(pytest.mark.skip(reason=(
                "needs one long-running server: signaling rooms live in one process's memory, and on Vercel "
                "each request can land on a different serverless instance. Runs in the gate (--launch).")))
        keep.append(item)
    if drop:
        config.hook.pytest_deselected(items=drop)
        items[:] = keep


# ------------------------------------------------------------------ server

def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _healthy(url):
    try:
        with urllib.request.urlopen(url + "/api/health", timeout=3) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


@pytest.fixture(scope="session")
def server(pytestconfig):
    """Base URL of the app under test, launching `next start` from this checkout when --launch is given."""
    out = pytestconfig.getoption("--out")
    os.makedirs(out, exist_ok=True)
    if not pytestconfig.getoption("--launch"):
        base = pytestconfig.getoption("--base-url")
        if not base:
            raise pytest.UsageError("pass --launch, or --base-url URL (or set SKOT_URL)")
        yield {"base": base.rstrip("/"), "launched": False}
        return
    if not os.path.isdir(os.path.join(REPO, ".next")):
        raise pytest.UsageError("no .next build in %s: run `pnpm build` before --launch" % REPO)
    with launched_app(out, "server.log", {}) as base:
        yield {"base": base, "launched": True}


@contextlib.contextmanager
def launched_app(out, log_name, extra_env):
    """A `next start` from this checkout on a free port of 127.0.0.1; stopped by the PID this started."""
    port = _free_port()
    base = "http://127.0.0.1:%d" % port
    # TRUST_PROXY=cloudflare makes the server key its per-IP limits on CF-Connecting-IP, so each check
    # can act as its own visitor (the `page` fixture sets a distinct one) instead of all checks sharing
    # one loopback IP's signaling and rank budgets.
    env = dict(os.environ, NODE_ENV="production", TRUST_PROXY="cloudflare", NEXT_TELEMETRY_DISABLED="1")
    env.update(extra_env)
    log = open(os.path.join(out, log_name), "w")
    proc = subprocess.Popen(["pnpm", "exec", "next", "start", "-p", str(port), "-H", "127.0.0.1"], cwd=REPO,
                            env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        deadline = time.time() + 90
        while not _healthy(base):
            if proc.poll() is not None:
                raise RuntimeError("next start exited with %s; see %s" % (proc.returncode, log.name))
            if time.time() > deadline:
                raise RuntimeError("next start not healthy after 90 s; see %s" % log.name)
            time.sleep(0.5)
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)  # the process group this started, by PID
            proc.wait(timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


@pytest.fixture(scope="session")
def base_url(server):
    return server["base"]


# ------------------------------------------------------------------ browser + evidence

@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        yield b
        b.close()


class Evidence:
    """Facts a check records about what it saw; written to results.jsonl with the outcome."""

    def __init__(self):
        self.facts = {}
        self.pages = []
        self.events = []

    def note(self, **kw):
        self.facts.update(kw)

    def watch(self, page, who="page"):
        def rec(kind, text):
            self.events.append({"who": who, "kind": kind, "text": text[:500]})
        page.on("console", lambda m: rec("console.error", m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: rec("pageerror", str(e)))
        # ERR_ABORTED is a request the page cancelled itself (navigation, AbortController on dismiss).
        page.on("requestfailed", lambda r: rec("requestfailed", "%s %s" % (r.failure, r.url))
                if "ERR_ABORTED" not in (r.failure or "") else None)
        page.on("response", lambda r: rec("http", "%d %s" % (r.status, r.url)) if r.status >= 400 else None)
        self.pages.append(page)

    def errors(self):
        return list(self.events)


_visitor = iter(range(1, 1_000_000))


def _new_page(browser, server, ev, who="page"):
    headers = {}
    if server["launched"]:
        n = next(_visitor)
        headers["CF-Connecting-IP"] = "198.18.%d.%d" % (n // 250, n % 250 + 1)
    ctx = browser.new_context(viewport=VIEWPORT, extra_http_headers=headers, accept_downloads=True)
    if not server["launched"]:
        # Keep synthetic runs out of the production Web Analytics / Speed Insights numbers.
        ctx.route(ANALYTICS, lambda route: route.fulfill(status=200, content_type="text/javascript", body=""))
    page = ctx.new_page()
    ev.watch(page, who)
    return page


@pytest.fixture
def evidence():
    return Evidence()


@pytest.fixture
def page(browser, server, evidence):
    p = _new_page(browser, server, evidence)
    yield p
    p.context.close()


@pytest.fixture
def new_page(browser, server, evidence):
    """Factory for extra visitors (two-person sync): each gets its own context and client IP."""
    made = []

    def make(who):
        p = _new_page(browser, server, evidence, who)
        made.append(p)
        return p
    yield make
    for p in made:
        p.context.close()


@pytest.fixture
def skot(page, base_url):
    return Driver(page, base_url)


def assert_no_console_errors(evidence):
    errs = evidence.errors()
    assert not errs, "console errors, page errors or failed requests: %s" % json.dumps(errs[:8], indent=1)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    cid = _check_id(item)
    if not cid:
        return
    if rep.when == "call" or (rep.when == "setup" and rep.outcome != "passed"):
        ev = item.funcargs.get("evidence")
        out = item.config.getoption("--out")
        os.makedirs(out, exist_ok=True)
        shots = []
        for i, pg in enumerate(ev.pages if ev else []):
            path = os.path.join(out, "%s%s.png" % (cid, "" if i == 0 else "-%d" % (i + 1)))
            try:
                pg.screenshot(path=path)
                shots.append(os.path.relpath(path, REPO))
            except Exception as e:  # page already closed or crashed: record why there is no picture
                shots.append("unavailable: %s" % str(e).split("\n")[0])
        status = rep.outcome
        if hasattr(rep, "wasxfail"):
            status = "xfailed" if rep.skipped else "xpassed-strict-fail"
        srv = item.funcargs.get("server") or {}
        row = {
            "check": cid,
            "status": status,
            "duration_s": round(rep.duration, 2),
            "base_url": srv.get("base") or item.config.getoption("--base-url"),
            "commit": os.environ.get("GITHUB_SHA") or _git_head(),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "screenshots": shots,
            "facts": ev.facts if ev else {},
            "console_errors": ev.errors() if ev else [],
        }
        if rep.failed or hasattr(rep, "wasxfail"):
            text = str(rep.longrepr)
            e_lines = [ln[1:].strip() for ln in text.splitlines() if ln.startswith("E ")]
            row["reason"] = (getattr(rep, "wasxfail", "") or "\n".join(e_lines[:12]) or text[-1500:])[:2000]
        if rep.skipped and not hasattr(rep, "wasxfail"):
            row["reason"] = str(rep.longrepr[2]) if isinstance(rep.longrepr, tuple) else str(rep.longrepr)
        with open(os.path.join(out, "results.jsonl"), "a") as f:
            f.write(json.dumps(row) + "\n")


def _git_head():
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def pytest_sessionstart(session):
    out = session.config.getoption("--out")
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "results.jsonl")
    if os.path.exists(path):
        os.remove(path)
