# Assets verification

Checked 2026-10-11. Five files under assets/services. I rendered them in a local page and looked at them at desktop and phone sizes.

## Files

```
dry-clean.svg    1744 bytes  viewBox 0 0 240 160
steam-press.svg  1489 bytes  viewBox 0 0 240 160
wandary-mark.svg  815 bytes  viewBox 0 0 44 44
wash-and-fold.svg 1927 bytes viewBox 0 0 240 160
wash-and-iron.svg 1778 bytes viewBox 0 0 240 160
```

All under the 6KB limit in manifest.json. Manifest is version 1.0.0, palette cream #F6EFE3, ink #26303A, teal #2A7D74, soft #7DBFAE, mist #BFDEE0.

Static checks passed:

```
grep -i -E "script|foreignObject|image href|http" assets/services/*.svg
```

No hits except the xmlns declaration. No remote fonts, images, scripts, or beacons. Each file has `role="img"`, `aria-labelledby`, `<title>`, and `<desc>`. I read all five. Alt text matches service-assets.md.

One quirk. dry-clean.svg uses `<text>` with `font-family="Arial, Helvetica, sans-serif"` for the DRY CLEAN badge. That is a local fallback, not a download, so it passes the no remote rule. It will look slightly different if Arial is missing. I left it alone. Changing artwork was out of scope for a verify pass.

## Browser render

T3 preview tools were unavailable per docs/implementation/browser-environment.md. I used the gstack headless fallback as instructed:

```
/home/batman/.codex/skills/gstack/browse/dist/browse
```

I copied the SVGs to /tmp/opencode/svg-gallery with an index.html grid. Served it locally:

```
python3 -m http.server 8931 --directory /tmp/opencode/svg-gallery
```

Then:

```
browse goto http://127.0.0.1:8931/index.html
```

It returned 200. `browse text` listed all five cards. `browse js` reported `5 images, 44x44` for the first mark. Snapshot showed no interactive elements, which fits a static gallery.

Screenshots live in docs/implementation/evidence:

```
service-assets-desktop.png 56K 1280x800
service-assets-mobile.png  66K 390x844
```

I opened both. Desktop shows a 4 across row plus dry-clean below. Mobile stacks all five in one column. Colors read right. Cream cards, teal fills, ink strokes. The mark shows the teal crest with cream drop and dashed bubble ring. Wash-and-fold shows drum plus folded stack. Wash-and-iron shows board and iron. Steam-press shows dome press with steam curls. Dry-clean shows hanger blazer with badge. Nothing clipped or blank.

## Verdict

Pass. Original vector work, correct palette and sizes, accessible tags present, renders clean at both widths. Only follow up I would suggest is redrawing that DRY CLEAN text as paths if you want pixel identical output on machines without Arial.
