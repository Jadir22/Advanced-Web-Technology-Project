
import { strict as assert } from "node:assert";

import {
  calculateMatchScore,
  calculateDateScore,
} from "../modules/matches/utils/match-score.util";

function runTests() {
  console.log("Testing Matching Score...");

  // Test 1: All criteria match
  const perfectMatch = calculateMatchScore({
    lostDate: "2026-11-10",
    foundDate: "2026-11-10",

    lostAreas: [
      {
        areaName: "Banani",
        specificPlace: "Road 11",
      },
    ],

    foundAreas: [
      {
        areaName: "banani",
        specificPlace: "road 11",
      },
    ],

    lostAttributes: [
      { categoryFieldId: "brand", value: "Samsung" },
      { categoryFieldId: "color", value: "Black" },
    ],

    foundAttributes: [
      { categoryFieldId: "brand", value: "samsung" },
      { categoryFieldId: "color", value: "black" },
    ],
  });

  assert.equal(perfectMatch.finalScore, 100);
  console.log("PASS: Perfect match = 100");

  // Test 2: Partial similarity
  const partialMatch = calculateMatchScore({
    lostDate: "2026-11-10",
    foundDate: "2026-11-12",

    lostAreas: [{ areaName: "Banani" }],
    foundAreas: [{ areaName: "Banani" }],

    lostAttributes: [
      { categoryFieldId: "brand", value: "Samsung" },
      { categoryFieldId: "color", value: "Black" },
    ],

    foundAttributes: [
      { categoryFieldId: "brand", value: "Samsung" },
      { categoryFieldId: "color", value: "White" },
    ],
  });

  assert.equal(partialMatch.locationScore, 70);
  assert.equal(partialMatch.dateScore, 80);
  assert.equal(partialMatch.attributeScore, 50);
  assert.equal(partialMatch.finalScore, 62);

  console.log("PASS: Partial match = 62");

  // Test 3: No similarity evidence
  const noMatch = calculateMatchScore({
    lostDate: "2026-11-01",
    foundDate: "2026-11-12",

    lostAreas: [{ areaName: "Banani" }],
    foundAreas: [{ areaName: "Uttara" }],

    lostAttributes: [],
    foundAttributes: [],
  });

  assert.equal(noMatch.finalScore, 0);
  console.log("PASS: No similarity = 0");

  // Test 4: Invalid date
  assert.throws(() => {
    calculateDateScore(
      "2026-02-30",
      "2026-02-28",
    );
  });

  console.log("PASS: Invalid date rejected");

  console.log("ALL SCORING TESTS PASSED.");
}

runTests();
