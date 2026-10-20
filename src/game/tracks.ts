import { BoostPad, HazardZone, TrackDefinition, TrackId, TrackSample, Vec2 } from './types';

function catmullRomPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export function buildClosedSplineSamples(controlPoints: Vec2[], subdivisionsPerSegment = 32): {
  samples: TrackSample[];
  totalLength: number;
} {
  const rawPoints: Vec2[] = [];
  const n = controlPoints.length;

  for (let i = 0; i < n; i++) {
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];

    for (let s = 0; s < subdivisionsPerSegment; s++) {
      const t = s / subdivisionsPerSegment;
      rawPoints.push(catmullRomPoint(p0, p1, p2, p3, t));
    }
  }

  const totalRaw = rawPoints.length;
  const samples: TrackSample[] = [];
  let cumulativeDist = 0;

  for (let i = 0; i < totalRaw; i++) {
    const prev = rawPoints[(i - 1 + totalRaw) % totalRaw];
    const curr = rawPoints[i];
    const next = rawPoints[(i + 1) % totalRaw];

    if (i > 0) {
      cumulativeDist += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    }

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    const nx = -ty;
    const ny = tx;

    // Estimate signed curvature from adjacent vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const cross = v1x * v2y - v1y * v2x;
    const denom = (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1;
    const curvature = cross / denom;

    samples.push({
      x: curr.x,
      y: curr.y,
      tx,
      ty,
      nx,
      ny,
      dist: cumulativeDist,
      curvature,
    });
  }

  const last = rawPoints[totalRaw - 1];
  const first = rawPoints[0];
  const totalLength = cumulativeDist + Math.hypot(first.x - last.x, first.y - last.y);

  return { samples, totalLength };
}

function buildTrackDefinition(config: {
  id: TrackId;
  name: string;
  realCircuitName: string;
  locationName: string;
  circuitLengthKm: string;
  coordinates: { lat: number; lng: number };
  subtitle: string;
  difficultyLabel: string;
  totalLaps: number;
  roadWidth: number;
  arenaWidth: number;
  arenaHeight: number;
  theme: TrackDefinition['theme'];
  controlPoints: Vec2[];
  boostSampleFractions: number[];
  hazardSpecs: Array<{ sampleFraction: number; lateralOffset: number; radius: number }>;
}): TrackDefinition {
  const { samples, totalLength } = buildClosedSplineSamples(config.controlPoints, 34);
  const numSamples = samples.length;

  // 8 evenly spaced checkpoints around the large F1 circuit (index 0 is start/finish line)
  const checkpointCount = 8;
  const checkpointIndices: number[] = [];
  for (let c = 0; c < checkpointCount; c++) {
    checkpointIndices.push(Math.floor((c * numSamples) / checkpointCount) % numSamples);
  }

  const boostPads: BoostPad[] = config.boostSampleFractions.map((frac, idx) => {
    const sIdx = Math.floor(frac * numSamples) % numSamples;
    const s = samples[sIdx];
    return {
      id: `${config.id}_boost_${idx}`,
      x: s.x,
      y: s.y,
      angle: Math.atan2(s.ty, s.tx),
      length: 112,
      width: 78,
    };
  });

  const hazards: HazardZone[] = config.hazardSpecs.map((spec, idx) => {
    const sIdx = Math.floor(spec.sampleFraction * numSamples) % numSamples;
    const s = samples[sIdx];
    return {
      id: `${config.id}_hazard_${idx}`,
      x: s.x + s.nx * spec.lateralOffset,
      y: s.y + s.ny * spec.lateralOffset,
      radius: spec.radius,
      type: 'oil_slick',
    };
  });

  return {
    id: config.id,
    name: config.name,
    realCircuitName: config.realCircuitName,
    locationName: config.locationName,
    circuitLengthKm: config.circuitLengthKm,
    coordinates: config.coordinates,
    subtitle: config.subtitle,
    difficultyLabel: config.difficultyLabel,
    totalLaps: config.totalLaps,
    roadWidth: config.roadWidth,
    arenaWidth: config.arenaWidth,
    arenaHeight: config.arenaHeight,
    theme: config.theme,
    controlPoints: config.controlPoints,
    samples,
    totalLength,
    checkpointIndices,
    boostPads,
    hazards,
  };
}

export const TRACKS: Record<TrackId, TrackDefinition> = {
  sunset_gp: buildTrackDefinition({
    id: 'sunset_gp',
    name: 'Bahrain F1 GP (Sakhir)',
    realCircuitName: 'Bahrain International Circuit',
    locationName: 'Sakhir, Bahrain',
    circuitLengthKm: '5.412 km · 15 Turns · 22-Car Grid',
    coordinates: { lat: 26.0325, lng: 50.5106 },
    subtitle: 'Sakhir GP · 15 Turns · 22-Car Wide Track',
    difficultyLabel: 'F1 Desert Night GP',
    totalLaps: 3,
    roadWidth: 264,
    arenaWidth: 4600,
    arenaHeight: 3200,
    theme: {
      grassOuter: '#14110d',
      grassInner: '#1b1610',
      asphalt: '#1e2430',
      asphaltEdge: '#ef4444',
      curbPrimary: '#ef4444',
      curbSecondary: '#f8fafc',
      accentColor: '#f59e0b',
    },
    // Authentic 15-Turn Bahrain International Circuit (Sakhir) layout:
    // Long Start/Finish Pit Straight -> T1-T3 Schumacher S-Hairpin -> T4 -> T5-T7 Fast S-Ess ->
    // T8 Infield Hairpin -> T9-T10 Double-Apex Braking Zone -> Back Straight -> T11-T13 -> T14-T15 Final Corner
    controlPoints: [
      { x: 1950, y: 2720 }, // Start/Finish line (22-car grid stretches along straight y=2720)
      { x: 3250, y: 2720 }, // Main Pit Straight DRS Zone
      { x: 4050, y: 2620 }, // Turn 1 heavy braking hairpin entry
      { x: 3680, y: 2020 }, // Turns 2-3 switchback exit
      { x: 4120, y: 1200 }, // Second DRS Straight up to Turn 4
      { x: 3560, y: 480 },  // Turn 4 apex
      { x: 2680, y: 760 },  // Turns 5-6-7 fast sweeping S-curves into infield
      { x: 2560, y: 1680 }, // Turn 8 tight infield hairpin loop
      { x: 1760, y: 1440 }, // Infield climb toward Turns 9-10
      { x: 1380, y: 500 },  // Turns 9-10 double-apex left-hander
      { x: 560, y: 660 },   // Back straight entry
      { x: 520, y: 1760 },  // Turns 11-12-13 sweeping complex
      { x: 620, y: 2580 },  // Turns 14-15 final corner braking zone
      { x: 1180, y: 2720 }, // Turn 15 exit onto flat Start/Finish straight
    ],
    boostSampleFractions: [0.05, 0.24, 0.56, 0.76, 0.92],
    hazardSpecs: [
      { sampleFraction: 0.16, lateralOffset: -52, radius: 42 },
      { sampleFraction: 0.44, lateralOffset: 48, radius: 40 },
      { sampleFraction: 0.68, lateralOffset: -46, radius: 42 },
    ],
  }),
  harbor_sprint: buildTrackDefinition({
    id: 'harbor_sprint',
    name: 'India F1 GP (Buddh)',
    realCircuitName: 'Buddh International Circuit',
    locationName: 'Greater Noida, India',
    circuitLengthKm: '5.125 km · 16 Turns · 22-Car Grid',
    coordinates: { lat: 28.3506, lng: 77.535 },
    subtitle: 'Buddh GP · 16 Turns · Parabolica & 1km Straight',
    difficultyLabel: 'F1 High-Speed GP',
    totalLaps: 3,
    roadWidth: 268,
    arenaWidth: 4600,
    arenaHeight: 3200,
    theme: {
      grassOuter: '#0c1814',
      grassInner: '#10221b',
      asphalt: '#1b2230',
      asphaltEdge: '#f97316',
      curbPrimary: '#f97316',
      curbSecondary: '#f8fafc',
      accentColor: '#10b981',
    },
    // Authentic 16-Turn Buddh International Circuit (Greater Noida, India) layout:
    // Pit Straight -> T1-T2 -> T3 Tight Hairpin -> Monumental 1.06km DRS Back Straight ->
    // T4 Heavy Braking Corner -> T5-T9 Technical Chicane Complex -> T10-T11 180-deg Banked Parabolica ->
    // T13-T15 Fast S-Bends -> T16 Final Corner onto Pit Straight
    controlPoints: [
      { x: 1950, y: 2720 }, // Start/Finish line (22-car grid sits on flat y=2720 straight)
      { x: 3150, y: 2720 }, // Pit Straight into Turn 1
      { x: 3880, y: 2420 }, // Turns 1-2 right-hand complex
      { x: 4120, y: 1480 }, // Uphill approach to Turn 3 hairpin
      { x: 3860, y: 500 },  // Turn 3 tight hairpin exit onto 1km Back Straight
      { x: 2350, y: 460 },  // Monumental 1.06 km DRS Back Straight midpoint
      { x: 680, y: 500 },   // Turn 4 wide-entry heavy braking corner
      { x: 600, y: 1280 },  // Turns 5-6-7 fast sweeping chicanes
      { x: 1460, y: 1200 }, // Turns 8-9 fast infield transition
      { x: 2380, y: 1240 }, // Entry to Turns 10-11 Buddh Parabolica
      { x: 2820, y: 1860 }, // Apex of 180-degree banked Parabolica loop
      { x: 1960, y: 2020 }, // Parabolica exit onto short straight
      { x: 960, y: 1980 },  // Turns 13-14-15 fast S-curves
      { x: 540, y: 2500 },  // Turn 16 final corner apex
      { x: 1140, y: 2720 }, // Turn 16 exit onto flat Start/Finish straight
    ],
    boostSampleFractions: [0.05, 0.28, 0.36, 0.64, 0.88],
    hazardSpecs: [
      { sampleFraction: 0.20, lateralOffset: 54, radius: 42 },
      { sampleFraction: 0.52, lateralOffset: -50, radius: 40 },
      { sampleFraction: 0.78, lateralOffset: 48, radius: 42 },
    ],
  }),
};

export function getClosestTrackSample(track: TrackDefinition, x: number, y: number): {
  index: number;
  sample: TrackSample;
  distance: number;
  signedLateral: number;
} {
  const samples = track.samples;
  let bestIdx = 0;
  let bestDistSq = Infinity;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const dx = x - s.x;
    const dy = y - s.y;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }

  const sample = samples[bestIdx];
  const dx = x - sample.x;
  const dy = y - sample.y;
  const distance = Math.sqrt(bestDistSq);
  const signedLateral = dx * sample.nx + dy * sample.ny;

  return {
    index: bestIdx,
    sample,
    distance,
    signedLateral,
  };
}
