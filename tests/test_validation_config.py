from unittest import TestCase

from zimage_trainer.config import validation_prompts


class ValidationPromptTests(TestCase):
    def test_multiple_prompts_are_trimmed_and_empty_values_are_ignored(self):
        self.assertEqual(
            validation_prompts(
                {
                    "prompts": [" first prompt ", "", " second prompt "],
                    "prompt": "legacy prompt",
                }
            ),
            ["first prompt", "second prompt"],
        )

    def test_legacy_prompt_is_used_as_a_fallback(self):
        self.assertEqual(
            validation_prompts({"prompt": " legacy prompt "}),
            ["legacy prompt"],
        )

    def test_empty_configuration_has_no_validation_prompts(self):
        self.assertEqual(validation_prompts({"prompts": [], "prompt": ""}), [])
