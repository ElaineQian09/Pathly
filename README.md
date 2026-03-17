# Pathly

## Product Summary

`Pathly` is a live, English-first running companion that feels like a two-host podcast reacting to the runner's route, surroundings, pace, and selected news interests.

The app is not:

- a generic running coach
- a passive podcast player
- a full navigation-first product

The app is:

- a content-first running experience
- route-aware and context-aware
- capable of lightweight navigation support
- built around two recurring host identities

## Product Priorities

Priority order for the MVP:

1. content consumption value
2. route-aware local context
3. smooth run-time interaction
4. lightweight navigation support
5. light performance recap

This means spoken navigation should be selective. The app can show a true navigation overlay, but voice should only interrupt for important route moments.

## Product Identity

### App Name

Working product name: `Pathly`

### Default Host Duo

- Host A: `Maya`
- Host B: `Theo`

Recommended host roles:

- `Maya` is warm, observational, and scene-setting
- `Theo` is quick, witty, and slightly sharper

### Host Style Options

User chooses one global show style during onboarding. That style modifies both hosts rather than replacing their identities.

Supported styles:

- `Balanced` - default, marked as `Users' choice`
- `Encouraging`
- `Sarcastic`
- `Coach`
- `Zen`
- `Sports Radio`

Style guardrails:

- `Sarcastic` must stay playful and dry, not hostile
- `Coach` should be concise and performance-oriented
- `Sports Radio` should increase banter and energy

## Core Product Thesis

The product should generate short, contextual podcast turns every `15 to 40 seconds` instead of trying to write a full long-form episode upfront.

Each turn should blend a small number of content buckets:

- `nudge`
- `local_context`
- `news`
- `run_metrics`
- `banter`

The backend router chooses `1 to 3` buckets per turn based on live context.

## Pages

### 1. Pitch Page

Purpose:

- explain the product in one screen
- establish that this is a live running podcast
- move the user quickly into setup

Suggested copy:

- headline: `Your run, turned into a live podcast.`
- support line: `Pick your hosts, pick your vibe, and let the show react to your route in real time.`

### 2. Onboarding Flow

Shown on first launch.

Inputs:

- nickname
- host style
- route mode default
- target run duration
- optional news preferences

Rules:

- all choices must be editable in settings later
- do not ask for raw RSS URLs in MVP
- keep onboarding short enough to finish in under a minute

### 3. Route Selection Page

Purpose:

- let the user choose a run shape before the session starts
- preview duration and candidate routes
- set expectations before live playback begins

Supported route modes:

- `One Way`
- `Loop`
- `Out and Back`

#### One Way

- user picks a destination
- app estimates duration and route summary
- app highlights notable route points when available

#### Loop

Loop means the run starts and ends near the same place.

For MVP, loop generation is best effort:

- user chooses target duration first
- backend estimates target distance from default pace or recent pace
- backend returns `3` loop candidates
- each candidate tries to balance duration fit, route coherence, and landmark density
- exact duration matching is not required

Loop candidates should be ranked by:

- distance or duration error
- return-to-start closeness
- route simplicity
- nearby place density
- route continuity

#### Out and Back

- backend proposes routes that reach a midpoint and return
- this is the simplest fallback when loop quality is weak

### 4. Main Run Page

This is the core product surface.

Required elements:

- full-screen map
- route line and current position
- true navigation overlay
- current speaker chip
- `Start` button
- 3-second countdown overlay
- pause control
- transcript strip
- interrupt microphone button
- quick actions
- compact run metrics
- settings entry point

Recommended quick actions:

- `More news`
- `More local`
- `Less talking`
- `Repeat`
- `Quiet for 5 min`

### 5. Settings Page

All onboarding choices must be editable here.

Settings should include:

- nickname
- host style
- route mode default
- duration default
- news category preferences
- talk density
- quiet mode preference

If a run is already active, settings changes should update the live session immediately rather than waiting for the next launch.

## Navigation Strategy

The app can and should include a real navigation overlay, but navigation must not dominate the spoken experience.

Visual navigation overlay should show:

- next instruction
- remaining distance
- ETA
- off-route status

Spoken navigation should only interrupt when needed:

- upcoming critical turn
- off-route event
- route rejoin
- destination arrival
- loop midpoint or turnaround reached

If the runner is moving through a stable section with no route risk, Pathly should prioritize content over directions.

## Primary User Flow

1. User opens the app.
2. On first launch, app shows pitch page and onboarding flow.
3. User lands on route selection.
4. User chooses a route candidate.
5. User enters main run page.
6. User taps `Start`.
7. App shows a 3-second countdown.
8. Frontend captures a fresh context bundle.
9. Backend opens the live session orchestration.
10. `Maya` opens the show.
11. While the first turn is playing, backend prepares the next turn for `Theo`.
12. During the run, Pathly alternates hosts turn by turn.
13. User can interrupt by voice, text, or quick action.
14. Navigation overlay stays visible throughout the run.
15. Session checkpoints keep the show resumable across reconnects.

## Session Start Flow

At run start, frontend should send:

- selected route
- current location
- navigation snapshot
- weather
- time of day
- username
- selected host style
- current motion metrics

Backend should:

- create a run session
- initialize orchestration state
- select the opening speaker
- build the first turn package
- return the first playback payload

## Turn Generation System

Every turn should follow this loop:

1. frontend sends a context snapshot
2. backend enriches it with place and route context
3. backend adds fresh news candidates when appropriate
4. router selects content buckets
5. router selects next speaker
6. composer builds the next turn package
7. audio is generated
8. playback is returned to the client
9. backend prefetches the following turn while current playback runs

### Recommended Bucket Rules

- `local_context` when entering a new area, passing a landmark, or moving through a scenic segment
- `news` when there is no critical navigation event and freshness is high
- `nudge` when the user slows, goes quiet, or approaches a meaningful moment
- `run_metrics` every `6 to 8 minutes`, not every turn
- `banter` to connect A and B and avoid a robotic briefing tone

## News Strategy

News is part of the content value proposition, not a separate product lane.

Chosen setting: `medium`

That should mean:

- roughly one news-bearing turn every `3 to 4` turns when conditions are stable
- one news item at a time
- one to two summary sentences
- one sentence that bridges back to the current run context

News must enter naturally, not as a hard cut.

Good bridge patterns:

- time-based bridge
- location-based bridge
- pace-based bridge

Examples of good transitions:

- the user enters a calm stretch, so the hosts contrast that with a busy headline
- the user settles into rhythm, so the hosts surface one story worth knowing

Recommended MVP news sources:

- `Tech`
- `World`
- `Sports`

Recommended ingestion strategy:

- map categories to curated feeds
- poll feeds on a schedule
- deduplicate similar items
- cluster by topic
- store spoken-ready summaries

## A and B Host Design

Pathly should preserve the feeling of two hosts without letting two independent live agents talk over each other.

Recommended architecture:

- one active speaking lane at a time
- two persistent speaker identities in backend state
- backend decides whose turn is next
- backend keeps transcript continuity across both speakers

Role split:

- `Maya` should handle openings, scene-setting, and softer transitions
- `Theo` should handle sharper reactions, light sarcasm, and energy shifts

## Interruption Design

### Voice Interruption

Recommended MVP behavior:

- user taps interrupt mic
- current playback ducks immediately
- app captures one utterance
- backend classifies intent
- backend either answers directly or updates the show plan
- the show resumes after the response

### Text Interruption

- user sends text from the run page
- queued next turn is canceled
- backend rebuilds the next turn around the user input

### Quick Actions

Quick actions should update routing behavior instead of acting like full freeform prompts.

Examples:

- `More news`
- `More local`
- `Less talking`
- `Repeat`
- `Quiet for 5 min`

### Priority Classes

Urgent interrupts should override the show:

- route confusion
- stop or pause
- safety concern
- physical discomfort

## Delay Handling

A and B turn generation will sometimes leave small gaps. Use a filler library to hide those gaps.

Rules:

- filler clips should be `1.5 to 3 seconds`
- filler clips should be keyed by speaker and style
- filler must not carry core information
- filler repetition should be rate-limited

Examples:

- Maya filler should sound smooth and warm
- Theo filler should sound a bit quicker and drier

## Motion and Sensor Inputs

Phone-first MVP can reliably use:

- current location
- route position
- speed
- derived pace
- distance
- step count
- cadence
- pedometer pause or resume

Do not promise heart rate in the iPhone-only MVP.

## External APIs and SDKs

Pathly depends on a small set of external APIs and SDKs. Their responsibilities should be explicit so the product does not drift into unclear ownership.

### Gemini APIs

#### `Gemini Live API`

Use for:

- spoken turn generation
- low-latency interruption response
- active speaker playback flow

Do not use it as the primary place-retrieval layer.

#### `Gemini Flash` or `Gemini Pro`

Use for:

- router decisions
- interruption intent classification
- transcript summarization
- local context packaging
- news summary packaging

#### `Ephemeral Tokens`

If the client connects directly to Gemini Live, backend must issue short-lived tokens and keep token issuance out of the frontend.

#### `Live Session Management`

Long runs require explicit reconnect and resume handling. Do not assume one uninterrupted live session across a full run.

### Google Maps Platform APIs

#### `Maps SDK for iOS`

Use for:

- main map rendering
- route preview rendering
- active route polyline
- candidate route visualization

#### `Places SDK for iOS`

Use for:

- destination autocomplete in `One Way`
- nearby place candidate lookup
- place details lookup when a nearby landmark is selected

Recommended split:

- `Autocomplete` for destination search
- `Nearby Search` for local place candidates
- `Place Details` for metadata enrichment

#### `Routes API`

Use for:

- one-way route generation
- loop route generation
- out-and-back route generation
- distance and duration estimates
- encoded route geometry

Important product constraint:

- Pathly should use walking-style route generation for the running MVP
- walking and bicycling route modes currently have beta caveats and should be treated carefully in UI copy
- route generation response should include navigation-ready metadata, not only a display polyline

#### `Navigation SDK for iOS`

Use for:

- navigation overlay
- next instruction
- remaining distance
- ETA
- off-route status
- midpoint or arrival events

Important product decision:

- Pathly should prefer custom guidance behavior
- built-in navigation voice should not dominate the spoken show
- navigation data should feed the router even when navigation voice is silent

### Apple Device APIs

#### `CoreLocation`

Use for:

- current location
- speed
- course
- horizontal accuracy
- timestamps

#### `CoreMotion / CMPedometer`

Use for:

- step count
- distance
- pace
- cadence
- pause and resume events

### News Source Layer

Pathly should use curated RSS sources in MVP.

Recommended source templates:

- `Tech`: TechCrunch, Ars Technica
- `World`: BBC World
- `Sports`: ESPN headlines

Recommended flow:

- backend polls feeds
- backend deduplicates and clusters stories
- backend stores spoken-ready short summaries
- router decides whether a news item is eligible for the next turn

## API-Level Data Flow

The location and news pipeline should work like this:

1. frontend collects location, navigation, motion, weather, and user actions
2. frontend sends structured snapshots to backend
3. backend calls Maps, Places, Routes, and news pipelines outside Gemini Live
4. backend packages nearby landmarks, route progress, and selected news into structured turn context
5. backend invokes Gemini planning layer
6. backend invokes Gemini Live for the current speaker turn
7. frontend receives playback payload and renders audio plus UI updates

### Place and Landmark Flow

Recommended flow:

1. frontend or backend obtains current location
2. backend queries nearby or route-adjacent places
3. backend filters low-value candidates
4. backend optionally hydrates selected place metadata
5. backend converts raw place data into short fact candidates
6. router decides whether `local_context` should be included
7. turn composer injects only the top candidates into the next turn

### Route Flow

Recommended flow:

1. frontend sends route request with mode, duration, and start point
2. backend calls route generation logic
3. backend ranks candidates
4. frontend displays candidates
5. user selects one route
6. frontend starts navigation guidance for the chosen route using backend-provided navigation metadata
7. frontend streams navigation fields back to backend during the run

### News Flow

Recommended flow:

1. backend polls RSS feeds on a schedule
2. backend deduplicates and clusters similar stories
3. backend produces short spoken summaries
4. router checks whether news is allowed in the current moment
5. composer adds one selected story plus a contextual bridge
6. live speaker delivers that segment naturally inside the run

## System Architecture

### Frontend Owns

- onboarding
- route selection UI
- main run UI
- navigation overlay
- location and motion capture
- transcript strip
- interruption controls
- playback controls
- local persistence

### Backend Owns

- run session orchestration
- route generation and candidate ranking
- news ingestion
- place enrichment
- routing logic
- prompt construction
- transcript summarization
- reconnect and checkpoint handling
- filler selection policy

### Model Split

Recommended model responsibilities:

- `Gemini Live` for spoken turn generation and interruption response
- `Gemini Flash` or `Gemini Pro` for routing, summarization, news selection, place packaging, and intent classification

### Important Constraint

Do not assume Google Maps grounding can be used directly inside the live audio session. Safer design:

- use Maps, Places, and Navigation services to gather route-aware context outside Live
- inject the resulting structured context into the next turn package

Additional constraint:

- treat place lookup, route lookup, and news retrieval as pre-live enrichment layers
- the live call should receive structured context, not be responsible for raw external API retrieval

## Reliability Requirements

Runs can last from `10 minutes` to `3 hours`.

That means the product must support:

- transcript checkpoints
- compact session summaries
- reconnect-safe session state
- resumable orchestration
- graceful handling of temporary dead air

The app should never assume one uninterrupted model connection for a long run.

## MVP Scope

### In Scope

- onboarding
- settings
- route selection
- one-way, loop, and out-and-back routes
- three loop candidates
- main run page
- navigation overlay
- two-host format
- contextual news at medium frequency
- voice, text, and quick-action interruption
- filler library
- reconnect-safe long runs

### Out of Scope

- full coaching plans
- Apple Watch heart rate support
- user-authored RSS feeds
- social features
- full post-run analytics dashboard
- offline mode

## Delivery Principle

If there is a tradeoff between perfect model cleverness and smooth user experience during a real run, Pathly should always choose smoothness.

## Reproducible Testing

The backend code lives in [`backend/`](./backend).

### Local Backend Setup

Install dependencies:

```bash
cd backend
npm install
```

Run the test suite:

```bash
npm test
```

Build the backend:

```bash
npm run build
```

Start the backend locally:

```bash
npm run start
```

Expected local health check:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{"ok":true,"product":"Pathly"}
```

### Route Generation Smoke Test

Run a contract-correct loop request:

```bash
curl -X POST http://localhost:3000/v1/routes/generate \
  -H "Content-Type: application/json" \
  -d '{
    "routeMode": "loop",
    "durationMinutes": 45,
    "desiredCount": 3,
    "start": {
      "latitude": 41.8819,
      "longitude": -87.6278
    },
    "destinationQuery": null
  }'
```

Expected behavior:

- HTTP `200`
- response shape:

```json
{
  "requestId": "routes_req_xxx",
  "candidates": [
    {
      "routeId": "route_loop_01",
      "navigationPayload": {
        "routeToken": null,
        "legs": [
          {
            "steps": [
              {
                "instruction": "..."
              }
            ]
          }
        ]
      }
    }
  ]
}
```

### Session Creation Smoke Test

After generating a route candidate, create a session:

```bash
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {
      "nickname": "Luna",
      "hostStyle": "sarcastic",
      "preferredSpeakers": ["maya", "theo"],
      "routeModeDefault": "loop",
      "durationMinutesDefault": 45,
      "newsCategories": ["tech", "world"],
      "newsDensity": "medium",
      "talkDensityDefault": "medium",
      "quietModeDefault": false
    },
    "routeSelection": {
      "selectedRouteId": "route_loop_01",
      "routeMode": "loop",
      "durationMinutes": 45,
      "selectedCandidate": {
        "routeId": "route_loop_01",
        "routeMode": "loop",
        "label": "Loop Candidate 1",
        "distanceMeters": 7100,
        "estimatedDurationSeconds": 2760,
        "polyline": "encoded_polyline",
        "highlights": ["steady pacing sections", "good landmark density"],
        "durationFitScore": 0.91,
        "routeComplexityScore": 0.32,
        "startLatitude": 41.8819,
        "startLongitude": -87.6278,
        "endLatitude": 41.8821,
        "endLongitude": -87.6276,
        "apiSource": "mock_routes_api",
        "navigationPayload": {
          "routeToken": null,
          "legs": [
            {
              "legIndex": 0,
              "distanceMeters": 7100,
              "durationSeconds": 2760,
              "steps": [
                {
                  "stepIndex": 0,
                  "instruction": "Head out smoothly from the start point",
                  "distanceMeters": 850,
                  "durationSeconds": 320,
                  "maneuver": "depart"
                }
              ]
            }
          ]
        }
      }
    }
  }'
```

Expected behavior:

- HTTP `201`
- response includes:
  - `sessionId`
  - `status`
  - `websocketUrl`
  - `openingSpeaker`

### Deployed Backend

Current deployed backend base URL:

```text
https://pathly-production.up.railway.app
```

Quick deployed health check:

```bash
curl https://pathly-production.up.railway.app/health
```
