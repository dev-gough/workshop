"""Engraved room plates for the README grid.

Each plate is the same size and the same ink. The only thing that changes
is the line drawing and the name, so twenty of them read as one set.
"""

import textwrap
from pathlib import Path

OUT = Path(__file__).parent / "tiles"
OUT.mkdir(parents=True, exist_ok=True)

# (slug, room label, name, glyph). Glyphs are drawn in a 64×40 box.
ROOMS = [
    ("server", "RM 01", "Control Center", """
        <rect x="8" y="2" width="48" height="9"/>
        <rect x="8" y="15" width="48" height="9"/>
        <rect x="8" y="28" width="48" height="9"/>
        <circle cx="16" cy="6.5" r="1.5" fill="#3c3833" stroke="none"/>
        <circle cx="16" cy="19.5" r="1.5" fill="#3c3833" stroke="none"/>
        <circle cx="16" cy="32.5" r="1.5" fill="#3c3833" stroke="none" opacity="0.35"/>
    """),
    ("barfoo", "RM 02", "BarFoo Records", """
        <circle cx="18" cy="20" r="13"/>
        <circle cx="18" cy="20" r="2.4" fill="#3c3833" stroke="none"/>
        <rect x="38" y="6" width="18" height="28"/>
    """),
    ("spaceflight", "RM 03", "Mission Control", """
        <path d="M4 32 C 18 32, 22 10, 36 10 C 50 10, 52 22, 60 8"/>
        <circle cx="60" cy="8" r="2" fill="#3c3833" stroke="none"/>
    """),
    ("challenges", "RM 04", "Challenges", """
        <path d="M14 32 L32 20 L50 32"/>
        <path d="M14 22 L32 10 L50 22"/>
        <path d="M14 12 L32 0 L50 12"/>
    """),
    ("polar-clock", "RM 05", "Polar Clock", """
        <circle cx="32" cy="20" r="5"/>
        <path d="M32 4 A 16 16 0 1 1 18 30"/>
        <path d="M32 10 A 10 10 0 0 1 41 24"/>
    """),
    ("gol", "RM 06", "Game of Life", """
        <rect x="4" y="4" width="56" height="32"/>
        <path d="M18 4 V36 M32 4 V36 M46 4 V36 M4 15 H60 M4 26 H60"/>
        <rect x="6" y="17" width="10" height="7" fill="#3c3833" stroke="none"/>
        <rect x="20" y="28" width="10" height="6" fill="#3c3833" stroke="none"/>
        <rect x="34" y="6" width="10" height="7" fill="#3c3833" stroke="none"/>
        <rect x="48" y="17" width="10" height="7" fill="#3c3833" stroke="none"/>
    """),
    ("brainfuck", "RM 07", "The Tape Lab", """
        <rect x="0" y="10" width="15" height="18"/>
        <rect x="16" y="10" width="15" height="18"/>
        <rect x="32" y="10" width="15" height="18" fill="#3c3833" fill-opacity="0.18"/>
        <rect x="48" y="10" width="15" height="18"/>
        <path d="M39.5 6 V1"/>
    """),
    ("jellyfin", "RM 08", "Screening Room", """
        <rect x="4" y="6" width="56" height="28"/>
        <path d="M28 13 L40 20 L28 27 Z" fill="#3c3833" stroke="none"/>
    """),
    ("splitwiser", "RM 09", "SplitWiser", """
        <path d="M4 12 H48"/>
        <path d="M42 6 L50 12 L42 18"/>
        <path d="M60 28 H16"/>
        <path d="M22 22 L14 28 L22 34"/>
    """),
    ("soulseek", "RM 10", "Soulseek Wire", """
        <path d="M10 8 L54 8 L32 34 Z"/>
        <circle cx="10" cy="8" r="2.4" fill="#3c3833" stroke="none"/>
        <circle cx="54" cy="8" r="2.4" fill="#3c3833" stroke="none"/>
        <circle cx="32" cy="34" r="2.4" fill="#3c3833" stroke="none"/>
    """),
    ("house", "RM 11", "Drafting Room", """
        <path d="M4 4 H60 V36 H32 V20 H4 Z"/>
        <path d="M18 4 V20"/>
    """),
    ("ecosystem", "RM 12", "The Vivarium", """
        <circle cx="14" cy="14" r="3.2" fill="#3c3833" stroke="none"/>
        <circle cx="36" cy="10" r="2" fill="#3c3833" stroke="none"/>
        <circle cx="50" cy="18" r="2.6" fill="#3c3833" stroke="none"/>
        <path d="M4 32 Q32 24 60 32"/>
    """),
    ("neuroevolution", "RM 13", "Driving School", """
        <ellipse cx="32" cy="20" rx="26" ry="14"/>
        <ellipse cx="32" cy="20" rx="12" ry="5"/>
        <circle cx="54" cy="12" r="2.3" fill="#3c3833" stroke="none"/>
    """),
    ("image-evolver", "RM 14", "Image Evolver", """
        <polygon points="2,36 32,2 62,36" fill="#3c3833" fill-opacity="0.08"/>
        <polygon points="18,36 44,12 62,36" fill="#3c3833" fill-opacity="0.14"/>
    """),
    ("megabonk", "RM 15", "Megabonk", """
        <path d="M6 36 V22 H18 V36"/>
        <path d="M26 36 V12 H38 V36"/>
        <path d="M46 36 V4 H58 V36"/>
        <path d="M4 36 H62"/>
    """),
    ("groove", "RM 16", "The Groove", """
        <circle cx="16" cy="20" r="11"/>
        <circle cx="16" cy="20" r="2.2" fill="#3c3833" stroke="none"/>
        <path d="M34 30 C 42 8, 50 32, 62 10"/>
    """),
    ("paper-trading", "RM 17", "Paper Trading", """
        <path d="M4 30 L16 24 L28 28 L44 12 L60 8"/>
        <path d="M4 36 H60"/>
    """),
    ("paddle", "RM 18", "The Outfitter", """
        <path d="M6 20 C 18 6, 46 6, 58 20 C 46 30, 18 30, 6 20 Z"/>
        <path d="M32 10 V28"/>
    """),
    ("parlor", "RM 19", "The Parlor", """
        <path d="M18 16 C 18 6, 46 6, 46 16"/>
        <path d="M16 16 H48"/>
        <path d="M32 16 V30"/>
        <path d="M22 30 H42"/>
    """),
    ("super-heavy", "RM 20", "Super Heavy", """
        <path d="M32 2 L40 12 V26 L32 36 L24 26 V12 Z"/>
        <path d="M24 20 L10 34 H24"/>
        <path d="M40 20 L54 34 H40"/>
    """),
]

TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 148" width="220" height="148" role="img" aria-label="{name}">
  <rect width="220" height="148" fill="#f3f0e8"/>
  <rect x="0.5" y="0.5" width="219" height="147" fill="none" stroke="#e4ddd2"/>
  <text x="16" y="22" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" letter-spacing="1.5" fill="#8a8175">{label}</text>
  <g transform="translate(78,40)" fill="none" stroke="#3c3833" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round">
    {glyph}
  </g>
  <line x1="16" y1="108" x2="204" y2="108" stroke="#e4ddd2"/>
  <text x="16" y="130" font-family="Georgia, 'Iowan Old Style', Palatino, serif" font-size="16" fill="#2a2724">{name}</text>
</svg>
"""


def main() -> None:
    for slug, label, name, glyph in ROOMS:
        glyph_src = textwrap.dedent(glyph).strip()
        svg = TEMPLATE.format(name=name, label=label, glyph=glyph_src)
        (OUT / f"{slug}.svg").write_text(svg + "\n")
        print(f"wrote {slug}.svg")


if __name__ == "__main__":
    main()
