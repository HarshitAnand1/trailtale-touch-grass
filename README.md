# Trailtale

An audio story that plays only while you walk, plus weekly nature quests. Every model runs locally — no cloud, no account, works offline.

## Quick Start

### 1. Install Python dependencies

```bash
cd server
pip install -r requirements.txt
```

### 2. Start the server

```bash
# From the project root
uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Open the app

Visit [http://localhost:8000](http://localhost:8000) on your phone (or laptop browser).

### 4. (Optional) Set up llama.cpp for story generation

```bash
# Download a Gemma model and start the llama.cpp server
./llama-server -m gemma-2b.gguf --port 8080
```

Without llama.cpp, the story engine returns fallback text so you can still test the full walk flow.

### 5. (Optional) Install Piper for TTS

```bash
# See https://github.com/rhasspy/piper for installation
piper --model en_US-lessac-medium --output_file test.wav <<< "Hello from the trail"
```

Without Piper, the TTS engine generates silent placeholder audio.

## Architecture

```
Phone (PWA)              Host (FastAPI)
┌──────────────┐        ┌──────────────────┐
│ Walk Gate    │──────▶ │ Orchestrator     │
│ (GPS + Accel)│        │                  │
│              │◀────── │ Story Engine     │
│ Audio Queue  │        │ (Gemma/llama.cpp)│
│              │        │                  │
│ Quest UI     │──────▶ │ Quest Engine     │
│              │        │ (JSON + SQLite)  │
│ Photo Capture│──────▶ │ Vision Checker   │
│              │◀────── │ (Gemma multimodal)│
│              │        │                  │
│              │◀────── │ TTS (Piper)      │
└──────────────┘        └──────────────────┘
```

## Walk Flow

1. Open the app → tap **Start Walk** → quest list flashes for 5 seconds
2. Phone goes in pocket → story starts after ~10 steps
3. Moving → story plays. Stop → audio pauses within 3 seconds
4. See a quest item? Take a photo → phone buzzes if confirmed
5. Tap **End Walk** (or auto-ends after 10 min of no movement)
6. Read the walk log: distance, time, quests found, story title

## Project Structure

```
├── client/              # PWA (HTML/CSS/JS)
│   ├── index.html       # Main app shell
│   ├── style.css        # Design system
│   ├── app.js           # Walk orchestration
│   ├── walk-gate.js     # Motion detection
│   ├── audio-queue.js   # Audio playback
│   ├── quest-ui.js      # Quest display
│   ├── sw.js            # Service worker
│   └── manifest.json    # PWA manifest
├── server/              # FastAPI backend
│   ├── main.py          # API endpoints
│   ├── models.py        # Data models
│   ├── database.py      # SQLite setup
│   ├── story_engine.py  # LLM story generation
│   ├── tts_engine.py    # Piper TTS
│   ├── quest_engine.py  # Quest management
│   ├── vision_checker.py# Photo verification
│   └── walk_log.py      # Walk summary
├── data/
│   └── quests/          # Quest pack JSON files
│       └── himalayan-foothills.json
└── README.md
```

## Key Design Decisions

- **Phone in pocket**: the screen dims 8 seconds after any interaction during a walk
- **One segment ahead**: the story engine always renders one segment while the current plays, hiding latency
- **Graceful fallbacks**: no Piper → silent WAV, no llama.cpp → placeholder text, no vision → manual "count it" button
- **Zero network**: service worker caches the app shell; all models run locally

## License

MIT
