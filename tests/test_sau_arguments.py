import unittest

from sau_commands.arguments import parse_tags


class ParseTagsTests(unittest.TestCase):
    def test_chinese_and_english_commas(self):
        self.assertEqual(parse_tags(" #旅行，摄影, 美食 ， #城市 "), ["旅行", "摄影", "美食", "城市"])


if __name__ == "__main__":
    unittest.main()
