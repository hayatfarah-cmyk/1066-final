export const ALERCE_API_BASE = "https://api.alerce.online";
export const MIN_PLOT_DETECTIONS = 5;

async function requestJson(path, fetchImpl) {
  const response = await fetchImpl(`${ALERCE_API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`ALeRCE API returned HTTP ${response.status}.`);
  }
  return response.json();
}

export async function fetchRecentEvents({ fetchImpl = fetch, limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("The event limit must be a whole number from 1 to 100.");
  }
  const query = new URLSearchParams({
    page: "1",
    page_size: String(limit),
    ndet: String(MIN_PLOT_DETECTIONS),
    order_by: "lastmjd",
    order_mode: "DESC",
    count: "false",
  });
  const response = await requestJson(`/ztf/v1/objects?${query}`, fetchImpl);
  if (!response || !Array.isArray(response.items)) {
    throw new Error("ALeRCE returned an unexpected recent-object response.");
  }
  return response.items;
}

export async function fetchObjectLightCurve(oid, { fetchImpl = fetch } = {}) {
  if (typeof oid !== "string" || !oid.trim()) {
    throw new Error("An ALeRCE object identifier is required.");
  }
  const response = await requestJson(
    `/ztf/v1/objects/${encodeURIComponent(oid)}/lightcurve`,
    fetchImpl,
  );
  if (!response || !Array.isArray(response.detections)) {
    throw new Error("ALeRCE returned an unexpected light-curve response.");
  }
  return response.detections;
}

export async function fetchObjectProbabilities(oid, { fetchImpl = fetch } = {}) {
  if (typeof oid !== "string" || !oid.trim()) {
    throw new Error("An ALeRCE object identifier is required.");
  }
  const response = await requestJson(
    `/ztf/v1/objects/${encodeURIComponent(oid)}/probabilities`,
    fetchImpl,
  );
  if (!Array.isArray(response)) {
    throw new Error("ALeRCE returned an unexpected classifier response.");
  }
  return response;
}

export function normalizeAlerceDetections(detections) {
  if (!Array.isArray(detections) || detections.length === 0) {
    throw new Error("ALeRCE has no detections to plot for this object.");
  }
  const normalized = detections.map((detection, index) => {
    if (!detection || typeof detection !== "object") {
      throw new Error(`ALeRCE returned an invalid detection at index ${index}.`);
    }
    const mjd = detection.mjd;
    const magnitude = Number.isFinite(detection.magpsf)
      ? detection.magpsf
      : detection.magpsf_corr;
    const fid = detection.fid;
    if (
      !Number.isFinite(mjd)
      || !Number.isFinite(magnitude)
      || !Number.isInteger(fid)
    ) {
      throw new Error(`ALeRCE returned an invalid detection at index ${index}.`);
    }
    const band = ({ 1: "g", 2: "r", 3: "i" })[fid] || `fid-${fid}`;
    return { mjd, band, magnitude };
  });
  const epochsByBand = new Map();
  normalized.forEach(({ mjd, band }) => {
    if (!epochsByBand.has(band)) epochsByBand.set(band, new Set());
    epochsByBand.get(band).add(mjd);
  });
  if (![...epochsByBand.values()].some((epochs) => epochs.size >= 2)) {
    throw new Error("ALeRCE light curve needs at least two distinct observing times in one band to plot.");
  }
  return normalized;
}

export function computeAlternativeSignals(epochs) {
  if (!Array.isArray(epochs) || epochs.length === 0) {
    throw new Error("At least one light-curve epoch is required.");
  }
  const magnitudes = epochs.map((epoch) => epoch.magnitude);
  const sortedMagnitudes = [...magnitudes].sort((a, b) => a - b);
  const median = getMedian(sortedMagnitudes);
  const mad = getMedian(sortedMagnitudes.map((value) => Math.abs(value - median)).sort((a, b) => a - b));
  const steps = epochs.slice(1).map((epoch, index) => ({
    magnitude: Math.abs(epoch.magnitude - epochs[index].magnitude),
    days: epoch.mjd - epochs[index].mjd,
  }));
  const gaps = steps.map((step) => step.days);

  return {
    peakToPeakMagnitude: sortedMagnitudes.at(-1) - sortedMagnitudes[0],
    medianAbsoluteDeviation: mad,
    robustMaxDeviation: mad === 0
      ? null
      : Math.max(...magnitudes.map((value) => Math.abs(value - median))) / (1.4826 * mad),
    largestAdjacentChangeMagnitude: steps.length
      ? Math.max(...steps.map((step) => step.magnitude))
      : null,
    largestObservationGapDays: gaps.length ? Math.max(...gaps) : null,
  };
}

export function buildEvidenceSummary(analysis, predictions) {
  const usablePredictions = predictions.filter(
    (prediction) => prediction
      && typeof prediction.classifier_name === "string"
      && Number.isFinite(prediction.probability),
  );
  const lightCurvePredictions = usablePredictions.filter(
    (prediction) => prediction.classifier_name === "lc_classifier",
  );
  const selectedModel = lightCurvePredictions[0]?.classifier_name
    || usablePredictions[0]?.classifier_name;
  const strongestPrediction = usablePredictions
    .filter((prediction) => prediction.classifier_name === selectedModel)
    .sort((left, right) => right.probability - left.probability)[0];
  const modelText = strongestPrediction
    ? `ALeRCE's ${strongestPrediction.classifier_name} model gives its highest returned class probability to ${strongestPrediction.class_name} (${(strongestPrediction.probability * 100).toFixed(1)}%). This is a model output, not a confirmed classification.`
    : "ALeRCE returned no usable classifier probabilities, so there is no model-supported class suggestion for this object.";
  const shapeText = analysis.status === "scored"
    ? analysis.score === 100
      ? `The best-sampled band (${analysis.band}) brightened before its brightest sampled epoch and faded afterwards. The prototype shape score is ${analysis.score}/100; this pattern can occur in supernovae but is not unique to them.`
      : `The best-sampled band (${analysis.band}) does not show both a brightening trend before peak and a fading trend after it. The prototype shape score is ${analysis.score}/100.`
    : `There are not enough observations around a peak in the best-sampled band (${analysis.band}) to score a rise-and-fade shape.`;
  return {
    modelText,
    shapeText,
    caveat: "Possible causes include a supernova or other transient, a variable star, an active galactic nucleus, or an image-subtraction/data-quality issue. These data alone cannot distinguish them.",
    nextSteps: "Inspect the science/reference/difference images, check catalog matches and prior variability, and gather follow-up observations in multiple bands.",
  };
}

function getMedian(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}
