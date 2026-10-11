*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

## What I Built

Trailtale is a local, offline walking app that turns a walk into an immersive audio story. While you move, the app plays a short story segment; when you stop, the audio pauses automatically. It also surfaces weekly nature quests and lets you confirm interesting finds with a photo, all without pulling you back to a screen.

It’s built for people who want to spend more time outside without getting stuck in their phone. The idea is simple: make the walk the main experience, not a distraction from it.

## Demo

Demo link: [Add your deployed app link here]
Video demo: [Add your screen recording or demo video link here]

## Code

Repository: [Add your GitHub repo link here]
Project source: this includes the PWA client, FastAPI backend, quest data, and local AI pipeline.

## How I Built It

I built Trailtale as a combination of a mobile-first PWA and a local AI backend:

- Frontend: a lightweight browser app in the `client/` folder using HTML, CSS, and JavaScript
- Sensors: phone motion and GPS data are used to detect whether the user is walking or stopped
- Backend: FastAPI in the `server/` folder orchestrates the walk flow, story queue, quests, and logs
- Story generation: a local model runs through `llama.cpp` using Gemma
- Voice: Piper generates spoken audio from the generated story text
- Quest system: weekly nature quests are stored as local JSON packs and tracked in SQLite
- Optional vision check: a local multimodal model can verify that a photo matches a quest item
- Offline-first design: the app is intended to work with no cloud service, no account, and no internet dependency

This stack makes the app feel like a real walk companion rather than a web app that happens to use AI.

## Why Does Open Innovation Matter?

Open innovation mattered here because the whole product depends on privacy, local control, and flexibility.

A closed API would have forced:
- cloud-based story generation for every segment
- network calls for TTS and photo verification
- higher cost per walk
- user data leaving the device

With open-source tools and open-weight models, Trailtale can run locally on a phone, laptop, or a backpack setup. That means:
- no cloud dependency
- no account required
- no pay-per-token barrier
- the prompt, model, and voice can all be tuned or swapped easily

For an app designed to get people to step away from screens, local open tech is not just a technical choice—it’s the product requirement.

## My Agent Session

[Optional: add your DevRelay or agent session link here]

## Prize Categories

[Optional: list the relevant challenge categories here, or remove this section]
