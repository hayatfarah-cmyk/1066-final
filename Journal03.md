# Journal 03: Prototype check-in

The prototype now has three stages:

1. Summarise a CSV light curve with the number of observations, time span, filters used, median magnitude and amplitude.
2. Rank the various candidate light curves using a transparent (and unvalidated) heuristic for a supernova-like shape.
3. Compare a supplied shape score to a broker anomaly score on a chronological labelled holdout, reporting precision@K and average precision.

The shape heuristic looks at the band with the most distinct observing epochs, finds its brightest sampled point and then looks for a brightening (rising) trend prior to that point and a fading (decreasing) trend after it. The score is 0, 50 or 100 depending on whether neither, one or both of those trends are present. It returns `insufficient_data` rather than making a guess if there aren't at least two distinct epochs on either side of the peak.

The evaluation input is one row per candidate with candidate_id, discovery_mjd, is_supernova (true/false or 1/0), shape_score and broker_anomaly_score. Higher score values are taken to imply higher rank for both methods. The evaluation uses the most recent candidates in chronological order and requires both classes to be present in that holdout.

This is just a working prototype for user feedback. The score is not a probability, has not been calibrated and does not in any way constitute a declaration that an object is a supernova. Both example files contain synthetic data; the metrics in those files are purely a test of the pipeline and should not be interpreted as any form of scientific evidence. A broker dataset with independently matched labels is still required before the ranking can be scientifically evaluated. Scores must be computed only from information available at the decision time point in order to avoid leakage.

To run:

```bash
python prototype/lightcurve_summary.py demo/light_curve.csv
python prototype/lightcurve_summary.py --rank-supernova-shape \
  demo/light_curve.csv demo/supernova_shape_example.csv
python prototype/lightcurve_summary.py --evaluate-rankings \
  demo/evaluation_example.csv --test-fraction 0.3 --precision-at 5
pytest -q
```

The next real step is to gather a small ALeRCE ZTF sample, match the labels independently and then produce the evaluation table from the real candidates.

## Feedback response and next steps

- The so-called "AI assistant' is in fact not an AI model that has been trained to produce natural language explanations. It is a deterministic shape heuristic which will output a score, the selected band, the peak time and the fitted rise and fall rates. The 'assistant' we're talking about is currently the ranking prototype itself, not some separate explanation generation model.
- Check the explanations against the data: the reasoning is plainly visible in the light curve. The code identifies the brightest point in the sample and looks for an increasing trend prior to it and a decreasing trend after it. I'll be looking at those trends in the light curves that have actually been plotted/observed rather than treating the score as evidence in its own right.
- Concern about the broker anomaly score: that's a valid point as anomaly detection and supernova ranking are two very different things. The broker score is still very much an exploratory comparator rather than a true baseline. Future work should include a proper comparison method and independently matched labels.
- Suggested features: the rise and decline rates are already calculated for the scored curves. Peak brightness is not currently a reported feature and colour is not modelled as the current heuristic works on one band at a time. Those are very clear next steps, with colour being the obvious next thing to add (and that would require appropriately matched multi-band epochs).
- Real data: the current project reads CSVs and doesn't do any automatic broker data fetching. ALeRCE's Python client can be used to pull the ZTF detections, map the filter IDs to g/r/i and produce the mjd,band,mag CSVs that the existing CLI is expecting. That manual route still needs to be implemented and documented as a reusable import command before we can get to the point of having a fully automated data collection pipeline.
- Evaluation correction: the ranking metrics must use only the score from each method, not the labels. We've removed a tie-breaker that was using the labels (i.e. the answer) to determine the order of the candidates; ties now use the candidate ID for deterministic ordering. On the existing holdout set the shape metric is precision@2 = 0.5 and average precision = 0.8333. Tests have been run to confirm the corrected behaviour.

The project is still very much a prototype. Any validation against real curves and against independently curated labels is going to be essential before you draw any scientific conclusions.