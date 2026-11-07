import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from patchright.async_api import async_playwright

from uploader.ks_uploader.main import _click_visible_publish_confirm
from uploader.ks_uploader import main as kuaishou_main


def test_click_visible_publish_confirm_uses_modal_primary_button():
    async def scenario():
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, channel="chrome")
            page = await browser.new_page()
            await page.set_content(
                """
                <div class="ant-modal-confirm-centered">
                  <button type="button">取消</button>
                  <button type="button" class="ant-btn-primary">确认发布</button>
                </div>
                """
            )
            await page.locator("button.ant-btn-primary").evaluate(
                "button => button.addEventListener('click', () => window.publishConfirmed = true)"
            )

            assert await _click_visible_publish_confirm(page) is True
            assert await page.evaluate("window.publishConfirmed") is True
            await browser.close()

    asyncio.run(scenario())


def test_click_visible_publish_confirm_is_noop_without_modal():
    async def scenario():
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, channel="chrome")
            page = await browser.new_page()
            await page.set_content("<button>发布</button>")

            assert await _click_visible_publish_confirm(page) is False
            await browser.close()

    asyncio.run(scenario())


class KuaishouPrepareTests(unittest.TestCase):
    def test_prepare_only_hands_off_before_clicking_publish(self):
        video = kuaishou_main.KSVideo("标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json", desc="简介", prepare_only=True)
        for method in ("validate_upload_args", "close_guide_overlay", "set_thumbnail", "apply_collection"):
            setattr(video, method, AsyncMock())

        locator = MagicMock()
        locator.count = AsyncMock(return_value=0)
        locator.wait_for = AsyncMock()
        locator.click = AsyncMock()
        locator.first = locator
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_url = AsyncMock()
        page.locator.return_value = locator
        page.keyboard.press = AsyncMock()
        page.keyboard.type = AsyncMock()
        chooser = MagicMock()
        chooser.set_files = AsyncMock()
        chooser_info = MagicMock()
        async def chosen_file():
            return chooser
        chooser_info.value = chosen_file()
        page.expect_file_chooser.return_value.__aenter__ = AsyncMock(return_value=chooser_info)
        page.expect_file_chooser.return_value.__aexit__ = AsyncMock()
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        context.storage_state = AsyncMock()
        context.close = AsyncMock()
        browser = MagicMock()
        browser.new_context = AsyncMock(return_value=context)
        browser.is_connected.return_value = True
        browser.close = AsyncMock()
        playwright = MagicMock()
        playwright.chromium.launch = AsyncMock(return_value=browser)

        with (
            patch.object(kuaishou_main, "set_init_script", AsyncMock(return_value=context)),
            patch.object(kuaishou_main, "_focus_desc_editor", AsyncMock()),
            patch.object(kuaishou_main, "wait_for_manual_review", AsyncMock()) as handoff,
            patch.object(kuaishou_main.asyncio, "sleep", AsyncMock()),
        ):
            asyncio.run(video.upload(playwright))

        handoff.assert_awaited_once_with(page, browser)
        page.keyboard.type.assert_any_await("标题\n简介")
        page.get_by_text.assert_not_called()
        context.storage_state.assert_awaited_once()
