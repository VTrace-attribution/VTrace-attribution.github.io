# VTrace project page

Static page for *Tracing the Evidence: Faithful Token Attribution Through Vision-Language Reasoning*.
No build step: `index.html` + `static/`.

## View it

```bash
cd <this folder>
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

A server is needed because the widgets fetch JSON. For GitHub Pages, push this folder as the site root.

## Links

Edit the `LINKS` object at the top of the `<script>` in `index.html`:

| key | now | note |
|---|---|---|
| `arxiv` | `null` → "coming soon" | set to the arXiv abs URL (no separate Paper button; `static/paper.pdf` is git-ignored) |
| `code` | `null` → "coming soon" | set to the GitHub URL |
| `demo` | `https://huggingface.co/spaces/VTrace/vtrace-demo` | Demo button |
| `demoApp` | `https://vtrace-vtrace-demo.static.hf.space/` | per-sample deep links (`?ds=&qid=`) |
| `demoSamples` | 2 qids | example qids the hosted demo also serves; the "open in demo" link is hidden for the others |

The BibTeX block is a placeholder until the arXiv entry exists.

## Teaser video

`static/motion/record.html` is the animation (matrix Ŵ → Ŵ² → Ŵ³ → R, image + text re-shaded, strongest
paths drawn) rendered from the pairwise matrix of `mmstar_453`. `?t=<ms>` renders one deterministic frame;
without it the page plays live. `tools/record_teaser.sh` screenshots frames with headless Chrome and encodes
`static/motion/teaser.mp4` / `teaser.webm` / `teaser_poster.png` (15 fps, 7.6 s loop, 1400×560).

```bash
bash tools/record_teaser.sh        # needs google-chrome + ffmpeg; ~3 min with JOBS=4
```

Timing knobs are at the top of the script in `record.html` (`PERIOD`, `FADE`, `DRAW`).

## Data behind the widgets

`tools/export_examples.py` regenerates `static/examples/` (9 samples: tokens, spans, per-method scores from
the evaluation runs, per-sample RISE from the run records, image) and `static/motion/mmstar_453.json`
(the pairwise matrix Ŵ). It reads the dashboard snapshot in `/home/bowen/anon_site_walksum` and the W cache
in `/home/bowen/projects/flashtrace/walk_sum/demo_root_8b`, and asserts that walk-sum(Ŵ) reproduces the
cached VTrace scores (text rows to <0.5%, image rows up to one constant λ).

`static/main_table.json` is parsed mechanically from the paper's main table (`paper/content/4_Experiments.tex`),
including best / runner-up marks. `static/images/` are 200-dpi renders of `../paper/figures/*.pdf`.

`static/js/walksum.js` holds the Ŵ^k, R = (I−Ŵ)⁻¹−I, in/out-flow and best-path code; `static/js/render.js`
the shared overlay / token-strip / matrix / link drawing. Self-check of the math against the numpy
checksums stored in the motion JSON:

```bash
node -e 'const W=require("./static/js/walksum.js"),d=require("./static/motion/mmstar_453.json");const {T,M}=W.fromUpper(d.W_upper);const R=W.katz(M,T,1);console.log(W.sum(R).toFixed(1), d.check.R_sum)'
```
