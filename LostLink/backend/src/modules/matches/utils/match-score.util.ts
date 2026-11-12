
export interface MatchArea {
  areaName: string;
  specificPlace?: string | null;
}

export interface MatchAttribute {
  categoryFieldId: string;
  value: string;
}

export interface MatchScoreInput {
  lostDate: string;
  foundDate: string;
  lostAreas: MatchArea[];
  foundAreas: MatchArea[];
  lostAttributes: MatchAttribute[];
  foundAttributes: MatchAttribute[];
}

export interface MatchScoreResult {
  locationScore: number;
  dateScore: number;
  attributeScore: number;
  finalScore: number;
}

// Provisional weights for Phase 2
const WEIGHTS = {
  location: 30,
  date: 20,
  attributes: 50,
};

function normalize(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Compare multiple possible locations
export function calculateLocationScore(
  lostAreas: MatchArea[],
  foundAreas: MatchArea[],
): number {
  let bestScore = 0;

  for (const lost of lostAreas) {
    for (const found of foundAreas) {
      const lostArea = normalize(lost.areaName);
      const foundArea = normalize(found.areaName);

      if (!lostArea || lostArea !== foundArea) {
        continue;
      }

      // Same area = 70 points
      let score = 70;

      const lostPlace = normalize(lost.specificPlace);
      const foundPlace = normalize(found.specificPlace);

      // Same area and specific place = 100
      if (
        lostPlace &&
        foundPlace &&
        lostPlace === foundPlace
      ) {
        score = 100;
      }

      bestScore = Math.max(bestScore, score);
    }
  }

  return bestScore;
}

// Convert YYYY-MM-DD to UTC day number
function toUtcDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date must use YYYY-MM-DD format");
  }

  const timestamp = Date.parse(
    `${date}T00:00:00.000Z`,
  );

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Invalid calendar date");
  }

  return Math.floor(timestamp / 86400000);
}

// Calculate date similarity
export function calculateDateScore(
  lostDate: string,
  foundDate: string,
): number {
  const difference = Math.abs(
    toUtcDay(lostDate) - toUtcDay(foundDate),
  );

  if (difference === 0) return 100;
  if (difference <= 3) return 80;
  if (difference <= 7) return 50;

  return 0;
}

// Compare attributes using Category Field IDs
export function calculateAttributeScore(
  lostAttributes: MatchAttribute[],
  foundAttributes: MatchAttribute[],
): number {
  const foundMap = new Map(
    foundAttributes.map((attribute) => [
      attribute.categoryFieldId,
      normalize(attribute.value),
    ]),
  );

  let compared = 0;
  let matched = 0;

  for (const attribute of lostAttributes) {
    const lostValue = normalize(attribute.value);
    const foundValue = foundMap.get(
      attribute.categoryFieldId,
    );

    // Compare only fields with values on both sides
    if (!lostValue || !foundValue) {
      continue;
    }

    compared++;

    if (lostValue === foundValue) {
      matched++;
    }
  }

  // No common comparable fields = no attribute evidence
  if (compared === 0) return 0;

  return Number(
    ((matched / compared) * 100).toFixed(2),
  );
}

// Calculate weighted final score
export function calculateMatchScore(
  input: MatchScoreInput,
): MatchScoreResult {
  const locationScore = calculateLocationScore(
    input.lostAreas,
    input.foundAreas,
  );

  const dateScore = calculateDateScore(
    input.lostDate,
    input.foundDate,
  );

  const attributeScore = calculateAttributeScore(
    input.lostAttributes,
    input.foundAttributes,
  );

  const finalScore = Number(
    (
      (locationScore * WEIGHTS.location +
        dateScore * WEIGHTS.date +
        attributeScore * WEIGHTS.attributes) /
      100
    ).toFixed(2),
  );

  return {
    locationScore,
    dateScore,
    attributeScore,
    finalScore,
  };
}
