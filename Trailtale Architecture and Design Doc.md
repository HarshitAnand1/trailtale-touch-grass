# Trailtale: Architecture and Design Doc

Oct 9, 2026 · @harryysheet

## Overview

Trailtale is an audio story that plays only while you walk, plus a weekly nature quest that expires when the season moves on. A small open model runs on your own device, so it works with no signal.

**Problem.** Most "get outside" apps pull you back to the screen. Trailtale keeps the phone in your pocket and makes the walk the product.

**Goals**

- A story that plays while you move and pauses when you stop.
- A weekly quest list tied to what is happening in nature this week.
- Every model call runs locally. No cloud, no account.
- Each walk ends with a log you can read in under a minute.

**Success looks like**

- Screen time per walk under 60 seconds.
- A full 30-minute walk with no network.
- At least one real outdoor test, with honest notes on what broke.

## Scope

The build ships four must-haves first. Everything else only starts once a full walk works end to end.

**Must have**

- Walking gate: detect motion and pause or resume audio.
- Local story generation in short segments.
- Voice output through a local text-to-speech engine.
- One weekly quest list loaded from a JSON file.

**Should have**

- Photo check: a local vision model confirms each quest find.
- Walk log: distance, time outside, quests found, story title.

**Stretch**

- Terrain and place context from an OpenStreetMap extract.
- Several story genres the user can pick.
- A TabPFN layer that learns the user's best walking times from past logs.

**Non-goals**

- No accounts, sync, or social features.
- No turn-by-turn navigation.
- No fitness tracking beyond distance and time.

## User experience

A walk takes one tap to start and one glance to finish. The screen is off for everything in between.

**Walk flow**

1. Open the app and tap Start. The app shows this week's quest list for five seconds, then dims.
2. Put the phone in a pocket. The first story segment plays once you take about ten steps.
3. Walk. The story continues while you move and pauses within three seconds of stopping.
4. When a quest item appears in the story or on the trail, take a photo. The phone buzzes once if the local model confirms the find.
5. Tap End, or let the app end the walk after ten minutes of no movement.
6. Read the walk log: distance, minutes outside, quests found, story title.

**Weekly quest flow**

1. A quest pack for the region loads once, from a JSON file on the device.
2. Each quest has a start date and an expiry date, so the list changes with the season.
3. Found items stay checked until the pack expires. Expired quests move to a short history list.

**Design rule.** If a feature needs the screen during a walk, cut it or move it to the end-of-walk log.

## System architecture

&#91;embedded content: architecture · phone and host, 9 parts\]

The phone only senses and plays. The orchestrator on the host calls every model, so swapping one model changes a single box.

## Components

Eight parts, all open source or open weight, all running on hardware the user owns.

| Component | Job | Open tool | Notes |
| --- | --- | --- | --- |
| Client app | Start and end walks, read sensors, play audio, take photos | Web app (PWA) in the phone browser | Uses the Geolocation and DeviceMotion APIs |
| Walk gate | Decide if the user is moving or still | Small rule in the client | Speed above 0.5 m/s for 3 s counts as moving |
| Orchestrator | Run the loop and hold walk state | FastAPI (Python) | One process, one walk at a time |
| Story engine | Write the next story segment | Gemma through llama.cpp server | 60 to 90 words per segment |
| Text to speech | Turn each segment into audio | Piper | Render the next segment while the current one plays |
| Quest engine | Load the weekly pack and track finds | JSON file plus SQLite | Filters quests by today's date |
| Vision checker | Confirm a photo matches a quest item | Gemma multimodal | Returns yes or no plus a one-line reason |
| Walk log | Summarise the walk | SQLite plus a Markdown file | Written when the walk ends |

**Where it runs.** Start with Option A: a laptop in a backpack runs the orchestrator and models, and the phone connects over a hotspot. This gets the full loop working fast. Then try Option B: Android with Termux and llama.cpp, which makes the app fully self-contained. The client and the API stay the same in both, so the switch changes only where the process runs.

**Model choice.** Use the smallest Gemma variant that gives readable story text and reliable photo checks. Test two sizes on the same ten prompts and keep the smaller one if quality holds. Record the model name and size in the write-up.

## Data and quest pack

Three small records hold everything. The quest pack is a hand-editable JSON file, so a region can be added without touching code.

**Quest pack**

```json
{
  "region": "himalayan-foothills",
  "version": "2026-10",
  "quests": [
    {
      "id": "q-leaf-color",
      "title": "Find three trees changing color",
      "target": "leaf",
      "count": 3,
      "starts": "2026-10-05",
      "expires": "2026-10-25",
      "hint": "Look for yellow or red edges on broad leaves."
    }
  ]
}
```

**Walk session**

```json
{
  "walk_id": "2026-10-12T07:40",
  "started_at": "2026-10-12T07:40:00+05:30",
  "moving_seconds": 1680,
  "still_seconds": 140,
  "distance_m": 2310,
  "quests_found": ["q-leaf-color"],
  "story_id": "story-0412",
  "segments_played": 14
}
```

**Story state**

```json
{
  "story_id": "story-0412",
  "genre": "mystery",
  "summary_so_far": "A walker finds a stone marker with no name.",
  "last_segment": "The path bent toward the sound of water.",
  "segment_count": 14
}
```

The story state keeps only a short summary and the last segment. This keeps each prompt small, so a small model stays fast and on topic.

## Story engine and prompts

The story is written one short segment at a time, always one segment ahead of what the user hears. This hides model latency and lets the story pause cleanly.

**Segment loop**

1. Build the prompt from the story state, the time of day, the season, and the active quest.
2. Ask Gemma for one segment of 60 to 90 words.
3. Send the text to Piper and store the audio.
4. Queue the audio. Keep at most one finished segment waiting.
5. When the walk gate says moving, play the queue. When it says still, pause after the current sentence.
6. After each segment, update the story state with a one-sentence summary.

**Prompt template**

```text
You write one segment of an audio story for someone walking outside.
Genre: {genre}
Story so far: {summary_so_far}
Last segment: {last_segment}
Time of day: {time_of_day}. Season: {season}.
Active quest: {quest_title}. Work one natural mention of {quest_target} into the segment.
Rules:
- 60 to 90 words. Plain words. No lists.
- End on a small question or a sound, so the walker wants the next segment.
- Never tell the walker to leave the path, climb, cross water, or hurry.
- Do not name real people or places.
```

**Pacing rules**

- Target one segment per 40 to 50 seconds of speech, so the queue never runs dry at normal walking speed.
- If the queue is empty, play a short ambient pause instead of silence or an error.
- Every fifth segment, hint at the quest the user has not found yet.

**Safety rules**

The prompt bans instructions that put the walker at risk. Quest hints only point to things visible from the path. The write-up should state these rules, since an audio guide that distracts people outdoors needs them.

## Why open beats closed here

The challenge asks where the open approach did better. Trailtale has four answers, and each one can be tested on a trail.

| Need | Closed approach | Open approach in Trailtale |
| --- | --- | --- |
| Works with no signal | Needs a cloud call for every segment | Gemma and Piper run on the device or a backpack laptop |
| Location and photos stay private | GPS trail and photos go to a server | Nothing leaves the user's hardware |
| Change the story voice or rules | Locked to a vendor's prompt limits and terms | Edit the prompt, swap the model, or fine-tune |
| Cost per walk | Per-token fees add up over daily walks | Zero after setup |

**What to measure.** Run the same walk in airplane mode and record whether the loop completes. Count network requests during the walk and report zero if true. These two numbers make the claim concrete in the write-up.

## Build plan

&#91;embedded content: build plan · 6 phases, 6 gates\]

The plan assumes ten days because no deadline was given. Stretch or squeeze the bands to fit yours, but keep the first outdoor test before any stretch work. If time runs short, use the cut order in the risks section.

## Testing and the field test

Test each part at a desk first. Then take the whole loop outside at least once, because the write-up depends on that walk.

**Metrics to record**

| Metric | How to measure | Target |
| --- | --- | --- |
| Segment latency | Time from prompt to finished audio | Under 20 s, so the queue stays ahead |
| Pause response | Time from stopping to audio pausing | Under 3 s |
| Screen time per walk | Seconds the screen is on during the walk | Under 60 s |
| Network requests | Count in airplane mode | 0 |
| Photo check accuracy | Correct yes or no on 20 test photos | At least 15 of 20 |
| Time outside | Minutes of moving plus still | Note against a normal day |

**Field test plan**

1. Pick a 30 to 45 minute route you know, in daylight.
2. Turn on airplane mode before leaving.
3. Walk with the phone in a pocket and earbuds in. Keep one ear open to traffic and trail sounds.
4. Log every moment the story pulled you forward and every moment it broke.
5. Repeat once at a different time of day if possible.

**What to write down.** Keep notes while walking or right after: where you stopped, what you found, how often you checked the screen, and one thing you noticed that you would have missed otherwise.

## Risks and fallbacks

The biggest risk is a slow model on a phone. Every other risk has a cheap fallback.

| Risk | Effect | Fallback |
| --- | --- | --- |
| Model too slow on the phone | Story gaps, user checks screen | Run on the laptop (Option A) or use a smaller Gemma variant |
| Piper voice sounds flat | Story loses pull | Try another Piper voice, or use ElevenLabs for the demo only |
| GPS drift marks the user as moving | Story plays while standing | Combine GPS speed with step detection from DeviceMotion |
| Vision check gives wrong answers | Quest feels unfair | Show a manual "count it" button in the end-of-walk log |
| Browser blocks sensors or audio in the background | Walk gate stops working | Keep the screen on dim with a wake lock, or wrap the app in a native shell |
| Bad weather or no time for a real walk | No field story | Test a short walk near home and say so honestly in the write-up |

**Cut order if time runs short.** Drop the TabPFN layer first, then the OSM terrain context, then the photo check. The walking gate, local story, and voice must ship.

## Prize fit and write-up outline

Writing quality carries the most weight in judging, so the write-up gets its own plan. Gemma is the main prize target. The others are optional and cost little extra work.

**Prize fit**

| Category | How Trailtale qualifies | Extra work |
| --- | --- | --- |
| Best Use of Gemma | Gemma writes the story and checks photos, run locally | None. This is the core build |
| Best Use of ElevenLabs | Narrate the demo video, or voice the story as an upgrade | A few hours |
| Best Use of TabPFN | Predict the user's best walking hours from walk logs | Needs several weeks of logs, so treat as stretch |
| Best Use of Entire | Share the agent sessions behind the build | Save sessions as you work |

**Write-up outline**

1. **Hook.** One scene from the field test, written in first person. Start outside, not with the tech.
2. **The idea.** An audio story that only plays while you walk, in three sentences.
3. **Why open.** The four answers from the table above, with the airplane-mode result and the zero network requests.
4. **How it works.** One diagram and a short tour of the segment loop.
5. **The walk.** What happened outside: where the story pulled you forward, where it broke, minutes outside versus a normal day.
6. **What I would change.** Two honest lessons, and one thing that surprised you.
7. **Try it.** Repo link and the steps to run it.

**Style for the write-up.** Short sentences. Concrete numbers, dates, and places. No buzzwords. Let the walk carry the story and keep the architecture short.
