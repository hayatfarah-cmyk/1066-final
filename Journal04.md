# Journal 04: Prototype feedback response

## Addressing the Feedback...

### 1. Connect to the ALeRCE database

After meeting with my mentor, the prototype is now connecting directly to the ALeRCE public ZTF API and is no longer utilizing uploaded CSV files (thanks George).
It is pulling the newest objects ordered by `lastmjd` along with information about detections and classifiers' probabilities of an object chosen by the user. No API key is required and the connection is read-only only. The dashboard will update the object list every 60 seconds. 

### 2. Live dashboard, light curves, and model outputs

I designed the interface to display new ID numbers of the objects, their last observation dates and number of detections of the objects. If you select any specific object, the graph will be generated and will show you ALeRCE detections, classify probabilities and transparent rise and fade algorithm will run using the optimal band. 

### 3. Other ways to look for anomalies

The selected light curve is giving the peak to peak value, maximum robust deviation
and shapes are not classified. The summary is template-based and not
produced by a language model since using just light curves can't determine the cause.

## Limitations and validation

The dashboard uses endpoints from the public ALeRCE ZTF database.
The latency of the database and availability of the API
are both features of ALeRCE. The local variable signals and the shape heuristic
have not been trained on independently labelled data. They should not be
used as proof that an object is a supernova or any scientific finding.


## Follow-up: keep the live feed plottable

The first recent object query involved objects that only had one detection.
Currently, I set up the feed so that it calls ALeRCE to find objects with at least five detections,
and the browser ensures that the received light curve has two different times of
observation in at least one band before plotting the curve. This is to avoid displaying plots that don't have anything interesting to read.Live testing of five
returned Objects found that they all have at least five detections and multiple
bands. The five-detections API filter is a possible candidate filter, while the
per-band test is the actual safeguard for the plot.

## Follow-up: put live objects first and rotate the view

The ALeRCE dashboard is now on top of the page as opposed to the previous
format where it appeared after the introduction. Due to its observatory-like
design, the light curve that has been chosen by the user takes centre stage.
The dashboard automatically moves on to the next plottable object after every 12
seconds using the current 60 second feed refresh. I am undecided about if this will be final. TBD after peer review in section.

## Follow-up: display data without waiting for every request

This cache stores the list of the last objects and the light curves plus the classifiers of the last eight objects viewed for up to seven days. On a subsequent visit to the website, it shows the cache and selected light curve right away and updates them in the background through ALeRCE. For non-cached objects, the light curve is displayed as soon as its photometry is received (aka light measurement) the classifier probabilities are not required anymore.

## Follow-up: simplify the live presentation

No longer have the clickable candidate list as well as the ability to manually select stars.
Now have a single source shown at a time with automatic cycle indicators,
feed status indicator, and a single light curve. The next source's photometry and classifier requests get queued up behind the scenes so that Normal transitions will have the preloaded data. This was nicer looking and not so overwhelming for someone who didn't know anything about this.

## Follow-up: compact classifier probabilities

All repetitive names of models have been changed in every probability line into a single concise row per classifier. Each row contains up to three chips of class probability. Long names of both the model and the classes are restricted visually while their values can be obtained via tooltips.

## Follow-up: choose automatic or manual browsing

Included an auto/manual mode switch button in the live dashboard view. In auto mode,
the 12 seconds source rotation is maintained. In manual mode, the timer is stopped,
and previous/next buttons are shown. No candidate tiles and direct object selection list is shown.
The current mode is saved in the browser. This was done since I was quite irritated while reading the data when it switched midway!

## Follow-up: teach visitors how to read probabilities

Explanation about the output percentage beside the live classifiers outputs and
in the introductory learning module has been added. This explains that the
percentage being shown is the score of the model for a particular class
and not the actual label or probability. Calibration has been explained with
an example. It also talks about the evidence considered by light curve
and image stamp model and why they cannot be compared with each other.
It mentions that only top 3 classes are shown and absence of output does
not mean zero. The website has adopted a responsive card-based layout for
this lesson.