/* Walk-sum math for the motion demo. Pure functions; loaded in the browser and in node (self-test).
   Matrices are Float64Array of length T*T, row-major, source i (row) -> receiver j (col), i<j. */
(function (root) {
  function fromUpper(rows) {                       // W_upper[i] = entries j>i, as exported
    const T = rows.length, M = new Float64Array(T * T);
    for (let i = 0; i < T; i++) for (let k = 0; k < rows[i].length; k++) M[i * T + i + 1 + k] = rows[i][k];
    return {T, M};
  }
  function matmulUpper(A, B, T) {                  // both strictly upper triangular -> result is too
    const C = new Float64Array(T * T);
    for (let i = 0; i < T; i++) for (let k = i + 1; k < T; k++) {
      const a = A[i * T + k]; if (a === 0) continue;
      const ro = i * T, ko = k * T;
      for (let j = k + 1; j < T; j++) C[ro + j] += a * B[ko + j];
    }
    return C;
  }
  function katz(W, T, gamma) {                     // R = (I - gW)^-1 - I  = sum_{t>=1} (gW)^t, exact for nilpotent W
    // back-substitution column by column: R[:,j] solves (I - gW) x = gW[:,j]
    const R = new Float64Array(T * T);
    for (let j = 1; j < T; j++)
      for (let i = j - 1; i >= 0; i--) {
        let s = gamma * W[i * T + j];
        for (let k = i + 1; k < j; k++) s += gamma * W[i * T + k] * R[k * T + j];
        R[i * T + j] = s;
      }
    return R;
  }
  function outflow(M, T, sinks) {                  // sum over sink columns, per source row
    const v = new Float64Array(T);
    for (let i = 0; i < T; i++) { let s = 0; for (const j of sinks) if (j > i) s += M[i * T + j]; v[i] = s; }
    return v;
  }
  function inflow(M, T) {                          // column sums
    const v = new Float64Array(T);
    for (let i = 0; i < T; i++) for (let j = i + 1; j < T; j++) v[j] += M[i * T + j];
    return v;
  }
  function sum(M) { let s = 0; for (let i = 0; i < M.length; i++) s += M[i]; return s; }
  /* strongest length-k path from source i into the sink set (max-product), via layered DP:
     best[t][m] = max over n of W[m,n]*best[t-1][n], best[1][m] = max_j in sinks W[m,j]. */
  function bestPaths(W, T, sinks, k, allowed) {   // allowed(pos): may pos be an intermediate
    const sinkSet = new Set(sinks);
    let best = new Float64Array(T), nxt = new Int32Array(T).fill(-1);
    for (let m = 0; m < T; m++) for (const j of sinks) if (j > m && W[m * T + j] > best[m]) { best[m] = W[m * T + j]; nxt[m] = j; }
    const layers = [{best, nxt}];
    for (let t = 2; t <= k; t++) {
      const prev = layers[t - 2], b = new Float64Array(T), n = new Int32Array(T).fill(-1);
      for (let m = 0; m < T; m++) for (let q = m + 1; q < T; q++) {
        if (sinkSet.has(q) || (allowed && !allowed(q))) continue;   // intermediates: non-sink, allowed tokens
        const v = W[m * T + q] * prev.best[q]; if (v > b[m]) { b[m] = v; n[m] = q; }
      }
      layers.push({best: b, nxt: n});
    }
    return function pathFrom(i) {                   // [i, m1, ..., sink] and its product
      const p = [i]; let cur = i;
      for (let t = k; t >= 1; t--) { cur = layers[t - 1].nxt[cur]; if (cur < 0) return null; p.push(cur); }
      return {path: p, w: layers[k - 1].best[i]};
    };
  }
  const api = {fromUpper, matmulUpper, katz, outflow, inflow, sum, bestPaths};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WalkSum = api;
})(typeof window !== "undefined" ? window : globalThis);
