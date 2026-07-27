from unittest import TestCase

from zimage_trainer.suggestions import training_plans


class TrainingPlanTests(TestCase):
    def test_small_dataset_gets_more_exposures_per_image(self):
        small = training_plans(5, 1024)["recommended"]
        medium = training_plans(50, 1024)["recommended"]

        self.assertEqual(small["exposures_per_image"], 120)
        self.assertEqual(medium["exposures_per_image"], 60)

    def test_large_dataset_is_bounded(self):
        plan = training_plans(1000, 1024)["recommended"]

        self.assertEqual(plan["steps"], 6000)
        self.assertEqual(plan["exposures_per_image"], 6)

    def test_quick_plan_is_short_and_uses_same_safe_resolution(self):
        plans = training_plans(15, 900)

        self.assertEqual(plans["recommended"]["steps"], 1200)
        self.assertEqual(plans["recommended"]["exposures_per_image"], 80)
        self.assertEqual(plans["quick"]["steps"], 50)
        self.assertEqual(plans["quick"]["resolution"], 768)
        self.assertEqual(plans["quick"]["rank"], 8)

    def test_low_resolution_source_images_use_512(self):
        plans = training_plans(20, 512)

        self.assertEqual(plans["recommended"]["resolution"], 512)
        self.assertEqual(plans["quick"]["resolution"], 512)
