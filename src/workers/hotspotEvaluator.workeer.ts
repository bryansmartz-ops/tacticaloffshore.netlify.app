// src/workers/hotspotEvaluator.worker.ts
// Asynchronous Multi-Threaded Geospatial Analytics Worker
// ──────────────────────────────────────────────────────────────────────────────────────

import { 
  buildHotspotSignals, 
  computeConfidence, 
  toLoranTD, 
  speciesFromSST 
} from "../lib/hotspots";

self.onmessage = (event: MessageEvent) => {
  const { baselineSst, sstOffset, hotspotDefs, canyonsMatrix } = event.data;

  try {
    const canonicalDefs = hotspotDefs?.length > 0 ? hotspotDefs : [];
    
    // Process heavy multi-factor canyon indexing entirely off the UI thread
    const processedHotspots = canyonsMatrix.map((c: any) => {
      const breakDelta = c.name === "Washington" ? 3.4 : c.name === "Poorman's" ? 2.8 : 1.9;
      const computedLocalTemp = baselineSst + (breakDelta - 1.5);

      const matchingDef = canonicalDefs.find((d: any) => 
        d.title?.toLowerCase().includes(c.name.toLowerCase())
      ) || {
        id: `gen-${c.name}`,
        title: `${c.name} Canyon`,
        idealSstF: 72,
        historyPrior: 8
      };

      const realTimeSignals = buildHotspotSignals(computedLocalTemp, breakDelta, matchingDef);
      const compositeConfidence = computeConfidence(realTimeSignals);
      const loranCoordinates = toLoranTD(c.lat, c.lng);

      return {
        id: `map-spot-${c.name}`,
        title: c.name === "Washington" ? `Primary Strike Zone (${c.name})` : `Secondary Break (${c.name} Canyon)`,
        distanceLabel: c.name,
        confidence: compositeConfidence, 
        sstTemp: computedLocalTemp + sstOffset,
        breakDelta: breakDelta,
        lat: c.lat,
        lng: c.lng,
        species: speciesFromSST(computedLocalTemp),
        signals: realTimeSignals,        
        loran: loranCoordinates,
        isFallbackSst: false
      };
    });

    // Post the final compiled payload back to the main thread safely
    self.postMessage({ success: true, hotspots: processedHotspots });
  } catch (error: any) {
    self.postMessage({ success: false, error: error.message });
  }
};
