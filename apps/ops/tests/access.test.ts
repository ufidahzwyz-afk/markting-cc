import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOpsAccess } from "../src/lib/access";
import { calculateCampaignMetrics, keywordFixtures } from "../src/lib/fixtures";

test("production and unspecified environments fail closed, including when mock is requested", () => {
  for (const env of [{}, { AUTH_MODE: "mock" }, { APP_ENV: "production", AUTH_MODE: "mock" }, { APP_ENV: "preview", AUTH_MODE: "mock" }, { APP_ENV: "development", AUTH_MODE: "oidc" }]) {
    assert.equal(evaluateOpsAccess(env).allowed, false);
  }
});

test("mock access requires an explicit development or test environment", () => {
  assert.equal(evaluateOpsAccess({ APP_ENV: "development", AUTH_MODE: "mock" }).allowed, true);
  assert.equal(evaluateOpsAccess({ APP_ENV: "test", AUTH_MODE: "mock" }).allowed, true);
  assert.equal(evaluateOpsAccess({ APP_ENV: "development" }).allowed, false);
});

test("report uses campaign totals without adding subordinate keyword rows", () => {
  const metrics = calculateCampaignMetrics();
  assert.equal(metrics.spend, 220);
  assert.equal(metrics.impressions, 2200);
  assert.equal(metrics.clicks, 110);
  assert.equal(metrics.platformConversions, 9);
  assert.equal(metrics.clickThroughRate, 0.05);
  assert.equal(metrics.costPerClick, 2);
  assert.equal(keywordFixtures.reduce((sum, row) => sum + row.spend, 0), 220);
});
