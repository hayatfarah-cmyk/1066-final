# Link to Video

[Here](https://docs.google.com/videos/d/1-HTofDfeUHq-REVzMu-0t7rPUm0VNBUhq1sjI_bVUu4/play?usp=sharing)

---

## Adjustments to Previous Problem Statement

I think I was a bit over ambitious at the outset so I'm going to scale back on the project a bit. My new problem statement would be:

> Astronomers have far more transient alerts to go through than they can possibly investigate on their own. This project will look at whether an AI assistant can be of any use in helping to prioritise archived ZTF anomaly candidates. The system will be trained on data from one broker and a very limited set of alert information (mainly light curves) to score the candidates as to how likely they are to be members of one particular, well-represented transient class and provide a short explanation for the score based on the data. We'll then compare the rankings it produces against the TNS classifications and against the broker's own anomaly scores.

I can break this down into a couple of steps:

### Project Steps

- **Define the scope:** one broker, one transient class, the archived ZTF candidates and the light curves.
  - AI can be used to compare candidate classes and work down to a specific broker, dataset and measurable objective. I'd just have to refine the scope on the basis of time and data available.
- **Pilot the data:** make sure we have the candidates, the light curves, the broker scores and sufficient TNS labels.
  - AI can help write and adjust code to query the broker and TNS, inspect returned fields, and troubleshoot access issues
- **Build a labelled dataset:** match up the candidates with TNS, remove the duplicates and set the ones you're not sure about to one side.
  - AI can help define a data format, write matching and deduplication steps, and refine them after checking sample matches
- **Prepare the light curves:** clean and sort the measurements, then extract a small number of useful features.
  - AI can be used to investigate the missing values, clean and sort the measurements and test which of the features are useful in describing the light curves.
- **Split the data fairly:** ensure each object ends up in only one of the sets, ideally using a time-based split.
  - AI can be used to implement and validate an object level or time based split and then tweak it to prevent leakage.
- **Establish a baseline** by measuring how well the broker's anomaly score ranks the target class candidates.
  - AI can be used to work out the ranking metrics for the broker score and to explain what those metrics mean.
- **Train a simple model:** score and rank the candidates using the light curve features.
  - AI can be used to build a starter model, to compare alternatives and to tune it based on held-out results.
- **Add brief explanations:** link each prediction to the relevant light curve feature.
  - AI can be used to generate succinct explanations of the model outputs in terms of measurable features which I can then go and check against the data.
- **Compare and report:** assess both rankings on held out data and discuss the results and limitations.
  - AI can be used to help organise the results, produce the figures and identify the limitations. I can then iterate on the analysis whilst keeping the conclusions firmly rooted in the evidence.

A work schedule of this could look like:

### Work Schedule

- **Week 1 — Scope and data pilot:** Pick one broker and one well-represented transient class. Get a small sample and check that you have light curves, broker scores and sufficient TNS labels. Use the AI to help you look at the data and debug any access issues. If the pilot reveals a data gap then you'll need to adjust your class or scope.
- **Week 2: Build the dataset.** Collect a small candidate sample, match it to TNS, remove the duplicates, set the uncertain labels to one side and build up the basic light curve features. Use the AI to help write and check the processing code.
- **Week 3 — Baseline and model:** create a fair train/test split, assess how well the broker score ranks the target class and train up a simple model using the light curve features. Use the AI to do the analysis and interpret the metrics.
- **Week 4 — Evaluate and report:** compare both approaches on the held-out data, look at a few correct and a few incorrect predictions and write up the results and limitations. Add very brief feature based explanations if you have time. Use the AI to help you put the report together and to check that the claims are in fact backed up by the results.

I went with that ordering as each stage is dependent on the one that comes before it.

---

## Questions to Ask Mentor

1. Is this a worthwhile problem? Are there any other angles I could have looked at to add some depth?
2. Is the project viable? What could I afford to cut and still have a reasonable project at the end?
3. Are there any major issues that I'm missing?