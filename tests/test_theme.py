"""Checks that keep the accessibility properties of the theme Urple."""

import itertools
import json
import math
from pathlib import Path
import re
import unittest


THEME = Path(__file__).resolve().parents[1] / "themes/urple.json"
# The background color of the terminal in which the user approved the colors.
REFERENCE_BACKGROUND = "#201d2a"

# Simulation matrices for dichromacy (severity 1.0), for linear RGB.
# Source: Machado, Oliveira, and Fernandes, "A Physiologically-based Model for
# Simulation of Color Vision Deficiency", IEEE TVCG 15(6), 2009, Table 1 of
# https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
CVD_MATRICES = {
    "protanopia": (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    "deuteranopia": (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881),
    ),
    "tritanopia": (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900),
    ),
}


def linear_rgb(color):
    """Return the linear RGB channels of a '#rrggbb' color.

    Source: the definition of "relative luminance" in WCAG 2.2,
    https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
    """
    channels = (int(color[index:index + 2], 16) / 255 for index in (1, 3, 5))
    return tuple(
        channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4
        for channel in channels
    )


def contrast_ratio(first, second):
    """Return the WCAG 2 contrast ratio of two '#rrggbb' colors.

    Source: the definitions of "relative luminance" and "contrast ratio" in
    WCAG 2.2, https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
    """
    luminances = []
    for color in (first, second):
        red, green, blue = linear_rgb(color)
        luminances.append(0.2126 * red + 0.7152 * green + 0.0722 * blue)
    return (max(luminances) + 0.05) / (min(luminances) + 0.05)


def multiply(matrix, vector):
    return tuple(sum(a * b for a, b in zip(row, vector)) for row in matrix)


def simulate(matrix, rgb):
    """Return the linear RGB color that a display shows for the simulation."""
    # A display cannot show a channel value outside the range 0 to 1.
    return tuple(min(1.0, max(0.0, value)) for value in multiply(matrix, rgb))


def oklab(rgb):
    """Return the OKLab coordinates of a linear RGB color.

    Source: Björn Ottosson, "A perceptual color space for image processing",
    function linear_srgb_to_oklab, https://bottosson.github.io/posts/oklab/
    """
    cone = multiply((
        (0.4122214708, 0.5363325363, 0.0514459929),
        (0.2119034982, 0.6806995451, 0.1073969566),
        (0.0883024619, 0.2817188376, 0.6299787005),
    ), rgb)
    return multiply((
        (0.2104542553, 0.7936177850, -0.0040720468),
        (1.9779984951, -2.4285922050, 0.4505937099),
        (0.0259040371, 0.7827717662, -0.8086757660),
    ), tuple(math.cbrt(value) for value in cone))


class UrpleThemeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.theme = json.loads(THEME.read_text(encoding="utf-8"))
        cls.colors = cls.theme["overrides"]

    def test_file_has_the_custom_theme_format(self):
        self.assertEqual(set(self.theme), {"name", "base", "overrides"})
        self.assertEqual(self.theme["base"], "dark-daltonized")
        for token, value in self.colors.items():
            with self.subTest(token=token):
                self.assertRegex(value, r"\A#[0-9a-fA-F]{6}\Z")

    def test_contrast_on_the_reference_background(self):
        limits = {
            "text": 7.0, "inactive": 7.0,
            "claude": 4.5, "suggestion": 4.5, "permission": 4.5, "remember": 4.5,
            "success": 4.5, "error": 4.5, "warning": 4.5, "planMode": 4.5,
            "autoAccept": 4.5, "bashBorder": 4.5, "promptBorder": 4.5,
            "subtle": 3.0,
        }
        for token, limit in limits.items():
            with self.subTest(token=token):
                ratio = contrast_ratio(self.colors[token], REFERENCE_BACKGROUND)
                self.assertGreaterEqual(ratio, limit)

    def test_contrast_of_text_on_the_message_backgrounds(self):
        backgrounds = (
            "userMessageBackground", "bashMessageBackgroundColor",
            "memoryBackgroundColor", "selectionBg",
        )
        for token in backgrounds:
            with self.subTest(token=token):
                ratio = contrast_ratio(self.colors["text"], self.colors[token])
                self.assertGreaterEqual(ratio, 7.0)

    def test_status_colors_stay_distinct_for_each_type_of_color_vision(self):
        identity = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
        for vision, matrix in {"normal": identity, **CVD_MATRICES}.items():
            seen = {
                token: oklab(simulate(matrix, linear_rgb(self.colors[token])))
                for token in ("claude", "success", "error", "warning")
            }
            for first, second in itertools.combinations(seen, 2):
                with self.subTest(vision=vision, pair=(first, second)):
                    distance = math.dist(seen[first], seen[second])
                    self.assertGreaterEqual(distance, 0.15)


if __name__ == "__main__":
    unittest.main()
