// ─── Hydrate Cache-Driven Coordinates with Intelligent ID Matching ───
  useEffect(() => {
    fetch("/.netlify/functions/get-latest-brief")
      .then((res) => {
        if (!res.ok) throw new Error("Endpoint standby mode");
        return res.json();
      })
      .then((data) => {
        if (data && data.primary_lat) {
          setDynamicDefs((prevDefs) => {
            // Helper to find the closest hardcoded canyon definition to a set of coordinates
            const findClosestCanyonId = (lat: number, lng: number) => {
              let closestId = "1";
              let minDistance = Infinity;
              
              prevDefs.forEach((def) => {
                // Standard distance quick-check
                const dLat = def.lat - lat;
                const dLng = def.lng - lng;
                const dist = Math.sqrt(dLat * dLat + dLng * dLng);
                if (dist < minDistance) {
                  minDistance = dist;
                  closestId = def.id;
                }
              });
              return closestId;
            };

            // Dynamically resolve which canyons Claude is actually talking about today
            const primaryId = findClosestCanyonId(data.primary_lat, data.primary_lng);
            const secondaryId = data.secondary_lat ? findClosestCanyonId(data.secondary_lat, data.secondary_lng) : null;

            return prevDefs.map((def) => {
              // Map Primary Target Vectors dynamically
              if (def.id === primaryId) {
                const liveSignals = buildHotspotSignals(data.live_sst_value, data.live_break_delta, {
                  ...def,
                  lat: data.primary_lat,
                  lng: data.primary_lng,
                });
                return {
                  ...def,
                  lat: data.primary_lat,
                  lng: data.primary_lng,
                  liveSst: data.live_sst_value,
                  liveBreak: data.live_break_delta,
                  liveConfidence: Math.max(90, computeConfidence(liveSignals)),
                  liveSignals,
                  isPrimaryAI: true,
                };
              }

              // Map Secondary Target Vectors dynamically to whichever canyon it actually is
              if (secondaryId && def.id === secondaryId) {
                const secondarySst = Math.max(60, data.live_sst_value - 1.2);
                const secondaryBreak = Math.max(0, data.live_break_delta - 0.6);
                
                const liveSignals = buildHotspotSignals(secondarySst, secondaryBreak, {
                  ...def,
                  lat: data.secondary_lat,
                  lng: data.secondary_lng,
                });
                return {
                  ...def,
                  lat: data.secondary_lat,
                  lng: data.secondary_lng,
                  liveSst: secondarySst,
                  liveBreak: secondaryBreak,
                  liveConfidence: Math.max(85, computeConfidence(liveSignals)),
                  liveSignals,
                  isSecondaryAI: true,
                };
              }

              return def;
            });
          });
        }
      })
      .catch((err) => console.warn("[hotspots] Dynamic mapping stream standby:", err));
  }, []);
