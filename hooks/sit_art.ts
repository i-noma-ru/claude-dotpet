// art/dotpet_art.json から editor/apply_art.js が作る。手で直さない

const POSES: readonly (readonly string[])[] = [
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    " A          AAAAEAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    " A          AAAASAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    "            AAAAEAAA",
    "        AAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    " A          AAAAEAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA  KK",
    "    AA    AA  AA  KK"
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    " A          AAAAEAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA  KK",
    "    AA    AA      KK"
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    " A          AAAAEAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA   AA KK",
    "    AA    AA      KK"
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    " A          AAAASAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA  KK",
    "    AA    AA      KK"
  ],
  [
    "                    ",
    "                    ",
    "        AA    AAAA  ",
    "        AA  AAAAAAA ",
    " A      AA  AAAAEAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "                    ",
    "        AA    AAAA  ",
    "        AA  AAAAAAA ",
    " A      AA  AAAASAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "    VV              ",
    "                    ",
    "        AA    AAAA  ",
    "        AA  AAAAAAA ",
    " A      AA  AAAAEAAA",
    " AA     AAAAAAAAAAAA",
    "  AAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    "        AA  AAAAEAAA",
    "        AAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "      VV            ",
    "              AAAA  ",
    "            AAAAAAA ",
    "        AA  AAAAEAAA",
    "        AAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "                    ",
    "              AAAA  ",
    "            AAAAAAA ",
    "            AAAASAAA",
    "        AAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "                    ",
    "                    ",
    "          PP  AAAA  ",
    "            AAAAAAA ",
    "            AAAASAAA",
    "        AAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ],
  [
    "        PP          ",
    "                    ",
    "          PP  AAAA  ",
    "            AAAAAAA ",
    "            AAAASAAA",
    "        AAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAA ",
    "   AAAAAAAAAAAAAAA  ",
    "    AA    AA  AA    ",
    "    AA    AA  AA    "
  ]
]

const ORDER: Record<'idle' | 'work' | 'done' | 'sleep', readonly number[]> = {
  idle: [0, 0, 1, 0, 0, 0, 2, 0],
  work: [3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 6, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 6, 3, 6, 5, 4],
  done: [7, 8, 9, 8, 10, 10, 11, 10],
  sleep: [12, 13, 14, 0, 12, 13, 14, 0],
}

export function sitDots(mode: 'idle' | 'work' | 'done' | 'sleep', frame: number): readonly string[] {
  const frames = ORDER[mode]

  return POSES[frames[frame % frames.length]!]!
}
