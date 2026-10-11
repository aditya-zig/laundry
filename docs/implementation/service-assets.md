# Service assets (assets/services/)

Original, standalone SVG catalog artwork for Wandary's four laundry services, plus the brand mark. All files are hand-authored vector paths — no remote fonts, scripts, images or tracking; no embedded CSS rasters; each file carries `viewBox` plus accessible `<title>`/`<desc>`.

## Palette

| Role | Hex |
| --- | --- |
| Cream background | `#F6EFE3` |
| Cream soft (ground/base) | `#EDE2CE` |
| Ink (strokes/steel parts) | `#26303A` |
| Teal (primary brand fill) | `#2A7D74` |
| Soft teal (accents) | `#7DBFAE` |
| Teal mist (glass/highlights) | `#BFDEE0` |

## Assets

| File | Alt text |
| --- | --- |
| `assets/services/wandary-mark.svg` | Wandary brand mark: a teal rounded crest holding a cream water-drop inside a dashed bubble ring |
| `assets/services/wash-and-fold.svg` | A folded stack of garments beside a teal washing-machine drum with a soap bubble rising |
| `assets/services/wash-and-iron.svg` | A teal iron gliding along an ironing board, leaving a crisp fold trail behind a neatly folded shirt |
| `assets/services/steam-press.svg` | A lowered teal dome press resting on a board with steam curls rising from a shirt lying flat beneath it |
| `assets/services/dry-clean.svg` | A blazer on a teal drop-shaped hanger beneath a round dry-clean badge with steam wisps drifting past |

All illustrations share a 240×160 viewBox; the brand mark is 44×44. Full metadata (usage, viewBox, authorship, license) lives in `assets/services/manifest.json`.

## Authorship

- Authoring tool: Freebuff coding agent, for Wandary.
- Usage: project assets; no third-party media included.
- Provenance: original vector artwork drawn for Wandary; no third-party assets, fonts, scripts, trackers, AI image generators or raster sources were used.

## Constraints honoured

- Cream/ink/teal palette consistent across all five files.
- No remote resources of any kind (fonts, images, scripts, beacons).
- `<title>` + `<desc>` with `role="img"` and `aria-labelledby` on every SVG for screen readers.
- Modest filesize: every file is under 3 KB.
- Only catalog-ready shapes; nothing references app code, packages or other docs.

## Status

Implementation only. Verification was not run in this session per the user's request to keep all verification outsourced (Muse Free); the files are ready for downstream review.
