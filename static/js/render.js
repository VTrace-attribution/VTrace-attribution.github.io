/* Shared rendering for the project page widgets and the teaser recorder.
   Image overlay + token strip follow the dashboard visualiser's style. */
(function (root) {
  const METHOD_COLOR = {cane: "#d0454c", ifr: "#4a90d9", flashtrace: "#5b7ea3", flowtracer: "#e0b352",
                        attnlrp: "#8e7cc3", rollout: "#7fc4d6", reagent: "#9b9bd6", heta: "#f4a582"};
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const toHex = a => Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");
  const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

  /* gray scrim dims low-credit cells, colour lights high ones (scale clipped at p98 of the image
     family), top-12% cells get a solid border */
  function drawOverlay(canvas, img, s, scores, col, W) {
    const [h, w] = s.grid, [s0, s1] = s.img_span;
    const scale = W / img.naturalWidth, H = Math.round(img.naturalHeight * scale);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    const cw = W / w, ch = H / h, vals = [];
    for (let i = s0; i < s1; i++) if (scores[i] > 0) vals.push(scores[i]);
    vals.sort((a, b) => b - a);
    const hot = vals.length ? vals[Math.max(0, Math.floor(vals.length * 0.12) - 1)] : Infinity;
    const p98 = vals.length ? vals[Math.floor(0.02 * (vals.length - 1))] : 0;
    for (let i = s0; i < s1; i++) {
      const cell = i - s0, r = Math.floor(cell / w), c = cell % w;
      const x0 = Math.round(c * cw), y0 = Math.round(r * ch);
      const cwv = Math.round((c + 1) * cw) - x0, chv = Math.round((r + 1) * ch) - y0;
      const v = p98 > 0 ? Math.min(1, scores[i] / p98) : 0;
      if (!vals.length) continue;
      const dim = 0.75 * 0.28 * (1 - v);
      if (dim > 0.02) { ctx.fillStyle = `rgba(82,81,78,${dim.toFixed(3)})`; ctx.fillRect(x0, y0, cwv, chv); }
      const ca = 0.75 * 0.85 * Math.pow(v, 0.9);
      if (ca > 0.03) { ctx.fillStyle = col + toHex(ca); ctx.fillRect(x0, y0, cwv, chv); }
      if (scores[i] >= hot) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, cwv - 2, chv - 2); }
    }
    return {cw, ch, W, H};
  }

  /* question tokens then generated tokens, shaded on the text-family scale */
  function renderStrip(box, s, scores, col) {
    const [u0, u1] = s.user_text_span, T = s.seq_len, nIn = s.n_input;
    const ansLo = nIn + s.answer_seg[0], ansHi = nIn + s.answer_seg[1];
    let mx = 0;
    for (let i = u0; i < u1; i++) mx = Math.max(mx, scores[i]);
    for (let i = nIn; i < T; i++) mx = Math.max(mx, scores[i]);
    const tok = i => {
      const v = mx > 0 ? scores[i] / mx : 0;
      const cls = "tok" + (i >= ansLo && i < ansHi ? " answer" : "");
      const st = v > 0.03 ? `background-color:${col}${toHex(Math.pow(v, 1.15) * 0.85)}` : "";
      return `<span class="${cls}" data-p="${i}" style="${st}" title="pos ${i} · score ${Number(scores[i]).toPrecision(3)}">${esc(s.texts[i])}</span>`;
    };
    const frag = [`<span class="sect">question</span>`];
    for (let i = u0; i < u1; i++) frag.push(tok(i));
    frag.push(`<span class="sect">assistant ↓ generation</span>`);
    for (let i = nIn; i < T; i++) frag.push(tok(i));
    box.innerHTML = frag.join("");
  }

  /* share of image patches among the top-10% input tokens (image patches + question tokens) */
  function imageShareTop10(s, scores) {
    const [s0, s1] = s.img_span, [u0, u1] = s.user_text_span, idx = [];
    for (let i = s0; i < s1; i++) idx.push(i);
    for (let i = u0; i < u1; i++) idx.push(i);
    idx.sort((a, b) => scores[b] - scores[a]);
    const k = Math.max(1, Math.round(idx.length * 0.10));
    let n = 0;
    for (let t = 0; t < k; t++) if (idx[t] >= s0 && idx[t] < s1) n++;
    return {share: n / k, k};
  }

  /* ------------------------------------------------------------ multi-hop motion */
  const STATES = [
    {key: "W",  label: "1 hop · Ŵ",    hops: 1, title: "Direct attribution Ŵ (1 hop)"},
    {key: "W2", label: "2 hops · Ŵ²",  hops: 2, title: "Paths of length 2: Ŵ²"},
    {key: "W3", label: "3 hops · Ŵ³",  hops: 3, title: "Paths of length 3: Ŵ³"},
    {key: "R",  label: "all hops · R", hops: 0, title: "All paths: R = (I − Ŵ)⁻¹ − I"},
  ];
  /* content tokens: words of 3+ letters that are neither function words nor prompt-template words;
     links are drawn only between image patches, content tokens and the answer */
  const STOP = new Set(("the a an and or of in on at to is are was were there this that these those with for from by as it its be " +
    "no not other than then so if all any some can will has have had do does did but into onto over under up down out off " +
    "look looking carefully reason step end line final answer options option hint please provide correct letter question choices").split(" "));
  function contentToken(d, pos) {
    const w = (d.texts[pos] || "").trim().toLowerCase();
    return /^[a-z][a-z-]{2,}$/.test(w) && !STOP.has(w);
  }
  function computeMotion(d) {
    const {T, M: W} = WalkSum.fromUpper(d.W_upper);
    const nIn = d.n_input, allowed = q => q >= nIn && contentToken(d, q);   // intermediates: content tokens of the generation
    const W2 = WalkSum.matmulUpper(W, W, T), W3 = WalkSum.matmulUpper(W2, W, T), R = WalkSum.katz(W, T, 1.0);
    const sinks = d.ans_tp, [s0, s1] = d.img_span, readout = {};
    for (const [k, M] of [["W", W], ["W2", W2], ["W3", W3]]) readout[k] = WalkSum.outflow(M, T, sinks);
    const out = WalkSum.outflow(R, T, sinks), inn = WalkSum.inflow(R, T), u = new Float64Array(T);
    for (let i = 0; i < T; i++) u[i] = i < Math.min(...sinks) ? (1 + inn[i]) * out[i] : 0;
    for (let i = s0; i < s1; i++) u[i] *= d.lambda;                       // cross-modal calibration
    readout.R = u; readout.R_uncal = out;
    return {T, W, W2, W3, R, readout,
            paths: {1: WalkSum.bestPaths(W, T, sinks, 1, allowed), 2: WalkSum.bestPaths(W, T, sinks, 2, allowed), 3: WalkSum.bestPaths(W, T, sinks, 3, allowed)}};
  }
  function kpis(d, m, i) {
    const st = STATES[i], sc = m.readout[st.key], [s0, s1] = d.img_span, [u0, u1] = d.user_text_span;
    const raw = st.key === "R" ? m.readout.R_uncal : sc;
    let si = 0, sq = 0;
    for (let k = s0; k < s1; k++) si += raw[k];
    for (let k = u0; k < u1; k++) sq += raw[k];
    return {share: si + sq > 0 ? 100 * si / (si + sq) : 0, top: imageShareTop10(d, sc)};
  }
  function drawMatrix(canvas, labelBox, M, T, d) {
    canvas.width = T; canvas.height = T;
    const ctx = canvas.getContext("2d"), im = ctx.createImageData(T, T), px = im.data, vals = [];
    for (let i = 0; i < M.length; i++) if (M[i] > 0) vals.push(M[i]);
    vals.sort((a, b) => b - a);
    const p99 = vals.length ? vals[Math.floor(0.01 * (vals.length - 1))] : 1;
    for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
      const o = (i * T + j) * 4, v = j > i ? Math.min(1, M[i * T + j] / p99) : 0, t = Math.pow(v, 0.55);
      px[o] = Math.round(255 - t * 244); px[o + 1] = Math.round(255 - t * 176); px[o + 2] = Math.round(255 - t * 99); px[o + 3] = 255;
      if (j <= i) { px[o] = 246; px[o + 1] = 246; px[o + 2] = 244; }
    }
    ctx.putImageData(im, 0, 0);
    const [s0, s1] = d.img_span, [u0, u1] = d.user_text_span, nIn = d.n_input;
    ctx.strokeStyle = "rgba(31,31,31,.55)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (const p of [s1, u1, nIn]) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, T); ctx.moveTo(0, p); ctx.lineTo(T, p); ctx.stroke(); }
    ctx.setLineDash([]); ctx.strokeStyle = "#d0454c"; ctx.lineWidth = 2;
    for (const j of d.ans_tp) { ctx.beginPath(); ctx.moveTo(j + .5, 0); ctx.lineTo(j + .5, j); ctx.stroke(); }
    if (labelBox) {
      labelBox.querySelectorAll(".matlab").forEach(x => x.remove());
      const lab = (txt, x, y) => labelBox.insertAdjacentHTML("beforeend", `<div class="matlab" style="left:${100 * x}%;top:${100 * y}%">${txt}</div>`);
      lab("image", (s0 + s1) / 2 / T - 0.06, 0.01); lab("question", (u1 + u0) / 2 / T - 0.07, 0.01); lab("generation", (nIn + T) / 2 / T - 0.1, 0.01);
      lab("answer", d.ans_tp[0] / T - 0.12, 0.12); lab("rows = sources", 0.005, 0.5);
    }
  }
  /* strongest paths from the top sources into the answer; progress in [0,1] draws them on */
  function drawLinks(stage, svg, imgCanvas, d, m, stateIdx, top, progress) {
    const st = STATES[stateIdx];
    stage.querySelectorAll(".tok.pathsrc").forEach(x => x.classList.remove("pathsrc"));
    const sr = stage.getBoundingClientRect(), cr = imgCanvas.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);
    svg.setAttribute("width", sr.width); svg.setAttribute("height", sr.height);
    const [s0, s1] = d.img_span, [h, w] = d.grid;
    const sinkSet = new Set(d.ans_tp), ansPos = d.n_input + d.answer_seg[0];   // draw the sink at the answer token it predicts
    const point = pos => {
      if (sinkSet.has(pos)) pos = ansPos;
      if (pos >= s0 && pos < s1) {
        const cell = pos - s0, r0 = Math.floor(cell / w), c0 = cell % w;
        return {x: cr.left - sr.left + (c0 + .5) * (cr.width / w), y: cr.top - sr.top + (r0 + .5) * (cr.height / h), img: true};
      }
      const el = stage.querySelector(`.tok[data-p="${pos}"]`); if (!el) return null;
      const r = el.getBoundingClientRect();
      return {x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2, img: false, el};
    };
    const seg = (a, b) => {
      if (a.img || b.img) { const mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C ${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; }
      const lift = Math.min(60, 16 + Math.abs(b.y - a.y) * .25 + Math.abs(b.x - a.x) * .08);
      return `M${a.x},${a.y} C ${a.x},${a.y - lift} ${b.x},${b.y - lift} ${b.x},${b.y}`;
    };
    /* sources: the `top` image patches and 2 question content words with the strongest path of the
       state's length (3 for the all-paths state) into the answer through content words */
    const [u0, u1] = d.user_text_span, kStar = st.hops || 3;
    const strength = i => { const bp = m.paths[kStar](i); return bp ? bp.w : 0; };
    const imgs = [], words = [];
    for (let i = s0; i < s1; i++) imgs.push(i);
    for (let i = u0; i < u1; i++) if (contentToken(d, i)) words.push(i);
    const pick = (arr, n) => arr.sort((a, b) => strength(b) - strength(a)).slice(0, n).filter(i => strength(i) > 0);
    const srcs = [...pick(words, 2), ...pick(imgs, top)];
    const hopsList = st.hops ? [st.hops] : [1, 2, 3], parts = [];
    const p = progress == null ? 1 : Math.max(0, Math.min(1, progress));
    for (const src of srcs) for (const k of hopsList) {
      const bp = m.paths[k](src); if (!bp) continue;
      const depth = hopsList.length > 1 ? k : 1;
      const op = (0.9 - 0.22 * (depth - 1)).toFixed(2), sw = (2.6 - 0.5 * (depth - 1)).toFixed(1);
      const n = bp.path.length - 1;
      for (let t = 0; t < n; t++) {
        const a = point(bp.path[t]), b = point(bp.path[t + 1]); if (!a || !b) continue;
        const segP = Math.max(0, Math.min(1, p * n - t));          // segments draw one after another
        if (segP <= 0) continue;
        parts.push(`<path d="${seg(a, b)}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${(1 - segP).toFixed(3)}" fill="none" stroke="${t === 0 && a.img ? "#1f1f1f" : "#d0454c"}" stroke-width="${sw}" opacity="${op}" stroke-linecap="round"/>`);
        if (!a.img && a.el) a.el.classList.add("pathsrc");
      }
      const a0 = point(bp.path[0]);
      if (a0 && a0.img) { const cw = cr.width / w, ch = cr.height / h;
        parts.push(`<rect x="${a0.x - cw / 2}" y="${a0.y - ch / 2}" width="${cw}" height="${ch}" fill="none" stroke="#1f1f1f" stroke-width="2" opacity="${op}"/>`); }
    }
    svg.innerHTML = parts.join("");
  }

  root.VTR = {METHOD_COLOR, esc, toHex, loadImage, drawOverlay, renderStrip, imageShareTop10, STATES, computeMotion, kpis, drawMatrix, drawLinks, contentToken};
})(window);
