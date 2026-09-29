"""Export the interactive-example data for the project page from the demo snapshot.

Sources (read-only):
  DEMO/data/sample/<ds>/<qid>.json         tokens, spans, question, gold
  DEMO/data/image/<ds>/<qid>.png           the input image
  DEMO/data/scores/<ds>/<qid>/<m>_katz_0_gamma_1_readout_delta.json   per-token scores (raw arms)
  DEMO/data/record/<ds>/<qid>_mask_blur_mode_{insertion,deletion}.json   per-sample RISE
  ROOT/cache/W/<model>/<ds>/<qid>__cane.npz   pairwise attribution matrix W (motion demo only)

Output: static/examples/<qid>.json (+ .png), static/examples/index.json, static/motion/<qid>.json
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np

DEMO = Path("/home/bowen/anon_site_walksum")
ROOT = Path("/home/bowen/projects/flashtrace/walk_sum/demo_root_8b")
MODEL = "Qwen__Qwen3-VL-8B-Instruct"
OUT = Path(__file__).resolve().parent.parent / "static"

METHODS = ["cane", "ifr", "flashtrace", "flowtracer", "attnlrp", "rollout", "reagent", "heta"]
LABEL = {"cane": "VTrace (ours)", "ifr": "IFR", "flashtrace": "FlashTrace", "flowtracer": "FlowTracer",
         "attnlrp": "AttnLRP", "rollout": "Attn Rollout", "reagent": "ReAGent", "heta": "HETA"}

EXAMPLES = [
    ("mmstar", "mmstar_453"), ("mmstar", "mmstar_386"), ("mmstar", "mmstar_532"), ("mmstar", "mmstar_834"),
    ("visualpuzzles", "visualpuzzles_00597"), ("visualpuzzles", "visualpuzzles_01090"),
    ("mathvista", "mathvista_601"), ("mmmu", "validation_Physics_24"), ("mathverse", "mathverse_1628"),
]
MOTION = ("mmstar", "mmstar_453")


def sig(x, n=5):
    return float(f"{x:.{n}g}")


def load_scores(ds, qid, m):
    p = DEMO / "data/scores" / ds / qid / f"{m}_katz_0_gamma_1_readout_delta.json"
    d = json.loads(p.read_text())
    assert d["arm"] == f"{m}:raw", (qid, m, d["arm"])
    return d["scores"]


def load_rise(ds, qid):
    out = {}
    for mode in ("insertion", "deletion"):
        rec = json.loads((DEMO / "data/record" / ds / f"{qid}_mask_blur_mode_{mode}.json").read_text())
        for m in METHODS:
            arm = rec["arms"][f"{m}:raw"]
            for leg in ("image", "joint"):
                out.setdefault(m, {}).setdefault(leg, {})[mode] = round(arm[leg]["rise"], 3)
    return out


def export_example(ds, qid):
    s = json.loads((DEMO / "data/sample" / ds / f"{qid}.json").read_text())
    T = s["seq_len"]
    ex = {k: s[k] for k in ("qid", "dataset", "question", "gold", "category", "n_input", "n_generated",
                            "seq_len", "grid", "img_span", "user_text_span", "answer_seg", "ans_tp", "texts")}
    ex["scores"] = {}
    for m in METHODS:
        sc = load_scores(ds, qid, m)
        assert len(sc) == T, (qid, m, len(sc), T)
        ex["scores"][m] = [sig(v) for v in sc]
    ex["rise"] = load_rise(ds, qid)
    ex["image"] = f"{qid}.png"
    (OUT / "examples").mkdir(parents=True, exist_ok=True)
    shutil.copy(DEMO / "data/image" / ds / f"{qid}.png", OUT / "examples" / f"{qid}.png")
    (OUT / "examples" / f"{qid}.json").write_text(json.dumps(ex, separators=(",", ":")))
    return {"qid": qid, "dataset": ds, "question": s["question"], "gold": s["gold"], "T": T,
            "n_patches": s["img_span"][1] - s["img_span"][0]}


def export_motion(ds, qid):
    z = np.load(ROOT / "cache/W" / MODEL / ds / f"{qid}__cane.npz", allow_pickle=True)
    h = json.loads(bytes(z["header"]).decode())
    assert h["orient"] == "receiver_source" and h["name"] == "cane"
    W = z["W"].astype(np.float64).T                      # source-row, receiver-col
    assert np.allclose(np.tril(W), 0)
    Wn = W / (np.abs(W).max() + 1e-12)
    T = Wn.shape[0]
    s = json.loads((DEMO / "data/sample" / ds / f"{qid}.json").read_text())
    assert s["seq_len"] == T == h["seq_len"]
    ts = z["token_score"].astype(np.float64)
    # reproduce the released method: R = (I - Wn)^-1 - I, u = (1 + in) * out, zero from first sink
    sinks = s["ans_tp"]
    R = np.linalg.inv(np.eye(T) - Wn) - np.eye(T)
    out = R[:, sinks].sum(1)
    inflow = R.sum(0)
    u = (1 + inflow) * out
    u[min(sinks):] = 0
    s0, s1 = s["img_span"]
    u0, u1 = s["user_text_span"]
    txt = slice(u0, u1)
    img = slice(s0, s1)
    assert np.max(np.abs(u[txt] - ts[txt]) / (np.abs(ts[txt]) + 1e-12)) < 5e-3, "text rows must match token_score"
    lam = ts[img][u[img] > 0] / u[img][u[img] > 0]
    assert lam.max() / lam.min() < 1.01, "image rows must be one constant rescale"
    lam = float(np.median(lam))
    extra = {k: (float(z[k]) if k in z.files and np.ndim(z[k]) == 0 else None)
             for k in ("gamma", "target_image_share", "w_img", "w_txt", "d_img", "d_txt", "d_both")}
    rows = [[sig(v, 4) for v in Wn[i, i + 1:]] for i in range(T)]
    m = {"qid": qid, "dataset": ds, "seq_len": T, "grid": s["grid"], "img_span": s["img_span"],
         "user_text_span": s["user_text_span"], "n_input": s["n_input"], "ans_tp": sinks,
         "answer_seg": s["answer_seg"], "texts": s["texts"], "lambda": sig(lam), "extra": extra,
         "W_upper": rows, "image": f"{qid}.png",
         "check": {"u_text_sum": sig(u[txt].sum()), "u_img_sum": sig(u[img].sum()),
                   "R_sum": sig(R.sum()), "W2_sum": sig((Wn @ Wn).sum()), "W3_sum": sig((Wn @ Wn @ Wn).sum())}}
    (OUT / "motion").mkdir(parents=True, exist_ok=True)
    shutil.copy(DEMO / "data/image" / ds / f"{qid}.png", OUT / "motion" / f"{qid}.png")
    (OUT / "motion" / f"{qid}.json").write_text(json.dumps(m, separators=(",", ":")))
    print("motion", qid, "T", T, "lambda", lam, "extra", extra, "check", m["check"])


if __name__ == "__main__":
    idx = [export_example(ds, q) for ds, q in EXAMPLES]
    (OUT / "examples" / "index.json").write_text(json.dumps({"methods": METHODS, "labels": LABEL, "examples": idx}, indent=1))
    export_motion(*MOTION)
    print("examples", [e["qid"] for e in idx])
