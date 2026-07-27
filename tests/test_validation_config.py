from unittest import TestCase

from zimage_trainer.config import validation_prompts, validation_samples


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

    def test_each_sample_keeps_its_own_dimensions(self):
        self.assertEqual(
            validation_samples(
                {
                    "samples": [
                        {"prompt": "square", "width": 768, "height": 768},
                        {"prompt": "portrait", "width": 672, "height": 896},
                    ]
                }
            ),
            [
                {"prompt": "square", "width": 768, "height": 768},
                {"prompt": "portrait", "width": 672, "height": 896},
            ],
        )

    def test_legacy_prompts_use_global_dimensions(self):
        self.assertEqual(
            validation_samples(
                {
                    "prompts": ["landscape"],
                    "width": 1024,
                    "height": 576,
                }
            ),
            [{"prompt": "landscape", "width": 1024, "height": 576}],
        )
