import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import sau_cli
from uploader.alipay_uploader.main import AlipayVideo


class PrepareOnlyContractTests(unittest.TestCase):
    def test_browser_upload_commands_force_visible_review(self):
        commands = {
            "xiaohongshu": "sau_commands.xiaohongshu.upload_xiaohongshu_video",
            "alipay": "sau_commands.alipay.upload_alipay_video",
            "weibo": "sau_commands.weibo.upload_weibo_video",
            "hupu": "sau_commands.hupu.upload_hupu_video",
            "baijiahao": "sau_commands.baijiahao.upload_baijiahao_video",
            "youtube": "sau_commands.youtube.upload_youtube_video",
            "facebook": "sau_commands.facebook.upload_facebook_video",
            "facebook-page": "sau_commands.facebook_page.upload_meta_content",
            "instagram": "sau_commands.instagram.upload_instagram_content",
        }
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / "video.mp4"
            video.write_bytes(b"test video")
            parser = sau_cli.build_parser()
            for platform, target in commands.items():
                with self.subTest(platform=platform):
                    args = parser.parse_args([
                        platform, "upload-video", "--account", "creator", "--file", str(video),
                        "--title", "视频标题", "--headless", "--prepare-only",
                    ])
                    with patch(target, new=AsyncMock(return_value={})) as upload:
                        asyncio.run(sau_cli.dispatch(args))
                    request = upload.await_args.args[0]
                    self.assertTrue(request.prepare_only)
                    self.assertFalse(request.headless)

    def test_alipay_prepare_stops_before_submit(self):
        app = AlipayVideo("标题", "video.mp4", [], "account.json", prepare_only=True, headless=False)
        for name in (
            "validate_upload_args", "open_upload_page", "upload_video_file", "fill_title_and_tags",
            "fill_description", "upload_thumbnail", "apply_collection", "check_ai_label",
            "wait_for_upload_complete", "submit_publish",
        ):
            setattr(app, name, AsyncMock())
        page = MagicMock()
        context = MagicMock()
        browser = MagicMock()
        playwright = MagicMock()
        playwright.chromium.launch = AsyncMock(return_value=browser)
        browser.new_context = AsyncMock(return_value=context)
        browser.close = AsyncMock()
        context.grant_permissions = AsyncMock()
        context.new_page = AsyncMock(return_value=page)
        context.storage_state = AsyncMock()
        context.close = AsyncMock()
        with patch("uploader.alipay_uploader.main.wait_for_manual_review", new=AsyncMock()) as review:
            asyncio.run(app.upload(playwright))
        review.assert_awaited_once_with(page, browser)
        app.submit_publish.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
