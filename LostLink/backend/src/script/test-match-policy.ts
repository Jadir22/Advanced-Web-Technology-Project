
import { strict as assert } from "node:assert";

import {
  getMinimumMatchScore,
  isEligibleMatchScore,
} from "../modules/matches/utils/match-policy.util";

function runTests() {
  console.log("Testing matching eligibility policy...");

  // Test 1: Minimum score configuration
  assert.equal(getMinimumMatchScore(""), 1);
  assert.equal(getMinimumMatchScore("60"), 60);

  console.log("PASS: Minimum score configuration.");

  // Test 2: Zero-score candidates
  assert.equal(isEligibleMatchScore(0, 1), false);

  console.log("PASS: Zero-score candidate excluded.");

  // Test 3: Positive scores
  assert.equal(isEligibleMatchScore(100, 1), true);
  assert.equal(isEligibleMatchScore(62, 1), true);

  console.log("PASS: Positive-score candidates accepted.");

  // Test 4: Custom threshold
  assert.equal(isEligibleMatchScore(62, 63), false);
  assert.equal(isEligibleMatchScore(62, 62), true);

  console.log("PASS: Configured threshold enforced.");

  // Test 5: Invalid match scores
  assert.equal(isEligibleMatchScore(-1, 1), false);
  assert.equal(isEligibleMatchScore(101, 1), false);
  assert.equal(isEligibleMatchScore(NaN, 1), false);

  console.log("PASS: Invalid scores excluded.");

  // Test 6: Invalid configuration
  assert.throws(() => getMinimumMatchScore("abc"));
  assert.throws(() => getMinimumMatchScore("0"));
  assert.throws(() => getMinimumMatchScore("101"));

  console.log("PASS: Invalid threshold rejected.");

  console.log("ALL MATCH POLICY TESTS PASSED.");
}

runTests();
