"""Generate the 13 'periodic table' tile SVGs for the README workbench grid.

Each tile is 200x240, dark-backgrounded with the project's accent color used
for borders, the symbol glyph, and a subtle pulsing accent ring. Tiles are
intentionally consistent in layout so the grid reads as a uniform set."""

from pathlib import Path

OUT = Path(__file__).parent / 'tiles'
OUT.mkdir(parents=True, exist_ok=True)

# (slug, atomic#, symbol, fullname, category, accent_hex, glyph_svg)
# `glyph_svg` is a small inline SVG snippet drawn under the symbol — a tiny
# project-specific motif (a tape cell, a polar ring, a neuron, etc.).
PROJECTS = [
    ("brainfuck",      "01", "Bf", "BrainFuck GA",   "algorithm",    "#e879f9",
     # 4 tape cells with a fuchsia "pointer" mark
     '''<g transform="translate(60,200)" stroke="{c}" stroke-opacity="0.55" fill="none" stroke-width="1">
        <rect x="0" y="0" width="20" height="20"/>
        <rect x="20" y="0" width="20" height="20"/>
        <rect x="40" y="0" width="20" height="20" fill="{c}" fill-opacity="0.20"/>
        <rect x="60" y="0" width="20" height="20"/>
        <path d="M 50 -4 v -6" stroke-width="2"/>
      </g>'''),
    ("gol",            "02", "Gl", "Game of Life",   "automaton",    "#4ade80",
     # 3x3 mini grid with a glider
     '''<g transform="translate(70,196)" stroke="{c}" stroke-opacity="0.55" fill="none" stroke-width="1">
        <rect width="60" height="30"/>
        <line x1="20" y1="0" x2="20" y2="30"/><line x1="40" y1="0" x2="40" y2="30"/>
        <line x1="0" y1="10" x2="60" y2="10"/><line x1="0" y1="20" x2="60" y2="20"/>
        <rect x="2" y="12" width="6" height="6" fill="{c}" stroke="none"/>
        <rect x="22" y="22" width="6" height="6" fill="{c}" stroke="none"/>
        <rect x="42" y="2"  width="6" height="6" fill="{c}" stroke="none"/>
        <rect x="42" y="12" width="6" height="6" fill="{c}" stroke="none"/>
        <rect x="22" y="2"  width="6" height="6" fill="{c}" stroke="none"/>
      </g>'''),
    ("ecosystem",      "03", "Ec", "Ecosystem",      "simulation",   "#34d399",
     # predator + prey dots
     '''<g transform="translate(70,206)" fill="{c}">
        <circle cx="6"  cy="8" r="3"/>
        <circle cx="20" cy="14" r="2"/>
        <circle cx="34" cy="6" r="2"/>
        <circle cx="48" cy="12" r="3"/>
        <circle cx="58" cy="6" r="2" opacity="0.6"/>
        <path d="M 0 18 q 30 -6 60 0" stroke="{c}" stroke-opacity="0.4" fill="none" stroke-width="1"/>
      </g>'''),
    ("neuroevolution", "04", "Nv", "Neuroevolution", "simulation",   "#60a5fa",
     # tiny network: 3-4-2
     '''<g transform="translate(60,196)" fill="{c}" stroke="{c}" stroke-opacity="0.45" stroke-width="0.7">
        <line x1="6" y1="6" x2="40" y2="2"/><line x1="6" y1="6" x2="40" y2="12"/><line x1="6" y1="6" x2="40" y2="22"/><line x1="6" y1="6" x2="40" y2="32"/>
        <line x1="6" y1="18" x2="40" y2="2"/><line x1="6" y1="18" x2="40" y2="12"/><line x1="6" y1="18" x2="40" y2="22"/><line x1="6" y1="18" x2="40" y2="32"/>
        <line x1="6" y1="30" x2="40" y2="2"/><line x1="6" y1="30" x2="40" y2="12"/><line x1="6" y1="30" x2="40" y2="22"/><line x1="6" y1="30" x2="40" y2="32"/>
        <line x1="40" y1="2" x2="74" y2="12"/><line x1="40" y1="2" x2="74" y2="24"/>
        <line x1="40" y1="12" x2="74" y2="12"/><line x1="40" y1="12" x2="74" y2="24"/>
        <line x1="40" y1="22" x2="74" y2="12"/><line x1="40" y1="22" x2="74" y2="24"/>
        <line x1="40" y1="32" x2="74" y2="12"/><line x1="40" y1="32" x2="74" y2="24"/>
        <circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="6" cy="30" r="2.4"/>
        <circle cx="40" cy="2" r="2.4"/><circle cx="40" cy="12" r="2.4"/><circle cx="40" cy="22" r="2.4"/><circle cx="40" cy="32" r="2.4"/>
        <circle cx="74" cy="12" r="2.4"/><circle cx="74" cy="24" r="2.4"/>
      </g>'''),
    ("image-evolver",  "05", "Im", "Image Evolver",  "algorithm",    "#22d3ee",
     # overlapping translucent triangles
     '''<g transform="translate(72,196)" stroke="none">
        <polygon points="0,30 30,0 60,30" fill="{c}" fill-opacity="0.28"/>
        <polygon points="10,30 40,8 56,30" fill="{c}" fill-opacity="0.45"/>
        <polygon points="22,30 50,16 56,30" fill="{c}" fill-opacity="0.65"/>
      </g>'''),
    ("polar-clock",    "06", "Pc", "Polar Clock",    "visualization","#a78bfa",
     # concentric ring arcs
     '''<g transform="translate(100,210)" fill="none" stroke="{c}">
        <circle r="8" stroke-opacity="0.30"/>
        <circle r="14" stroke-opacity="0.50"/>
        <circle r="20" stroke-opacity="0.70"/>
        <path d="M 0 -8 A 8 8 0 0 1 7.6 -2.5" stroke-opacity="1" stroke-width="1.4"/>
        <path d="M 0 -14 A 14 14 0 0 1 13.3 -4.3" stroke-opacity="1" stroke-width="1.4"/>
        <path d="M 0 -20 A 20 20 0 1 1 -19.0 6.2" stroke-opacity="1" stroke-width="1.4"/>
      </g>'''),
    ("house",          "07", "Hs", "House Planner",  "tool",         "#d6d3d1",
     # tiny floor plan
     '''<g transform="translate(64,196)" fill="none" stroke="{c}" stroke-opacity="0.65" stroke-width="1">
        <rect width="72" height="36"/>
        <line x1="32" y1="0" x2="32" y2="22"/>
        <line x1="32" y1="22" x2="72" y2="22"/>
        <rect x="6" y="6" width="14" height="10" fill="{c}" fill-opacity="0.25" stroke-opacity="0.4"/>
        <rect x="42" y="4" width="20" height="14" fill="{c}" fill-opacity="0.25" stroke-opacity="0.4"/>
      </g>'''),
    ("challenges",     "08", "Lc", "LoL Challenges", "tracker",      "#fbbf24",
     # tier chevron stack
     '''<g transform="translate(86,196)" fill="none" stroke="{c}">
        <path d="M -16 30 L 0 18 L 16 30" stroke-width="2"/>
        <path d="M -16 22 L 0 10 L 16 22" stroke-width="1.6" stroke-opacity="0.7"/>
        <path d="M -16 14 L 0 2 L 16 14" stroke-width="1.4" stroke-opacity="0.5"/>
      </g>'''),
    ("jellyfin",       "09", "Jf", "Jellyfin Ingest","media",        "#818cf8",
     # download arrow over progress bar
     '''<g transform="translate(74,194)" stroke="{c}" fill="none" stroke-width="1.4">
        <path d="M 26 0 v 18 M 18 12 l 8 8 l 8 -8"/>
        <rect x="0" y="26" width="52" height="6" stroke-opacity="0.5"/>
        <rect x="0" y="26" width="34" height="6" fill="{c}" fill-opacity="0.6" stroke="none"/>
      </g>'''),
    ("soulseek",       "10", "Sk", "Soulseek",       "media",        "#38bdf8",
     # 3 nodes peer-to-peer mesh
     '''<g transform="translate(74,196)" stroke="{c}" fill="{c}" stroke-width="0.9">
        <line x1="6" y1="6" x2="46" y2="6" stroke-opacity="0.55"/>
        <line x1="6" y1="6" x2="26" y2="32" stroke-opacity="0.55"/>
        <line x1="46" y1="6" x2="26" y2="32" stroke-opacity="0.55"/>
        <circle cx="6" cy="6" r="3"/>
        <circle cx="46" cy="6" r="3"/>
        <circle cx="26" cy="32" r="3"/>
      </g>'''),
    ("barfoo",         "11", "Br", "BarFoo Player",  "media",        "#f59e0b",
     # mini equalizer bars
     '''<g transform="translate(78,196)" fill="{c}">
        <rect x="0"  y="20" width="6" height="14"/>
        <rect x="10" y="10" width="6" height="24"/>
        <rect x="20" y="16" width="6" height="18"/>
        <rect x="30" y="4"  width="6" height="30"/>
        <rect x="40" y="14" width="6" height="20" fill-opacity="0.7"/>
      </g>'''),
    ("splitwiser",     "12", "Sw", "Splitwiser",     "tool",         "#fb7185",
     # two arrows back and forth
     '''<g transform="translate(70,200)" stroke="{c}" fill="none" stroke-width="1.5">
        <path d="M 4 6 L 56 6 M 50 0 l 6 6 l -6 6"/>
        <path d="M 56 22 L 4 22 M 10 16 l -6 6 l 6 6"/>
      </g>'''),
    ("server",         "13", "Sv", "Server Status",  "infra",        "#2dd4bf",
     # rack with status lights
     '''<g transform="translate(72,196)" stroke="{c}" fill="none" stroke-width="1">
        <rect width="56" height="10"/>
        <rect y="13" width="56" height="10"/>
        <rect y="26" width="56" height="10"/>
        <circle cx="6" cy="5" r="1.6" fill="{c}"/>
        <circle cx="6" cy="18" r="1.6" fill="{c}"/>
        <circle cx="6" cy="31" r="1.6" fill="{c}" fill-opacity="0.4"/>
      </g>'''),
]


TEMPLATE = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="200" height="240" role="img" aria-label="{name}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{c}" stop-opacity="0.10"/>
      <stop offset="0.4" stop-color="#0a0a0d" stop-opacity="1"/>
      <stop offset="1" stop-color="#0a0a0d" stop-opacity="1"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2"/>
    </filter>
  </defs>
  <rect width="200" height="240" rx="8" ry="8" fill="url(#bg)"/>
  <rect x="0.5" y="0.5" width="199" height="239" rx="7.5" ry="7.5" fill="none" stroke="{c}" stroke-opacity="0.55" stroke-width="1">
    <animate attributeName="stroke-opacity" values="0.55;0.95;0.55" dur="3.2s" repeatCount="indefinite"/>
  </rect>

  <!-- atomic number -->
  <text x="14" y="26" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="700" fill="{c}" fill-opacity="0.65">{num}</text>
  <!-- category small caps in upper right -->
  <text x="186" y="26" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" letter-spacing="1.4" fill="{c}" fill-opacity="0.55">{cat}</text>

  <!-- glow halo behind symbol -->
  <text x="100" y="120" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="78" font-weight="800" fill="{c}" fill-opacity="0.20" filter="url(#glow)">{sym}</text>
  <!-- big symbol -->
  <text x="100" y="120" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="78" font-weight="800" fill="{c}">{sym}</text>

  <!-- name -->
  <text x="100" y="158" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="600" fill="#fafafa" fill-opacity="0.92">{name}</text>

  <!-- glyph -->
  {glyph}

  <!-- bottom rule -->
  <line x1="20" y1="218" x2="180" y2="218" stroke="{c}" stroke-opacity="0.25" stroke-width="0.6"/>
  <text x="100" y="232" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" letter-spacing="2" fill="{c}" fill-opacity="0.45">/{slug}</text>
</svg>
'''


def main():
    for slug, num, sym, name, cat, c, glyph_tpl in PROJECTS:
        glyph = glyph_tpl.format(c=c)
        svg = TEMPLATE.format(
            name=name, slug=slug, num=num, sym=sym, cat=cat.upper(),
            c=c, glyph=glyph,
        )
        (OUT / f'{slug}.svg').write_text(svg)
        print(f'wrote {slug}.svg')


if __name__ == '__main__':
    main()
