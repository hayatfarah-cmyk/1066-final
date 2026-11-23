# Journal 05

Describe, for each piece of peer/mentor feedback that you wrote in your section notebook, how you addressed or plan to address it.

Missed section last week. Since there were issues with FP J4, I will talk briefly about the changes I made here.

### 1. Connecting to ALeRCE.
* I previously was only using CSV data, when I could've been pulling live data from the ALeRCE API. I set that up pretty quickly, and it saved a lot of time because I no longer needed to upload individual CSVs to see plotted data.

### 2. Implementing a live dashboard.
* I wanted users to see a variety of different plots on web load, so I asked AI and iterated through different ways it decided to approach it. At first, it gave plots that didn't have enough observations from it to plot, so I added guards that required each data entry to have at least 5 observations. From there it was an aesthetics issue, and I ultimately chose something that gave less friction and offered users more explanations of what they were seeing.

### 3. Other ways to look at anomalies
* As discussed 2 sections ago, I tried to expand the anomalies beyond just "it exploded." But because the selected light curve only hands out peak to peak values, there aren't any observations we can make.

### 4. Limitations
* Pulling data from the database can be slow. My website cannot be used definitively as "this star is a supernova," but rather as a tool to identify when something looks off. It would require more scientific scrutiny for any finding to be definitive.

# Follow ups
* Adding guard rails to ensure plots are generated (at least 5 detections and two observations in a band)
* Ordering the page so that the live data plotting comes first. Included a 60 second feed refresher with 12 second auto rotate.
* Caching the display data so that when a user clicks to the next plot, they don't have to wait for it to load. Preload next object.
* Each classifier now has one row with up to three shortened probability results. Hover for more details.
* Choose either an auto or manual scroll for the different plots. Implemented because AI defaulted to auto, which made it difficult to read details before it switched.

### A Review I Got!
I unfortunately have been in the ER a lot this week including last night, but I got a very special review from a nurse that was interested in the work I was doing while I was there! Although it was not rigorous enough to call it a peer review, I really appreciated the input she provided and her interest in my work. It was a little hard to explain the context behind the project considering the gap in expertise, but it was a fun experience overall.


Write a list of questions you’d like to discuss with your mentor. These shouldn't be questions that you can answer for yourself or with an internet search. If you don't have any substantial questions, don't make up a question.
* N/A