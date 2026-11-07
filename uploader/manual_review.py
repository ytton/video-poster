"""Keep a prepared upload page open for manual review."""

import asyncio


async def wait_for_manual_review(page, browser) -> None:
    finished = asyncio.Event()
    page.on("close", lambda _: finished.set())
    browser.on("disconnected", lambda _: finished.set())
    if not page.is_closed() and browser.is_connected():
        await finished.wait()
