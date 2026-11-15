import {
  buildEvidenceSummary,
  computeAlternativeSignals,
  fetchObjectLightCurve,
  fetchObjectProbabilities,
  fetchRecentEvents,
  MIN_PLOT_DETECTIONS,
  normalizeAlerceDetections,
} from "./alerce.mjs";
import {
  CACHE_MAX_AGE_MS,
  decodeCacheEntry,
  encodeCacheEntry,
} from "./dashboard-cache.mjs";

"use strict";

const SAMPLE_CURVE = `mjd,band,mag
60000,g,20.0
60001,g,19.2
60002,g,18.5
60003,g,18.0
60004,g,18.3
60005,g,18.8
60006,g,19.4`;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("The CSV has a quoted value that was never closed.");
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("Add a heading row and at least one observation.");

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  return rows.slice(1).map((values, index) => {
    const record = {};
    headers.forEach((header, column) => {
      record[header] = values[column];
    });
    record.__rowNumber = index + 2;
    return record;
  });
}

function numberFrom(record, name) {
  const value = record[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing "${name}" value on CSV row ${record.__rowNumber}.`);
  }
  const cleaned = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid "${name}" value on CSV row ${record.__rowNumber}.`);
  }
  const number = Number(cleaned);
  if (!Number.isFinite(number)) throw new Error(`Invalid "${name}" value on CSV row ${record.__rowNumber}.`);
  return number;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function readLightCurve(text) {
  const records = parseCsv(text);
  const observations = records.map((record) => {
    const mjd = numberFrom(record, "mjd");
    const magnitude = numberFrom(record, "mag");
    const band = typeof record.band === "string" ? record.band.trim().toLowerCase() : "";
    if (!band) throw new Error(`Missing "band" value on CSV row ${record.__rowNumber}.`);
    return { mjd, band, magnitude };
  });
  const times = observations.map((point) => point.mjd);
  const magnitudes = observations.map((point) => point.magnitude);
  const bands = [...new Set(observations.map((point) => point.band))].sort();
  const byBand = new Map();
  observations.forEach((point) => {
    if (!byBand.has(point.band)) byBand.set(point.band, new Map());
    const epochs = byBand.get(point.band);
    if (!epochs.has(point.mjd)) epochs.set(point.mjd, []);
    epochs.get(point.mjd).push(point.magnitude);
  });
  const [band, epochsByTime] = [...byBand.entries()].sort((left, right) =>
    right[1].size - left[1].size
    || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0),
  )[0];
  const epochs = [...epochsByTime.entries()]
    .map(([mjd, values]) => ({ mjd, magnitude: median(values) }))
    .sort((left, right) => left.mjd - right.mjd);
  let peakIndex = 0;
  epochs.forEach((epoch, index) => {
    if (epoch.magnitude < epochs[peakIndex].magnitude) peakIndex = index;
  });

  const summary = {
    observationCount: observations.length,
    durationDays: Math.max(...times) - Math.min(...times),
    bands,
    medianMagnitude: median(magnitudes),
    amplitudeMagnitude: Math.max(...magnitudes) - Math.min(...magnitudes),
  };
  const result = {
    summary,
    observations,
    band,
    epochs,
    score: null,
    status: "insufficient_data",
    peakMjd: null,
    riseRate: null,
    declineRate: null,
    explanation: "There are not enough observations on both sides of the brightest point to check the shape.",
  };

  const before = epochs.slice(0, peakIndex);
  const after = epochs.slice(peakIndex + 1);
  if (before.length < 2 || after.length < 2) return result;

  const slope = (points) => {
    const meanTime = points.reduce((sum, point) => sum + point.mjd, 0) / points.length;
    const meanMagnitude = points.reduce((sum, point) => sum + point.magnitude, 0) / points.length;
    const numerator = points.reduce(
      (sum, point) => sum + (point.mjd - meanTime) * (point.magnitude - meanMagnitude),
      0,
    );
    const denominator = points.reduce((sum, point) => sum + (point.mjd - meanTime) ** 2, 0);
    return numerator / denominator;
  };
  const peak = epochs[peakIndex];
  const riseRate = slope([...before, peak]);
  const declineRate = slope([peak, ...after]);
  const score = 50 * Number(riseRate < 0) + 50 * Number(declineRate > 0);
  Object.assign(result, {
    score,
    status: "scored",
    peakMjd: peak.mjd,
    riseRate,
    declineRate,
    explanation: score === 100
      ? "This curve got brighter before its brightest point and fainter afterwards. That matches the simple pattern this prototype checks for."
      : "This curve does not show both a clear brightening before its brightest point and fading afterwards.",
  });
  return result;
}

function formatNumber(number, digits = 3) {
  return Number.isInteger(number) ? String(number) : number.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function addStat(container, label, value) {
  const card = document.createElement("div");
  card.className = "result-stat";
  const name = document.createElement("span");
  name.textContent = label;
  const result = document.createElement("strong");
  result.textContent = value;
  card.append(name, result);
  container.append(card);
}

function showError(id, message) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.hidden = false;
}

function clearError(id) {
  const element = document.getElementById(id);
  element.textContent = "";
  element.hidden = true;
}

function renderPlot(svg, result) {
  const namespace = "http://www.w3.org/2000/svg";
  const make = (tag, attributes) => {
    const element = document.createElementNS(namespace, tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
  };
  const points = result.epochs;
  const width = 640;
  const height = 220;
  const padding = { top: 18, right: 20, bottom: 34, left: 54 };
  const magnitudes = points.map((point) => point.magnitude);
  const minTime = Math.min(...points.map((point) => point.mjd));
  const maxTime = Math.max(...points.map((point) => point.mjd));
  let minMagnitude = Math.min(...magnitudes);
  let maxMagnitude = Math.max(...magnitudes);
  if (minMagnitude === maxMagnitude) {
    minMagnitude -= 0.5;
    maxMagnitude += 0.5;
  }
  const x = (time) => padding.left + (maxTime === minTime ? 0.5 : (time - minTime) / (maxTime - minTime)) * (width - padding.left - padding.right);
  const y = (magnitude) => padding.top + (magnitude - minMagnitude) / (maxMagnitude - minMagnitude) * (height - padding.top - padding.bottom);

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-label", `Light curve in ${result.band} band. Smaller magnitude numbers appear brighter and higher on the chart.`);
  svg.append(make("title", {}));
  svg.firstChild.textContent = `Light curve in ${result.band} band`;
  svg.append(make("desc", {}));
  svg.lastChild.textContent = "Points show the median magnitude at each observing time. Smaller magnitude values are brighter.";
  [0, 0.5, 1].forEach((fraction) => {
    const lineY = padding.top + fraction * (height - padding.top - padding.bottom);
    svg.append(make("line", { x1: padding.left, y1: lineY, x2: width - padding.right, y2: lineY, stroke: "#33434a" }));
    const label = make("text", { x: 4, y: lineY + 4, fill: "#a7b2b1", "font-size": 10, "font-family": "monospace" });
    label.textContent = formatNumber(minMagnitude + fraction * (maxMagnitude - minMagnitude), 2);
    svg.append(label);
  });
  const path = points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${x(point.mjd)},${y(point.magnitude)}`,
  ).join(" ");
  svg.append(make("path", {
    d: path, fill: "none", stroke: "#c5f277", "stroke-width": 2.5,
    "stroke-linecap": "round", "stroke-linejoin": "round",
  }));
  points.forEach((point) => {
    svg.append(make("circle", {
      cx: x(point.mjd), cy: y(point.magnitude), r: 4,
      fill: "#101820", stroke: "#c5f277", "stroke-width": 2,
    }));
  });
  const axis = make("text", {
    x: width - padding.right, y: height - 5, fill: "#a7b2b1",
    "font-size": 10, "font-family": "monospace", "text-anchor": "end",
  });
  axis.textContent = "MJD (date)";
  svg.append(axis);
}

function renderAnalysis(result, name) {
  const summary = result.summary;
  document.getElementById("analysis-title").textContent = `Summary: ${name}`;
  const stats = document.getElementById("summary-stats");
  stats.replaceChildren();
  addStat(stats, "Observations", String(summary.observationCount));
  addStat(stats, "Time span", `${formatNumber(summary.durationDays)} days`);
  addStat(stats, "Bands (light colors)", summary.bands.join(", "));
  addStat(stats, "Median brightness", formatNumber(summary.medianMagnitude));
  addStat(stats, "Brightness range", `${formatNumber(summary.amplitudeMagnitude)} mag`);
  const explanation = document.getElementById("shape-explanation");
  explanation.replaceChildren();
  const score = document.createElement("strong");
  score.textContent = result.score === null ? "Not enough data for a shape score." : `Shape score: ${result.score} / 100.`;
  explanation.append(score, document.createTextNode(` ${result.explanation}`));
  if (result.peakMjd !== null) {
    explanation.append(document.createTextNode(
      ` The brightest point was at MJD ${formatNumber(result.peakMjd)}; the rise and fade rates were ${formatNumber(result.riseRate, 4)} and ${formatNumber(result.declineRate, 4)} mag/day.`,
    ));
  }
  renderPlot(document.getElementById("curve-plot"), result);
  document.getElementById("analysis-results").hidden = false;
}

function formatMjd(mjd) {
  if (!Number.isFinite(mjd)) return "MJD unavailable";
  const date = new Date((mjd - 40587) * 86400000);
  return `MJD ${formatNumber(mjd, 5)} · ${date.toLocaleDateString()}`;
}

function renderRecentEvents(events) {
  recentEvents = events.filter((event) => Number(event.ndet) >= MIN_PLOT_DETECTIONS);
  if (recentEvents.length === 0) {
    selectedObjectId = null;
    selectedEventIndex = -1;
    const detail = document.getElementById("event-detail");
    detail.replaceChildren();
    addDetailHeading(detail, "No plottable sources available", "The feed will try again when it refreshes.");
    updateRotationStatus();
    return null;
  }
  recentEvents.forEach((event) => {
    if (typeof event.oid !== "string" || !event.oid) {
      throw new Error("ALeRCE returned an object without an identifier.");
    }
  });
  const existingIndex = recentEvents.findIndex((event) => event.oid === selectedObjectId);
  if (existingIndex === -1) {
    selectedEventIndex = 0;
    selectedObjectId = recentEvents[0].oid;
  } else {
    selectedEventIndex = existingIndex;
  }
  updateRotationStatus();
  return selectedObjectId;
}

function addDetailHeading(container, title, description) {
  const wrapper = document.createElement("div");
  wrapper.className = "event-detail-heading";
  const identity = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "ALeRCE · ZTF SOURCE";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const summary = document.createElement("p");
  summary.textContent = description;
  identity.append(eyebrow, heading);
  wrapper.append(identity, summary);
  container.append(wrapper);
}

function addDetailStat(container, label, value) {
  const card = document.createElement("div");
  card.className = "result-stat";
  const name = document.createElement("span");
  name.textContent = label;
  const result = document.createElement("strong");
  result.textContent = value;
  card.append(name, result);
  container.append(card);
}

function renderProbabilities(container, predictions) {
  const groupedPredictions = new Map();
  predictions
    .filter((prediction) => prediction
      && typeof prediction.classifier_name === "string"
      && typeof prediction.class_name === "string"
      && Number.isFinite(prediction.probability))
    .forEach((prediction) => {
      if (!groupedPredictions.has(prediction.classifier_name)) {
        groupedPredictions.set(prediction.classifier_name, []);
      }
      groupedPredictions.get(prediction.classifier_name).push(prediction);
    });

  const heading = document.createElement("h4");
  heading.className = "classifier-title";
  heading.textContent = "MODEL PROBABILITIES";
  const modelCount = document.createElement("span");
  modelCount.textContent = `${groupedPredictions.size} ${groupedPredictions.size === 1 ? "MODEL" : "MODELS"}`;
  heading.append(modelCount);
  container.append(heading);
  if (groupedPredictions.size === 0) {
    const empty = document.createElement("p");
    empty.className = "classifier-empty";
    empty.textContent = "No classifier output available.";
    container.append(empty);
    return;
  }
  const models = document.createElement("div");
  models.className = "probability-models";
  [...groupedPredictions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([classifierName, modelPredictions]) => {
      const model = document.createElement("div");
      model.className = "probability-model";
      const name = document.createElement("span");
      name.className = "probability-model-name";
      name.textContent = ({
        lc_classifier: "Light curve",
        stamp_classifier: "Image stamp",
        stamp_classifier_2025_beta: "Stamp · 2025 beta",
      })[classifierName] || classifierName;
      name.title = classifierName;
      const scores = document.createElement("div");
      scores.className = "probability-values";
      modelPredictions
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 3)
        .forEach((prediction) => {
          const chip = document.createElement("div");
          chip.className = "probability-chip";
          chip.title = `${prediction.class_name}: ${formatNumber(prediction.probability * 100, 1)}%`;
          const label = document.createElement("span");
          label.className = "probability-class";
          label.textContent = prediction.class_name;
          const value = document.createElement("span");
          value.className = "probability-value";
          value.textContent = `${formatNumber(prediction.probability * 100, 1)}%`;
          chip.append(label, value);
          scores.append(chip);
        });
      model.append(name, scores);
      models.append(model);
    });
  container.append(models);

  const guide = document.createElement("details");
  guide.className = "probability-guide";
  const summary = document.createElement("summary");
  summary.textContent = "Model estimates—not confirmed chances · how to read";
  const explanation = document.createElement("div");
  explanation.className = "probability-guide-content";
  [
    "A class is a possible label, such as supernova. A value of 0.80 is displayed as 80%: it is the score this model assigned to that label, not proof the label is correct.",
    "Only if a model is well-calibrated on similar data would an 80% score mean that, across many similar cases, about 8 in 10 belong to that class. This page does not test calibration.",
    "Light-curve models look at brightness changes over time; image-stamp models inspect a small telescope image. They use different clues, so their scores are not directly comparable.",
    "Only the three highest-scoring classes per model are shown. The visible values may not add to 100%; a missing score means no output was available, not a score of zero.",
  ].forEach((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    explanation.append(paragraph);
  });
  guide.append(summary, explanation);
  container.append(guide);
}

function renderSignals(container, signals) {
  const heading = document.createElement("h4");
  heading.textContent = "Other anomaly checks · best-sampled band";
  const grid = document.createElement("div");
  grid.className = "signal-grid";
  addDetailStat(grid, "Peak-to-peak range", `${formatNumber(signals.peakToPeakMagnitude)} mag`);
  addDetailStat(
    grid,
    "Maximum robust z-score",
    signals.robustMaxDeviation === null
      ? "n/a (MAD = 0)"
      : formatNumber(signals.robustMaxDeviation),
  );
  addDetailStat(
    grid,
    "Largest adjacent change",
    signals.largestAdjacentChangeMagnitude === null
      ? "n/a"
      : `${formatNumber(signals.largestAdjacentChangeMagnitude)} mag`,
  );
  addDetailStat(
    grid,
    "Largest observing gap",
    signals.largestObservationGapDays === null
      ? "n/a"
      : `${formatNumber(signals.largestObservationGapDays)} days`,
  );
  const note = document.createElement("p");
  note.className = "signal-note";
  note.textContent = "These are diagnostic signals, not calibrated anomaly scores. A robust-deviation value is unavailable when the median absolute deviation is zero.";
  container.append(heading, grid, note);
}

function renderEvidence(container, analysis, predictions) {
  const evidence = buildEvidenceSummary(analysis, predictions);
  const heading = document.createElement("h4");
  heading.textContent = "What the available evidence may suggest";
  const block = document.createElement("div");
  block.className = "evidence-block";
  [evidence.modelText, evidence.shapeText, evidence.caveat, evidence.nextSteps].forEach((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    block.append(paragraph);
  });
  container.append(heading, block);
}

let selectedObjectId = null;
let refreshInProgress = false;
let rotationTimer = null;
let rotationMode = "auto";
let recentEvents = [];
let selectedEventIndex = -1;
const objectDetailsCache = new Map();
const RECENT_CACHE_KEY = "lightcurve.alerce.recent.v1";
const OBJECT_CACHE_KEY = "lightcurve.alerce.objects.v1";
const ROTATION_MODE_KEY = "lightcurve.alerce.rotation-mode.v1";

function readPersistentCache(key) {
  try {
    const serialized = window.localStorage.getItem(key);
    const entry = decodeCacheEntry(serialized);
    if (!entry && serialized !== null) {
      window.localStorage.removeItem(key);
    }
    return entry;
  } catch (error) {
    console.warn(`Could not read the saved dashboard cache "${key}".`, error);
    return null;
  }
}

function writePersistentCache(key, value) {
  try {
    window.localStorage.setItem(key, encodeCacheEntry(value));
  } catch (error) {
    console.warn(`Could not save dashboard cache "${key}".`, error);
  }
}

function readCachedObject(oid) {
  const cache = readPersistentCache(OBJECT_CACHE_KEY)?.value;
  const savedObject = cache?.[oid];
  if (
    !savedObject
    || !Number.isFinite(savedObject.savedAt)
    || !Array.isArray(savedObject.points)
    || Date.now() - savedObject.savedAt > CACHE_MAX_AGE_MS
  ) return null;
  try {
    const knownBands = { g: 1, r: 2, i: 3 };
    const points = normalizeAlerceDetections(savedObject.points.map((point) => {
      const unknownBand = /^fid-(\d+)$/.exec(point.band);
      const fid = knownBands[point.band] ?? Number(unknownBand?.[1]);
      return { mjd: point.mjd, fid, magpsf: point.magnitude };
    }));
    return {
      points,
      predictions: Array.isArray(savedObject.predictions) ? savedObject.predictions : null,
      savedAt: savedObject.savedAt,
    };
  } catch (error) {
    console.warn(`Ignoring invalid cached light curve for ${oid}.`, error);
    return null;
  }
}

function updateCachedObject(oid, updates) {
  const cache = readPersistentCache(OBJECT_CACHE_KEY)?.value || {};
  const next = {
    ...cache,
    [oid]: {
      ...cache[oid],
      ...updates,
      savedAt: Date.now(),
    },
  };
  const recent = Object.entries(next)
    .sort((left, right) => right[1].savedAt - left[1].savedAt)
    .slice(0, 8);
  writePersistentCache(OBJECT_CACHE_KEY, Object.fromEntries(recent));
}

function getObjectRequests(oid) {
  const existing = objectDetailsCache.get(oid);
  if (existing) return existing;

  const requests = {
    lightCurve: fetchObjectLightCurve(oid).then((detections) => {
      const points = normalizeAlerceDetections(detections);
      updateCachedObject(oid, { points });
      return points;
    }),
    probabilities: fetchObjectProbabilities(oid).then((predictions) => {
      updateCachedObject(oid, { predictions });
      return predictions;
    }),
  };
  objectDetailsCache.set(oid, requests);
  if (objectDetailsCache.size > 24) {
    objectDetailsCache.delete(objectDetailsCache.keys().next().value);
  }
  requests.lightCurve = requests.lightCurve.catch((error) => {
    if (objectDetailsCache.get(oid) === requests) objectDetailsCache.delete(oid);
    throw error;
  });
  requests.probabilities = requests.probabilities.catch((error) => {
    if (objectDetailsCache.get(oid) === requests) objectDetailsCache.delete(oid);
    throw error;
  });
  return requests;
}

function renderObjectCurve(detail, oid, detections, cachedAt = null) {
  const csv = [
    "mjd,band,mag",
    ...detections.map((point) => `${point.mjd},${point.band},${point.magnitude}`),
  ].join("\n");
  const analysis = readLightCurve(csv);
  const signals = computeAlternativeSignals(analysis.epochs);
  const lastObservation = Math.max(...detections.map((point) => point.mjd));
  detail.replaceChildren();
  detail.classList.remove("is-transitioning");
  void detail.offsetWidth;
  detail.classList.add("is-transitioning");
  addDetailHeading(
    detail,
    oid,
    `${detections.length} detections · last observation ${formatMjd(lastObservation)}${cachedAt ? ` · cached ${new Date(cachedAt).toLocaleString()}` : ""}`,
  );
  const stats = document.createElement("div");
  stats.className = "result-grid";
  addDetailStat(stats, "Bands", analysis.summary.bands.join(", "));
  addDetailStat(stats, "Time span", `${formatNumber(analysis.summary.durationDays)} days`);
  addDetailStat(stats, "Shape heuristic", analysis.score === null ? "insufficient data" : `${analysis.score} / 100`);
  detail.append(stats);

  const plot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  plot.classList.add("curve-plot");
  plot.setAttribute("role", "img");
  renderPlot(plot, analysis);
  detail.append(plot);
  renderSignals(detail, signals);
  const classifierRegion = document.createElement("div");
  classifierRegion.className = "classifier-region";
  detail.append(classifierRegion);
  return analysis;
}

function renderClassifierRegion(container, analysis, predictions, error = null) {
  container.replaceChildren();
  if (predictions === null && !error) {
    const loading = document.createElement("p");
    loading.className = "field-help";
    loading.textContent = "Light curve loaded. Fetching classifier outputs…";
    container.append(loading);
    return;
  }
  if (predictions !== null) {
    renderProbabilities(container, predictions);
    renderEvidence(container, analysis, predictions);
  }
  if (error) {
    const warning = document.createElement("p");
    warning.className = "field-help";
    warning.textContent = `ALeRCE classifier probabilities could not be loaded: ${error.message}`;
    container.append(warning);
  }
}

function updateRotationStatus() {
  const count = document.getElementById("rotation-count");
  if (count) {
    count.textContent = selectedEventIndex < 0
      ? "-- / --"
      : `${String(selectedEventIndex + 1).padStart(2, "0")} / ${String(recentEvents.length).padStart(2, "0")}`;
  }
  const readyToBrowse = recentEvents.length > 1;
  document.getElementById("rotation-label").textContent = !readyToBrowse
    ? "WAITING FOR SOURCES"
    : rotationMode === "auto"
      ? "AUTO SCAN · EVERY 12 SEC"
      : "MANUAL BROWSE";
  document.getElementById("previous-object").disabled = !readyToBrowse;
  document.getElementById("next-object").disabled = !readyToBrowse;
}

function scheduleAutoRotation() {
  if (rotationTimer !== null) {
    window.clearInterval(rotationTimer);
    rotationTimer = null;
  }
  if (rotationMode !== "auto") return;
  rotationTimer = window.setInterval(() => {
    if (!document.hidden && recentEvents.length > 1) advanceObject();
  }, 12000);
}

function restartRotationProgress() {
  const progress = document.getElementById("rotation-progress");
  progress.classList.remove("is-running");
  void progress.offsetWidth;
  progress.classList.add("is-running");
}

function preloadAdjacentObject(direction = 1) {
  if (recentEvents.length < 2) return;
  const index = (selectedEventIndex + direction + recentEvents.length) % recentEvents.length;
  const adjacentObject = recentEvents[index];
  if (readCachedObject(adjacentObject.oid)) return;
  const requests = getObjectRequests(adjacentObject.oid);
  requests.lightCurve.catch(() => {});
  requests.probabilities.catch(() => {});
}

async function loadRecentEvents() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  const status = document.getElementById("dashboard-status");
  clearError("dashboard-error");
  status.textContent = recentEvents.length
    ? `Refreshing ${recentEvents.length} saved objects in the background…`
    : "Loading recent objects…";
  try {
    const events = await fetchRecentEvents();
    writePersistentCache(RECENT_CACHE_KEY, events);
    const previousObjectId = selectedObjectId;
    const selectedId = renderRecentEvents(events);
    if (selectedId && selectedId !== previousObjectId) {
      restartRotationProgress();
      scheduleAutoRotation();
      loadObjectDetail(selectedId);
    }
    status.textContent = `${recentEvents.length} sources · feed updated ${new Date().toLocaleTimeString()}`;
    document.getElementById("feed-state").textContent = "ONLINE";
    preloadAdjacentObject();
  } catch (error) {
    status.textContent = "Refresh failed; showing any previously loaded results.";
    document.getElementById("feed-state").textContent = "RETRY";
    showError("dashboard-error", `Could not load recent ALeRCE objects: ${error.message}`);
  } finally {
    refreshInProgress = false;
  }
}

function advanceObject(direction = 1) {
  if (recentEvents.length === 0) return;
  selectedEventIndex = (selectedEventIndex + direction + recentEvents.length) % recentEvents.length;
  selectedObjectId = recentEvents[selectedEventIndex].oid;
  updateRotationStatus();
  restartRotationProgress();
  loadObjectDetail(selectedObjectId);
  preloadAdjacentObject(direction);
}

function setRotationMode(mode, persist = true) {
  rotationMode = mode === "manual" ? "manual" : "auto";
  document.getElementById("auto-mode").setAttribute("aria-pressed", String(rotationMode === "auto"));
  document.getElementById("manual-mode").setAttribute("aria-pressed", String(rotationMode === "manual"));
  document.getElementById("manual-controls").hidden = rotationMode !== "manual";
  document.getElementById("rotation-track").hidden = rotationMode !== "auto";
  document.getElementById("mode-hint").textContent = rotationMode === "auto"
    ? "Automatically advances every 12 seconds"
    : "Use previous and next to browse sources";
  updateRotationStatus();
  if (rotationMode === "auto") {
    restartRotationProgress();
  }
  scheduleAutoRotation();
  if (persist) writePersistentCache(ROTATION_MODE_KEY, rotationMode);
}

function loadObjectDetail(oid) {
  selectedObjectId = oid;
  const detail = document.getElementById("event-detail");
  let analysis = null;
  let predictions = null;
  let predictionError = null;
  const cached = readCachedObject(oid);
  try {
    if (cached) {
      analysis = renderObjectCurve(detail, oid, cached.points, cached.savedAt);
      predictions = cached.predictions;
      renderClassifierRegion(detail.querySelector(".classifier-region"), analysis, predictions);
    } else {
      detail.replaceChildren();
      addDetailHeading(detail, oid, "Loading saved curve or retrieving ALeRCE photometry…");
    }
  } catch (error) {
    console.warn(`Could not display the saved light curve for ${oid}.`, error);
    detail.replaceChildren();
    addDetailHeading(detail, oid, "Retrieving ALeRCE photometry…");
  }

  const requests = getObjectRequests(oid);
  const cachedPoints = cached ? JSON.stringify(cached.points) : null;
  requests.lightCurve.then((detections) => {
    if (selectedObjectId !== oid) return;
    if (cachedPoints !== null && cachedPoints === JSON.stringify(detections)) return;
    try {
      analysis = renderObjectCurve(detail, oid, detections);
      renderClassifierRegion(
        detail.querySelector(".classifier-region"),
        analysis,
        predictions,
        predictionError,
      );
    } catch (error) {
      detail.replaceChildren();
      addDetailHeading(detail, oid, `Could not interpret the returned light curve: ${error.message}`);
    }
  }).catch((error) => {
    if (selectedObjectId !== oid) return;
    if (analysis) {
      const warning = document.createElement("p");
      warning.className = "field-help";
      warning.textContent = `Could not refresh the saved light curve: ${error.message}`;
      detail.prepend(warning);
      return;
    }
    detail.replaceChildren();
    addDetailHeading(detail, oid, `Could not load a plottable light curve: ${error.message}`);
  });

  requests.probabilities.then((freshPredictions) => {
    if (selectedObjectId !== oid) return;
    predictions = freshPredictions;
    predictionError = null;
    if (analysis) {
      renderClassifierRegion(
        detail.querySelector(".classifier-region"),
        analysis,
        predictions,
      );
    }
  }).catch((error) => {
    if (selectedObjectId !== oid) return;
    predictionError = error;
    if (analysis) {
      renderClassifierRegion(
        detail.querySelector(".classifier-region"),
        analysis,
        predictions,
        predictionError,
      );
    }
  });
}

document.querySelectorAll("[data-navigation-mode]").forEach((button) => {
  button.addEventListener("click", () => setRotationMode(button.dataset.navigationMode));
});
document.getElementById("previous-object").addEventListener("click", () => advanceObject(-1));
document.getElementById("next-object").addEventListener("click", () => advanceObject(1));

document.getElementById("sample-button").addEventListener("click", () => {
  document.getElementById("curve-csv").value = SAMPLE_CURVE;
  document.getElementById("curve-file").value = "";
  clearError("analysis-error");
});

document.getElementById("curve-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    document.getElementById("curve-csv").value = await file.text();
    clearError("analysis-error");
  } catch (error) {
    showError("analysis-error", `Could not read the file: ${error.message}`);
  }
});

document.getElementById("analyze-button").addEventListener("click", () => {
  clearError("analysis-error");
  try {
    const result = readLightCurve(document.getElementById("curve-csv").value);
    renderAnalysis(result, document.getElementById("curve-file").files[0]?.name || "pasted CSV");
  } catch (error) {
    document.getElementById("analysis-results").hidden = true;
    showError("analysis-error", error.message);
  }
});

document.getElementById("rank-button").addEventListener("click", async () => {
  clearError("rank-error");
  const files = [...document.getElementById("rank-files").files];
  if (files.length === 0) {
    showError("rank-error", "Choose at least one light-curve CSV file to rank.");
    return;
  }
  try {
    const candidates = await Promise.all(files.map(async (file) => ({
      name: file.name,
      ...readLightCurve(await file.text()),
    })));
    candidates.sort((left, right) =>
      Number(left.score === null) - Number(right.score === null)
      || (right.score ?? 0) - (left.score ?? 0)
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
    const list = document.getElementById("rank-list");
    list.replaceChildren();
    candidates.forEach((candidate) => {
      const item = document.createElement("li");
      item.className = "rank-item";
      const name = document.createElement("span");
      name.textContent = candidate.name;
      const score = document.createElement("span");
      score.textContent = candidate.score === null ? "Not enough data" : `${candidate.score} / 100`;
      item.append(name, score);
      list.append(item);
    });
    document.getElementById("rank-results").hidden = false;
  } catch (error) {
    document.getElementById("rank-results").hidden = true;
    showError("rank-error", error.message);
  }
});

document.getElementById("evaluation-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    document.getElementById("evaluation-csv").value = await file.text();
    clearError("evaluation-error");
  } catch (error) {
    showError("evaluation-error", `Could not read the file: ${error.message}`);
  }
});

function readEvaluation(text) {
  const rows = parseCsv(text);
  if (rows.length < 3) throw new Error("Include at least three labeled candidates.");
  const ids = new Set();
  return rows.map((row) => {
    const id = typeof row.candidate_id === "string" ? row.candidate_id.trim() : "";
    const label = typeof row.is_supernova === "string" ? row.is_supernova.trim().toLowerCase() : "";
    if (!id || ids.has(id) || !["0", "1", "false", "true"].includes(label)) {
      throw new Error(`Invalid or duplicate candidate on CSV row ${row.__rowNumber}.`);
    }
    ids.add(id);
    return {
      id,
      date: numberFrom(row, "discovery_mjd"),
      positive: label === "1" || label === "true",
      shape: numberFrom(row, "shape_score"),
      broker: numberFrom(row, "broker_anomaly_score"),
    };
  });
}

function rankingMetrics(holdout, positives, field, k) {
  const ranked = [...holdout].sort((left, right) =>
    right[field] - left[field]
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  const top = ranked.slice(0, Math.min(k, ranked.length));
  const precision = top.filter((candidate) => candidate.positive).length / top.length;
  let relevantSeen = 0;
  let precisionSum = 0;
  ranked.forEach((candidate, index) => {
    if (candidate.positive) {
      relevantSeen += 1;
      precisionSum += relevantSeen / (index + 1);
    }
  });
  return { precision, averagePrecision: precisionSum / positives };
}

function evaluate(text, fraction, k) {
  if (!(fraction > 0 && fraction < 1)) throw new Error("Holdout fraction must be greater than 0 and less than 1.");
  if (!Number.isInteger(k) || k < 1) throw new Error("Precision at K must be a whole number greater than 0.");
  const candidates = readEvaluation(text);
  const orderedDates = candidates.map((candidate) => candidate.date).sort((a, b) => a - b);
  const trainCount = Math.min(
    candidates.length - 1,
    Math.max(1, Math.floor(candidates.length * (1 - fraction))),
  );
  const cutoff = orderedDates[trainCount];
  const holdout = candidates.filter((candidate) => candidate.date >= cutoff);
  const positives = holdout.filter((candidate) => candidate.positive).length;
  if (positives === 0 || positives === holdout.length) {
    throw new Error("The latest holdout must include both supernova and non-supernova candidates.");
  }
  return {
    cutoff,
    holdoutCount: holdout.length,
    positives,
    shape: rankingMetrics(holdout, positives, "shape", k),
    broker: rankingMetrics(holdout, positives, "broker", k),
    k,
  };
}

document.getElementById("evaluate-button").addEventListener("click", () => {
  clearError("evaluation-error");
  try {
    const fraction = Number(document.getElementById("test-fraction").value);
    const k = Number(document.getElementById("precision-at").value);
    const report = evaluate(document.getElementById("evaluation-csv").value, fraction, k);
    const results = document.getElementById("evaluation-results");
    results.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = `Holdout results (${report.holdoutCount} candidates from MJD ${formatNumber(report.cutoff)})`;
    const note = document.createElement("p");
    note.className = "field-help";
    note.textContent = `${report.positives} positive labels. Higher scores rank candidates first; tied scores are ordered by candidate ID.`;
    const table = document.createElement("table");
    const header = document.createElement("tr");
    ["Ranking", `Precision@${report.k}`, "Average precision"].forEach((title) => {
      const cell = document.createElement("th");
      cell.textContent = title;
      header.append(cell);
    });
    const thead = document.createElement("thead");
    thead.append(header);
    const tbody = document.createElement("tbody");
    [
      ["Shape heuristic", report.shape],
      ["Broker anomaly score", report.broker],
    ].forEach(([label, metrics]) => {
      const row = document.createElement("tr");
      [label, formatNumber(metrics.precision, 4), formatNumber(metrics.averagePrecision, 4)].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      tbody.append(row);
    });
    table.append(thead, tbody);
    results.append(heading, note, table);
    results.hidden = false;
  } catch (error) {
    document.getElementById("evaluation-results").hidden = true;
    showError("evaluation-error", error.message);
  }
});

const cachedFeed = readPersistentCache(RECENT_CACHE_KEY);
try {
  if (cachedFeed && Array.isArray(cachedFeed.value)) {
    const cachedSelection = renderRecentEvents(cachedFeed.value);
    if (cachedSelection) loadObjectDetail(cachedSelection);
    document.getElementById("dashboard-status").textContent =
      `Showing saved feed from ${new Date(cachedFeed.savedAt).toLocaleString()} · syncing live data…`;
    document.getElementById("feed-state").textContent = "CACHED";
  }
} catch (error) {
  console.warn("Could not display the saved ALeRCE feed; loading fresh data instead.", error);
}
const savedRotationMode = readPersistentCache(ROTATION_MODE_KEY)?.value;
setRotationMode(savedRotationMode === "manual" ? "manual" : "auto", false);
loadRecentEvents();
window.setInterval(() => {
  if (!document.hidden) loadRecentEvents();
}, 60000);
