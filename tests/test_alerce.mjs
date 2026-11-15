import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ALERCE_API_BASE,
  MIN_PLOT_DETECTIONS,
  buildEvidenceSummary,
  computeAlternativeSignals,
  fetchObjectLightCurve,
  fetchRecentEvents,
  normalizeAlerceDetections,
} from "../web/alerce.mjs";
import {
  CACHE_MAX_AGE_MS,
  decodeCacheEntry,
  encodeCacheEntry,
} from "../web/dashboard-cache.mjs";

test("recent event request uses the ALeRCE ZTF endpoint and newest-first ordering", async () => {
  let requestedUrl;
  const items = [{ oid: "ZTF26example" }];
  const result = await fetchRecentEvents({
    limit: 12,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => ({ items }) };
    },
  });

  const request = new URL(requestedUrl);
  assert.equal(request.origin, ALERCE_API_BASE);
  assert.equal(request.pathname, "/ztf/v1/objects");
  assert.equal(request.searchParams.get("page_size"), "12");
  assert.equal(request.searchParams.get("ndet"), String(MIN_PLOT_DETECTIONS));
  assert.equal(request.searchParams.get("order_by"), "lastmjd");
  assert.equal(request.searchParams.get("order_mode"), "DESC");
  assert.deepEqual(result, items);
});

test("light-curve requests URL-encode object identifiers and report HTTP errors", async () => {
  let requestedUrl;
  await assert.rejects(
    fetchObjectLightCurve("ZTF/a", {
      fetchImpl: async (url) => {
        requestedUrl = url;
        return { ok: false, status: 503 };
      },
    }),
    /HTTP 503/,
  );
  assert.match(requestedUrl, /ZTF%2Fa\/lightcurve$/);
});

test("normalizes ALeRCE filter IDs and falls back to corrected magnitudes", () => {
  assert.deepEqual(
    normalizeAlerceDetections([
      { mjd: 60002, fid: 2, magpsf: 19, magpsf_corr: 18.9 },
      { mjd: 60001, fid: 1, magpsf: null, magpsf_corr: 20 },
      { mjd: 60003, fid: 2, magpsf: 18.5, magpsf_corr: 18.4 },
    ]),
    [
      { mjd: 60002, band: "r", magnitude: 19 },
      { mjd: 60001, band: "g", magnitude: 20 },
      { mjd: 60003, band: "r", magnitude: 18.5 },
    ],
  );
});

test("rejects malformed ALeRCE detections instead of treating null values as zero", () => {
  assert.throws(
    () => normalizeAlerceDetections([{ mjd: null, fid: 1, magpsf: 19 }]),
    /invalid detection/,
  );
});

test("rejects detections that cannot form a two-point single-band curve", () => {
  assert.throws(
    () => normalizeAlerceDetections([
      { mjd: 60000, fid: 1, magpsf: 19 },
      { mjd: 60000, fid: 1, magpsf: 19.1 },
      { mjd: 60001, fid: 2, magpsf: 20 },
    ]),
    /two distinct observing times in one band/,
  );
});

test("alternative signals quantify variability while leaving zero-MAD outliers unscaled", () => {
  const signals = computeAlternativeSignals([
    { mjd: 1, magnitude: 20 },
    { mjd: 2, magnitude: 20 },
    { mjd: 3, magnitude: 18 },
  ]);
  assert.equal(signals.peakToPeakMagnitude, 2);
  assert.equal(signals.medianAbsoluteDeviation, 0);
  assert.equal(signals.robustMaxDeviation, null);
  assert.equal(signals.largestAdjacentChangeMagnitude, 2);
  assert.equal(signals.largestObservationGapDays, 1);
});

test("evidence summary labels model outputs as suggestions, not classifications", () => {
  const summary = buildEvidenceSummary(
    { status: "insufficient_data", band: "g" },
    [
      { classifier_name: "stamp_classifier", class_name: "SN", probability: 0.95 },
      { classifier_name: "lc_classifier", class_name: "AGN", probability: 0.6 },
    ],
  );
  assert.match(summary.modelText, /lc_classifier model.*AGN \(60.0%\)/);
  assert.match(summary.modelText, /not a confirmed classification/);
  assert.match(summary.shapeText, /not enough observations/);
  assert.match(summary.caveat, /image-subtraction\/data-quality issue/);
});

test("dashboard cache supports immediate stale-while-refresh reads and expires old data", () => {
  const savedAt = 1000;
  const serialized = encodeCacheEntry(["cached"], savedAt);

  assert.deepEqual(decodeCacheEntry(serialized, savedAt + 500), {
    savedAt,
    value: ["cached"],
  });
  assert.equal(decodeCacheEntry(serialized, savedAt + CACHE_MAX_AGE_MS + 1), null);
  assert.equal(decodeCacheEntry("not-json", savedAt), null);
});

test("live dashboard supports automatic or manual browsing without candidate tiles", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const dashboard = html.split('<section id="dashboard"')[1].split("</section>")[0];

  assert.match(dashboard, /id="event-detail"/);
  assert.match(dashboard, /id="rotation-progress"/);
  assert.match(dashboard, /id="rotation-count"/);
  assert.match(dashboard, /data-navigation-mode="auto"/);
  assert.match(dashboard, /data-navigation-mode="manual"/);
  assert.match(dashboard, /id="previous-object"/);
  assert.match(dashboard, /id="next-object"/);
  assert.doesNotMatch(dashboard, /<select\b|event-list|event-card/);
  assert.match(app, /function setRotationMode/);
  assert.match(app, /scheduleAutoRotation\(\)/);
  assert.match(app, /MODEL PROBABILITIES/);
  assert.match(app, /Model estimates—not confirmed chances/);
  assert.match(app, /well-calibrated on similar data/);
  assert.match(app, /visible values may not add to 100%/);
  assert.doesNotMatch(app, /ALeRCE classifier probabilities · grouped by model/);
  assert.match(html, /A probability is a clue, not a verdict/);
  assert.match(html, /compare scores within one model—not across models/);
});
