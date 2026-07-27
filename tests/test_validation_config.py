from unittest import TestCase

from zimage_trainer.config import validation_samples


class ValidationSampleTests(TestCase):
    def test_samples_are_trimmed_and_keep_independent_dimensions(self):
        self.assertEqual(
            validation_samples(
                {
                    "samples": [
                        {
                            "prompt": " square ",
                            "width": 768,
                            "height": 768,
                        },
                        {
                            "prompt": " portrait ",
                            "width": 672,
                            "height": 896,
                        },
                    ]
                }
            ),
            [
                {"prompt": "square", "width": 768, "height": 768},
                {"prompt": "portrait", "width": 672, "height": 896},
            ],
        )

    def test_empty_samples_are_allowed_when_validation_is_disabled(self):
        self.assertEqual(validation_samples({"samples": []}), [])

    def test_string_prompt_entries_are_rejected(self):
        with self.assertRaisesRegex(
            ValueError,
            "each sample must be an object",
        ):
            validation_samples({"samples": ["prompt"]})

    def test_dimensions_are_required_per_sample(self):
        with self.assertRaisesRegex(
            ValueError,
            "each sample requires prompt, width, and height",
        ):
            validation_samples({"samples": [{"prompt": "missing dimensions"}]})
