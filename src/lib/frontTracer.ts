// src/lib/frontTracer.ts
// Physics-Informed Thermal Front Vectorization Engine
// ─────────────────────────────────────────────────────────────────────

import { haversineNm } from "./hotspots";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

/**
 * Traces a continuous thermal front line through a grid of sea surface temperature data points.
 * Identifies cells experiencing the maximum spatial temperature gradient (the thermal cliff).
 */
export function traceThermalFronts(sstGrid: { lat: number; lng: number; temp: number }[]): LatLngPoint[][] {
  if (!sstGrid || sstGrid.length === 0) return [];

  // 1. Group flat array into a structured, sortable 2D matrix
  const lats = Array.from(new Set(sstGrid.map(p => p.lat))).sort((a, b) => b - a);
  const lngs = Array.from(new Set(sstGrid.map(p => p.lng))).sort((a, b) => a - b);
  
  const grid2D: number[][] = Array(lats.length).fill(null).map(() => Array(lngs.length).fill(NaN));
  
  sstGrid.forEach(p => {
    const r = lats.indexOf(p.lat);
    const c = lngs.indexOf(p.lng);
    if (r !== -1 && c !== -1) {
      grid2D[r][c] = p.temp;
    }
  });

  const frontLines: LatLngPoint[][] = [];
  const visited = new Set<string>();

  // 2. Scan the matrix for points of high thermal contrast (e.g., 65°F to 67°F transition boundaries)
  // Target the dynamic mid-point of your active Gulf Stream edge
  const FRONT_THRESHOLD_MIN = 64.0;
  const FRONT_THRESHOLD_MAX = 68.0;

  for (let r = 1; r < lats.length - 1; r++) {
    for (let c = 1; c < lngs.length - 1; c++) {
      const temp = grid2D[r][c];
      const key = `${r},${c}`;

      if (isNaN(temp) || visited.has(key)) continue;

      // Check if this point sits directly on a steep thermal boundary line
      if (temp >= FRONT_THRESHOLD_MIN && temp <= FRONT_THRESHOLD_MAX) {
        // Look at adjacent cells to compute the directional gradient change
        const dLat = Math.abs(grid2D[r+1][c] - grid2D[r-1][c]);
        const dLng = Math.abs(grid2D[r][c+1] - grid2D[r][c-1]);
        const gradientIntensity = Math.sqrt(dLat * dLat + dLng * dLng);

        // If the temperature cliff drops significantly across this coordinate, initiate path trace
        if (gradientIntensity > 1.5) {
          const currentLine: LatLngPoint[] = [];
          let currR = r;
          let currC = c;

          // Trace the physical length of the edge until it stabilizes or hits open ocean
          while (
            currR > 0 && currR < lats.length - 1 &&
            currC > 0 && currC < lngs.length - 1 &&
            !visited.has(`${currR},${currC}`)
          ) {
            const currKey = `${currR},${currC}`;
            visited.add(currKey);
            currentLine.push({ lat: lats[currR], lng: lngs[currC] });

            // Find the adjacent cell that continues tracking along the same temperature contour line
            let nextR = currR;
            let nextC = currC;
            let bestMatchDiff = Infinity;

            const neighbors = [
              [0, 1], [1, 0], [0, -1], [-1, 0],
              [1, 1], [1, -1], [-1, 1], [-1, -1]
            ];

            for (const [dr, dc] of neighbors) {
              const nr = currR + dr;
              const nc = currC + dc;
              const nTemp = grid2D[nr][nc];
              
              if (!isNaN(nTemp) && !visited.has(`${nr},${nc}`)) {
                const diff = Math.abs(nTemp - temp);
                if (diff < bestMatchDiff) {
                  bestMatchDiff = diff;
                  nextR = nr;
                  nextC = nc;
                }
              }
            }

            if (bestMatchDiff < 1.0) {
              currR = nextR;
              currC = nextC;
            } else {
              break; // The edge dissolved or drifted past our sampling window
            }
          }

          if (currentLine.length > 2) {
            frontLines.push(currentLine);
          }
        }
      }
    }
  }

  return frontLines;
}
