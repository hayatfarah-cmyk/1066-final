# Journal 01: Final Project Proposal

**Project title:** *The Night Shift Astronomer: A Tool-Using AI Agent That Vets Anomalous Transients in the Rubin Observatory Alert Stream and Decides What Deserves a Telescope*

**Date:** October 18, 2026

---

## 1. The problem, what makes it unique, and why it excites me

Vera C. Rubin Observatory started issuing public alerts on 24th February 2026 and began its 10 year Legacy Survey of Space and Time on 30th June 2026. Each night it images the southern sky and produces up to 7 million alerts, each of which is an alert that something has changed: an asteroid has moved, a star has flared, a supernova has appeared or a black hole has gone to work tearing a star apart. Over the course of the decade there will be some 20 billion alerts.

The vast majority of these are the mundane. The scientific prizes are the rare ones: TDEs, kilonovae from neutron star mergers, superluminous supernovae, fast blue optical transients and all the others that we haven't even given a name to yet. The issue is that a rare event is only of any use if you can get a spectroscopic telescope to look at it within hours or days and spectroscopic observing time is of course very limited. Every night someone has to go through the thousands of unusual candidates and decide which small number are worth the time.

Today that's someone who is a human astronomer. The anomaly detection systems (ALeRCE's anomaly detector, LAISS on the ANTARES broker, the Fink anomaly module and the 2026 AHA pipeline on Lasair) all do the initial filtering and reduce the stream down to a small number of candidates. LAISS for instance produces between 1 and 5 candidates per night for the human expert to look at. The expert then opens the candidate, gets the light curve, checks the catalogues for a host galaxy or a known variable star, checks for any prior activity, looks at the colour and the rise time in comparison to known types and makes a decision. That vetting stage is the one which cannot scale to Rubin and it's the stage that this project is automating.

I'd like to build an agentic AI vetting system which, given an anomaly candidate from a public broker, gives precisely what an astronomer wants: a calibrated 'follow-up worthiness' score, a ranked list of physical hypotheses, the specific observation that would discriminate between them and a written justification that a human can audit. The agent would:

1. Get the context via the relevant tools rather than from memory: use the Lasair, Fink and ALeRCE APIs to get the full light curve and image cutouts; cross-match the position against the Gaia, Pan-STARRS and the various legacy survey catalogues to find the host galaxies and any known variables; check the TNS for any prior reports; and get the archived ZTF and ATLAS photometry at that position.
2. Generate competing physical hypotheses (an artefact, a known variable, an ordinary supernova, an AGN flare, a tidal disruption event or something which cannot be classified) and fit simple physical models to the light curve in order to assign a score to each.
3. Think about what to do next (which observation would be most useful in reducing the uncertainty and is the candidate bright and well placed to get it)?
4. Provide a calibrated score along with a reasoning trace and then learn from the result. When the Transient Name Server subsequently issues a classification the system will compare its prediction to the true value and update its few shot examples and thresholds accordingly.

What's special here is that the agent is a decision maker that uses tools, considers hypotheses and justifies its actions. It's all operating on a live scientific data stream which didn't exist eight months ago. I'm really excited about this as the Rubin survey is just getting going so an undergrad project this year can actually connect to the discovery infrastructure. The central question is of course about intelligence itself: can an AI system match the judgement of an expert astronomer and can we tell when it's right?

### Research summary: why existing solutions are insufficient

- **Anomaly detection pipelines (ALeRCE, LAISS, Fink, AHA):** These pipelines are well established and are capable of detecting statistical outliers in light curves and image stamps. Yet the output of each one is a list, and all of the published pipelines end with "for expert vetting". None of them gather external context, propose hypotheses, or recommend that an observation be made.
— Using an LLM for classification (Stoppa et al., Nature Astronomy, October 2025): When given fifteen examples and some simple instructions, Gemini was able to classify image stamps from Pan-STARRS, MeerLICHT, and ATLAS as either real or fake with an accuracy of about 93 per cent, at the same time producing explanations that were readable by humans; and when a second LLM verified the coherence of the output, accuracy on one of the datasets increased from 93.4 per cent to 96.7 per cent. This shows that LLMs can carry out single-step image classification and produce interpretable results. The method makes no use of tools, does not involve an analysis of light curves or catalogues, and instead distinguishes between real and fake cases rather than between rare and worth-ignoring ones.
- AstroAlertBench (May 2026): This is a benchmark consisting of 1,500 ZTF alerts and is intended for assessing the accuracy, reasoning capabilities, and honesty of multimodal large language models when classifying astronomical events. It functions as an evaluation tool and not as an operational system, the fact that it exists indicating that the community considers the quality of LLM reasoning regarding alerts to be an open issue.
- **Spec-o3 (January 2026):** This is a vision-language agent enhanced with tools which examines spectra in order to evaluate potential rare objects; it is the most similar in terms of architecture, although it works with spectra that are already available. My project, on the other hand, comes earlier in the process since it is responsible for deciding which candidates should get a spectrum to begin with.
- **Follow-up automation (AAS2RTO, 2025):** These are rule-based systems which keep an eye on Fink streams and initiate observations by means of fixed filters; they are unable to deal with ambiguous situations, whereas this is exactly the type of scenario in which experts spend their time.

Conclusion: the components function separately. There is no example of a tool-using agent which carries out the complete vetting-to-prioritization process on live Rubin alerts, evaluates its own level of confidence, and is then assessed in light of what spectroscopy later showed. It is this integration, along with the evaluation of whether the agent's stated reasoning actually matches its correctness, that constitutes the contribution.

### Data availability and feasibility check

- **Live alerts.** Rubin alert packets are made public from the beginning, with no proprietary phase, and are distributed by the community brokers. All of Lasair, Fink, ALeRCE, ANTARES, and Pitt-Google offer public web interfaces and APIs, and the brokers have been getting Rubin alerts since February 2026. There is no need for a data-rights agreement in relation to the alerts.
– Historical training and backtesting data. Since 2018 the ZTF has produced up to one million public alerts each night via the same brokers, and the Transient Name Server assigns spectroscopic classifications to thousands of transients every year. By matching the archived ZTF anomaly candidates with their later TNS classifications a labelled dataset is obtained for use in retrospective evaluation prior to any live data being employed.
- The context can be catalogued by using the free astroquery services for Gaia, Pan-STARRS, and SIMBAD, and brokers such as Lasair have already incorporated host-galaxy cross-matches via the Sherlock tool.
- **Models and tooling.** Both commercial multimodal APIs and open-weight vision-language models are suitable. The Stoppa result made use of a commercial model without having it fine-tuned, and the project does not rely on any specific provider.

The biggest risk lies in the scope; for the duration of the semester I will confine myself to extragalactic transients (with moving objects and periodic variables excluded), make use of only one broker's anomaly stream for ingestion, and start off with a retrospective evaluation of the ZTF data, the live operation on Rubin alerts being the ultimate aim.

---

## 2. Why the problem is too complex to solve without AI

- **Volume.** Humans can't possibly read seven million alerts every night and even the subset that makes it through anomaly filtering is going to be hundreds per night under Rubin. The expert vetting bottleneck is the entire issue.
- **Heterogeneous evidence.** The vetting decision is based on image cutouts, multi-band photometry over time, catalogue matches, the object's history in the survey and constraints from its sky position. There is no single rule you can write by hand that incorporates all of this. It's a judgement you build up through experience and multimodal models are the only thing that can take all of that as input at once.
- **Open set reasoning.** The most valuable discoveries are things that belong to no known class. A conventional classifier will simply assign everything to the nearest known class. The value of open set reasoning comes from recognising that "this doesn't fit any category" and then going on to reason about why. That's what language model reasoning brings to statistical outlier detection.
- **Decision under uncertainty.** It's a case of balancing the scientific value against the cost of a wasted telescope hour and the risk of missing a once-a-decade event. That's a properly calibrated probabilistic judgement rather than a simple lookup of a pre-stored value.
- **Self-explanation.** Astronomers won't act on an opaque score. The agent has to be able to give reasons that a human can check and the project has to be able to assess whether those reasons are accurate. That's the fundamental open question in AI interpretability and that's the only way I can study it (I have to build such a system).

---

## 3. The expertise I bring and how it tames the complexity

- **Programming and data engineering** (Python, APIs, pandas): enables me to build the orchestration layer which calls out to the broker and catalogue APIs, caches the results and then runs the agent over the thousands of archived candidates rather than processing each one individually.
- **Physics and introductory astronomy:** allows me to generate the hypothesis templates (a supernova goes up over weeks and then cools; a tidal disruption event remains blue and hot; an AGN flare sits on top of the galaxy nucleus with previous variability) and to assess whether the agent's physical reasoning is sensible.
- **Statistics and probability**: absolutely critical for calibration, the central measurement of the project. If the agent says it is 80% confident, is it actually 80% of the time?
- **Lots of experience with LLM prompting and tool use** so I can build the agent loop, the structured outputs and the few-shot examples without having to start from scratch.
- **My interest is in the reasoning.** The fundamental question that underpins the whole exercise is whether the reasons it gives actually do correspond to the accuracy of its answers and that's what keeps me interested when the pipeline fails.

Each strength deals with a different axis: engineering with scale, physics with hypothesis quality, statistics with trust and the intelligence question with why it matters.

---

4. Course goals, how this project advances them, and how it has pushed me beyond my comfort zone

**My course goals were:**
1. Shift from using AI tools to designing AI systems which consist of a number of cooperating components.
Instead, learn how to properly evaluate the output of AI rather than just accepting it.
3. Create something using a real user or a genuine scientific community, not a toy.

**How this project advances them:**
- Objective 1: The system is made up of several distinct parts, including an ingestion layer, a tool-calling agent, physical template fitting, a calibration layer, and a feedback loop which comes from later classifications. The agent has to be capable of recovering should a catalog query fail or a hypothesis be eliminated during the course of its reasoning.
- Objective 2: The entire project constitutes an evaluation exercise, the outputs consisting of a retrospective scoring based on the Transient Name Server (TNS) classifications, the calibration curves, and a faithfulness test (since Stoppa et al. found that the quality of the reasoning trace predicts correctness regarding coherence). These are the main deliverables and not merely added on at the end.
- Objective 3: The brokers developed by Rubin are designed for this type of downstream user, and the anomaly teams will publish their lists of candidates. Since there would be an immediate audience, a working vetting agent would have one.

**Where it takes me beyond my comfort zone:**
I have no experience with astronomical data formats, broker APIs or difference imaging, so I'll have to learn the subject matter quickly if I am to be able to distinguish good reasoning from mere nonsense.
I have developed single-call LLM applications but have never created an agent capable of selecting its own tools, sequencing its queries, and revising its hypotheses.
I know in theory the statistical methods involved in calibration and faithfulness evaluation but have never actually applied them to a complicated, real-world system.
-The genuine failure mode is that although the agent's explanations are plausible its decisions are no better than the current anomaly score. The most difficult aspect of the experiment is designing it in such a way that this result can be detected and then reporting it if it does occur.

---

## Next steps (for Journal 02)
- Pull 300 archived ZTF anomaly candidates from Lasair or Fink and match them to TNS classifications to form the retrospective evaluation set.
- Implement the context-gathering tools (light curve, cutouts, catalog cross-match, TNS lookup) as functions the agent can call.
- Run a baseline: does a multimodal model with full context outperform the broker's anomaly score alone at predicting which candidates received the rare classification?