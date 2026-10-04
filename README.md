# claude-dotpet

A pixel-art pet that sits above the prompt input in Claude Code's terminal UI, plus a browser editor for redrawing it.

日本語の説明は [README.ja.md](README.ja.md) にあります。

- The pet changes with the session: **idle**, **working**, **done**, **sleeping**.
- `/dotpet` turns it on and off and switches the size.
- All frames live in one JSON file. Open `editor/dotpet_editor.html` in a browser, paint, export, and run one command to apply.
- The bundled lizard is a placeholder. Draw your own.

The in-app messages and the editor UI are in Japanese.

## Status

- Built on Claude Code's plugin hooks ("mods") API, which is early access and may change between versions.
- Developed and tested with Claude Code 2.1.288 and 2.1.289 on macOS.
- **Windows is untested.**

## Install

Requirements: Claude Code, and Node.js 18 or later for the editor's apply command.

1. Clone this repository.
2. Start Claude Code with the folder as a plugin:

   ```
   claude --plugin-dir /path/to/claude-dotpet
   ```

`--plugin-dir` loads the plugin for that session only. To load it in every session, place the folder inside a directory listed in the `CLAUDE_CODE_PLUGIN_DIRS` environment variable. That variable worked on 2.1.288 but does not appear in `claude --help`, so treat it as subject to change.

## Commands

| Command | Effect |
|---|---|
| `/dotpet` | Toggle on / off |
| `/dotpet on`, `/dotpet off` | Turn on / off (the choice is saved across sessions) |
| `/dotpet big` | Full body, 20 columns × 5 rows of half-block characters (20 × 10 dots) |
| `/dotpet small` | Full body, 10 columns × 3 rows of octant characters (20 × 12 dots) |
| `/dotpet image` | Experimental. Draws the pet as an image, 12 columns × 3 rows |
| `/dotpet still` | Experimental. One still image, no animation |

Notes:

- `small` uses octant characters (U+1CD00 and up, "Symbols for Legacy Computing Supplement"). The terminal font must have these glyphs, for example Cascadia Code. Without them the pet shows as empty boxes.
- `image` and `still` need a terminal that supports the kitty graphics protocol. `image` was seen working in kitty and Ghostty; `still` has not been checked there. In other terminals a text fallback is shown; use `big` or `small` there.
- The pet is not drawn outside the terminal UI, when the band above the input is too short, or while another plugin is drawing in the same band.

## Redraw the pet

1. Open `editor/dotpet_editor.html` in a browser (Chrome was used during development).
2. Pick a size, a state and a frame, then paint.
   - `←` `→` move between frames. Hold the key to preview the motion.
   - `Shift` + arrow keys shift the picture by one dot. The target can be one picture, one state, or one size.
3. Press 「書き出す」 (export). The browser downloads `dotpet_art_<timestamp>.json` and the page shows a command.
4. Run that command in a terminal:

   ```
   node "/path/to/claude-dotpet/editor/apply_art.js" ~/Downloads/dotpet_art_<timestamp>.json
   ```

   The command path is taken from where the HTML file is, so it works from any directory. The download location is assumed to be `~/Downloads`; adjust it if your browser saves elsewhere.
5. If the pet does not change in an open session, run `/dotpet` twice or restart the session.

The apply command validates the file, backs up the current files to `backup/`, rewrites `art/dotpet_art.json` and the four generated files (`hooks/palette.ts`, `hooks/sit_art.ts`, `hooks/octant_art.ts`, `editor/dotpet_art.js`), and then runs `claude plugin validate` and `claude plugin test`. If those checks fail, the files are restored from the backup. If the `claude` command is not found, the checks are skipped and a notice is printed.

| Option | Effect |
|---|---|
| `--check <file>` | Validate only; write nothing |
| `--regen` | Rebuild the generated files from `art/dotpet_art.json` |
| `--force` | Continue past the two safety stops below (their details are still printed) |

Exit codes: 0 success, 1 failure, 2 bad arguments.

### Safety stops

- **Stale base.** Each export records which version of the art it was painted on. If the art has since changed and applying the export would undo any of those changes, the command stops and lists the pictures that would be rolled back and the pictures changed on both sides. An export that already contains every change in the current art is applied without stopping.
- **Unapplied exports.** If the folder of the export holds other `dotpet_art*.json` files that were never applied, the command stops and names them. Applied files are remembered in `apply_ledger.json`.

`--force` overwrites the art with the given file, including any rollback it lists. There is no automatic merge.

## Art format

`art/dotpet_art.json` holds:

- `palette`: nine colors under the fixed keys `A S M E P K B C V`. The color values can be changed; keys cannot be added.
- `big` (20 × 10) and `small` (20 × 12), each with `poses` (the pictures, one string per row, one character per dot, space = transparent) and `order` (which picture each frame shows).

Fixed in this version:

- Frame counts: idle 8, working 48, done 8, sleeping 8. The animation speed is set in `hooks/art.ts`.
- For `small`, every 2 × 4 block of dots may use at most two colors, and transparent counts as one. A terminal cell can only carry a foreground and a background color. The editor outlines offending blocks in red and refuses to export until they are fixed.

## Tests

```
node editor/test_apply_art.js
claude plugin validate .
claude plugin test .
```

## License

MIT. See [LICENSE](LICENSE). The bundled sample art is covered by the same license.
