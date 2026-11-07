# Language: 中文
import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from uploader.douyin_uploader import main as douyin_main
from uploader.douyin_uploader.main import DouYinVideo
from uploader.manual_review import wait_for_manual_review


class DouyinDeclarationTests(unittest.TestCase):
    def test_review_window_stays_open_until_user_closes_it(self):
        async def scenario():
            callbacks = {}
            page = MagicMock()
            page.is_closed.return_value = False
            page.on.side_effect = lambda event, callback: callbacks.setdefault("page", callback)
            browser = MagicMock()
            browser.is_connected.return_value = True
            browser.on.side_effect = lambda event, callback: callbacks.setdefault("browser", callback)
            pending = asyncio.create_task(wait_for_manual_review(page, browser))
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            callbacks["page"](page)
            await pending

        asyncio.run(scenario())

    def test_upload_only_sets_explicit_declaration(self):
        video = DouYinVideo(
            "标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json",
            declaration="已确认声明原文",
        )
        self.assertEqual(video.declaration, "已确认声明原文")

    def test_missing_declaration_does_not_fall_back_to_personal_opinion(self):
        video = DouYinVideo("标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json")
        self.assertIsNone(video.declaration)

    def test_legacy_positional_runtime_flags_keep_their_meaning(self):
        video = DouYinVideo(
            "标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json",
            None, "", "", None, "",
            "scheduled", False, False,
        )
        self.assertEqual(video.publish_strategy, "scheduled")
        self.assertFalse(video.debug)
        self.assertFalse(video.headless)
        self.assertIsNone(video.declaration)

    def test_apply_declaration_skips_when_unspecified(self):
        video = DouYinVideo("标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json")
        video.set_self_declaration = AsyncMock()
        asyncio.run(video.apply_self_declaration(object()))
        video.set_self_declaration.assert_not_awaited()

    def test_apply_declaration_uses_exact_explicit_text(self):
        page = object()
        video = DouYinVideo(
            "标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json",
            declaration="已确认声明原文",
        )
        video.set_self_declaration = AsyncMock(return_value=True)
        asyncio.run(video.apply_self_declaration(page))
        video.set_self_declaration.assert_awaited_once_with(page, "已确认声明原文")

    def test_explicit_declaration_failure_blocks_publish(self):
        video = DouYinVideo(
            "标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json",
            declaration="已确认声明原文",
        )
        video.set_self_declaration = AsyncMock(return_value=False)
        with self.assertRaisesRegex(RuntimeError, "自主声明"):
            asyncio.run(video.apply_self_declaration(object()))

    def test_declaration_failure_closes_browser_resources(self):
        video = DouYinVideo(
            "标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json",
            declaration="已确认声明原文",
        )
        video.validate_upload_args = AsyncMock()
        video.fill_title_and_description = AsyncMock()
        video.set_thumbnail = AsyncMock()
        video.apply_self_declaration = AsyncMock(side_effect=RuntimeError("抖音自主声明设置失败"))

        locator = MagicMock()
        locator.set_input_files = AsyncMock()
        locator.count = AsyncMock(return_value=1)
        locator.wait_for = AsyncMock()
        locator.first = locator
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_url = AsyncMock()
        page.wait_for_timeout = AsyncMock()
        page.wait_for_selector = AsyncMock()
        page.locator.return_value = locator

        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        context.close = AsyncMock(side_effect=OSError("close failed"))
        browser = MagicMock()
        browser.new_context = AsyncMock(return_value=context)
        browser.close = AsyncMock()
        playwright = MagicMock()
        playwright.chromium.launch = AsyncMock(return_value=browser)

        with (
            patch.object(douyin_main, "set_init_script", AsyncMock(return_value=context)),
            patch.object(douyin_main.asyncio, "sleep", AsyncMock()),
            self.assertRaisesRegex(RuntimeError, "自主声明"),
        ):
            asyncio.run(video.upload(playwright))

        context.close.assert_awaited_once()
        browser.close.assert_awaited_once()

    def test_prepare_only_hands_off_before_clicking_publish(self):
        video = DouYinVideo("标题", "/tmp/demo.mp4", [], 0, "/tmp/cookie.json", prepare_only=True)
        for method in ("validate_upload_args", "fill_title_and_description", "apply_self_declaration", "apply_collection", "set_thumbnail"):
            setattr(video, method, AsyncMock())

        locator = MagicMock()
        locator.count = AsyncMock(return_value=1)
        locator.wait_for = AsyncMock()
        locator.set_input_files = AsyncMock()
        locator.first = locator
        page = MagicMock()
        page.goto = AsyncMock()
        page.wait_for_url = AsyncMock()
        page.wait_for_timeout = AsyncMock()
        page.locator.return_value = locator
        page.eval_on_selector = AsyncMock(return_value="semi-switch-checked")
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        context.storage_state = AsyncMock()
        browser = MagicMock()
        browser.new_context = AsyncMock(return_value=context)
        browser.is_connected.return_value = True
        browser.close = AsyncMock()
        playwright = MagicMock()
        playwright.chromium.launch = AsyncMock(return_value=browser)

        with (
            patch.object(douyin_main, "set_init_script", AsyncMock(return_value=context)),
            patch.object(douyin_main, "wait_for_manual_review", AsyncMock()) as handoff,
            patch.object(douyin_main.asyncio, "sleep", AsyncMock()),
        ):
            asyncio.run(video.upload(playwright))

        handoff.assert_awaited_once_with(page, browser)
        page.get_by_role.assert_not_called()
        context.storage_state.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
