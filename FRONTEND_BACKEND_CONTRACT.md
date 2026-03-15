# Frontend Backend Contract

This document defines the MVP contract between the iOS client and the backend for `Pathly`.

## Contract Principles

- frontend never constructs prompts
- backend owns model orchestration
- frontend sends structured context and user actions
- backend returns route candidates, turn plans, and playback payloads
- route selection is completed before the run session starts
- navigation stays visible throughout the run
- playback must always remain interruptible
- long runs must be reconnect-safe
- raw external API retrieval should happen outside the live speaker turn

## Shared Enums

### RouteMode

- `one_way`
- `loop`
- `out_back`

### HostStyle

- `balanced`
- `encouraging`
- `sarcastic`
- `coach`
- `zen`
- `sports_radio`

### SpeakerId

- `maya`
- `theo`

### NewsCategory

- `tech`
- `world`
- `sports`

### NewsDensity

- `off`
- `light`
- `medium`
- `heavy`

### TalkDensity

- `low`
- `medium`
- `high`

### ContentBucket

- `nudge`
- `news`
- `local_context`
- `run_metrics`
- `banter`

### QuickAction

- `more_news`
- `more_local`
- `less_talking`
- `repeat`
- `quiet_5_min`

### SegmentType

- `main_turn`
- `filler`
- `interrupt_response`
- `navigation_override`

### InterruptIntent

- `direct_question`
- `preference_change`
- `repeat_or_clarify`
- `route_confusion`
- `safety_or_discomfort`
- `pause_or_stop`

### SessionStatus

- `idle`
- `connecting`
- `active`
- `paused`
- `reconnecting`
- `ended`
- `error`

## Shared Objects

### UserProfile

```json
{
  "nickname": "Luna",
  "hostStyle": "sarcastic",
  "preferredSpeakers": ["maya", "theo"],
  "routeModeDefault": "loop",
  "durationMinutesDefault": 45,
  "newsCategories": ["tech", "world"],
  "newsDensity": "medium",
  "talkDensityDefault": "medium",
  "quietModeDefault": false
}
```

### SessionPreferences

```json
{
  "hostStyle": "sarcastic",
  "newsCategories": ["tech", "world"],
  "newsDensity": "medium",
  "talkDensity": "medium",
  "quietModeEnabled": false,
  "quietModeUntil": null
}
```

### RouteGenerationRequest

```json
{
  "routeMode": "loop",
  "durationMinutes": 45,
  "desiredCount": 3,
  "start": {
    "latitude": 41.8819,
    "longitude": -87.6278
  },
  "destinationQuery": null
}
```

### RouteCandidate

```json
{
  "routeId": "route_loop_01",
  "routeMode": "loop",
  "label": "Lakefront South Loop",
  "distanceMeters": 7100,
  "estimatedDurationSeconds": 2760,
  "polyline": "encoded_overview_polyline",
  "highlights": [
    "lakefront stretch",
    "turnaround near museum campus"
  ],
  "durationFitScore": 0.91,
  "routeComplexityScore": 0.32,
  "startLatitude": 41.8819,
  "startLongitude": -87.6278,
  "endLatitude": 41.8821,
  "endLongitude": -87.6276,
  "apiSource": "routes_api",
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
            "instruction": "Head south on the lakefront trail",
            "distanceMeters": 850,
            "durationSeconds": 320,
            "maneuver": "depart"
          }
        ]
      }
    ]
  }
}
```

### NavigationPayload

```json
{
  "routeToken": null,
  "legs": [
    {
      "legIndex": 0,
      "distanceMeters": 7100,
      "durationSeconds": 2760,
      "steps": [
        {
          "stepIndex": 0,
          "instruction": "Head south on the lakefront trail",
          "distanceMeters": 850,
          "durationSeconds": 320,
          "maneuver": "depart"
        }
      ]
    }
  ]
}
```

### RouteSelection

```json
{
  "selectedRouteId": "route_loop_01",
  "routeMode": "loop",
  "durationMinutes": 45,
  "selectedCandidate": {
    "routeId": "route_loop_01",
    "routeMode": "loop",
    "label": "Lakefront South Loop",
    "distanceMeters": 7100,
    "estimatedDurationSeconds": 2760,
    "polyline": "encoded_overview_polyline",
    "highlights": [
      "lakefront stretch",
      "turnaround near museum campus"
    ],
    "durationFitScore": 0.91,
    "routeComplexityScore": 0.32,
    "startLatitude": 41.8819,
    "startLongitude": -87.6278,
    "endLatitude": 41.8821,
    "endLongitude": -87.6276
  }
}
```

### LocationSnapshot

```json
{
  "latitude": 41.8819,
  "longitude": -87.6278,
  "horizontalAccuracyMeters": 8.5,
  "speedMetersPerSecond": 2.9,
  "courseDegrees": 182.0,
  "timestamp": "2026-03-15T15:00:00Z"
}
```

### NavSnapshot

```json
{
  "nextInstruction": "Turn right on N Columbus Dr",
  "remainingDistanceMeters": 2800,
  "remainingDurationSeconds": 980,
  "distanceAlongRouteMeters": 4300,
  "offRoute": false,
  "approachingManeuver": false,
  "atTurnaroundPoint": false
}
```

### MotionSnapshot

```json
{
  "elapsedSeconds": 780,
  "distanceMeters": 2350,
  "currentSpeedMetersPerSecond": 2.9,
  "derivedPaceSecondsPerKm": 345,
  "stepCount": 3020,
  "cadenceStepsPerSecond": 2.9,
  "isPaused": false
}
```

### WeatherSnapshot

```json
{
  "temperatureC": 9,
  "condition": "clear",
  "isDaylight": true
}
```

### PlaceCandidate

```json
{
  "placeId": "places_abc",
  "name": "Museum Campus",
  "primaryType": "tourist_attraction",
  "latitude": 41.8663,
  "longitude": -87.6137,
  "distanceFromUserMeters": 420,
  "whyRelevant": "route_adjacent_landmark",
  "source": "places_sdk_or_backend_places"
}
```

### LocalContextCandidate

```json
{
  "placeId": "places_abc",
  "headline": "You are about to pass one of the most recognizable museum clusters on the lakefront.",
  "factType": "landmark_context",
  "freshness": "fresh",
  "noveltyScore": 0.88
}
```

### ContextSnapshot

```json
{
  "sessionId": "sess_123",
  "location": {
    "latitude": 41.8819,
    "longitude": -87.6278,
    "horizontalAccuracyMeters": 8.5,
    "speedMetersPerSecond": 2.9,
    "courseDegrees": 182.0,
    "timestamp": "2026-03-15T15:00:00Z"
  },
  "nav": {
    "nextInstruction": "Turn right on N Columbus Dr",
    "remainingDistanceMeters": 2800,
    "remainingDurationSeconds": 980,
    "distanceAlongRouteMeters": 4300,
    "offRoute": false,
    "approachingManeuver": false,
    "atTurnaroundPoint": false
  },
  "motion": {
    "elapsedSeconds": 780,
    "distanceMeters": 2350,
    "currentSpeedMetersPerSecond": 2.9,
    "derivedPaceSecondsPerKm": 345,
    "stepCount": 3020,
    "cadenceStepsPerSecond": 2.9,
    "isPaused": false
  },
  "weather": {
    "temperatureC": 9,
    "condition": "clear",
    "isDaylight": true
  },
  "routeSource": "routes_api",
  "navigationSource": "navigation_sdk_ios"
}
```

### TurnPlan

```json
{
  "turnId": "turn_456",
  "speaker": "maya",
  "segmentType": "main_turn",
  "contentBuckets": ["local_context", "banter"],
  "targetDurationSeconds": 18,
  "reason": "user_entered_new_area",
  "safeInterruptAfterMs": 4000
}
```

### PlaybackPayload

```json
{
  "turnId": "turn_456",
  "speaker": "maya",
  "segmentType": "main_turn",
  "audioUrl": "https://example.com/audio/turn_456.mp3",
  "transcriptPreview": "You are about to hit one of the best sunrise stretches on the route...",
  "safeInterruptAfterMs": 4000,
  "estimatedPlaybackMs": 17600
}
```

### InterruptResult

```json
{
  "turnId": "turn_457",
  "speaker": "theo",
  "segmentType": "interrupt_response",
  "intent": "preference_change",
  "audioUrl": "https://example.com/audio/turn_457.mp3",
  "transcriptPreview": "Got it. Less news, more route context from here."
}
```

### ErrorPayload

```json
{
  "code": "route_generation_failed",
  "message": "Unable to generate route candidates right now."
}
```

## External API Ownership

### Frontend SDK Ownership

Frontend may directly use:

- Google Maps SDK for iOS for rendering
- Google Places SDK for iOS for destination autocomplete
- Google Navigation SDK for iOS for navigation overlay fields
- CoreLocation and CoreMotion for device signals

### Backend External API Ownership

Backend owns:

- Gemini Live invocation
- Gemini non-live planning calls
- route generation orchestration
- nearby place enrichment when used for local context
- RSS polling, deduplication, and summarization
- navigation payload preparation sufficient for client-side guidance bootstrap

### Live Enrichment Rule

Nearby places, route facts, and news summaries must be resolved before the live speaker turn is generated. They should be injected as structured context, not retrieved ad hoc inside the live turn.

## REST API

### POST `/v1/profile`

Create or update the user profile captured during onboarding.

Request:

```json
{
  "nickname": "Luna",
  "hostStyle": "sarcastic",
  "preferredSpeakers": ["maya", "theo"],
  "routeModeDefault": "loop",
  "durationMinutesDefault": 45,
  "newsCategories": ["tech", "world"],
  "newsDensity": "medium",
  "talkDensityDefault": "medium",
  "quietModeDefault": false
}
```

Response:

```json
{
  "ok": true,
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
  }
}
```

### GET `/v1/profile`

Returns the persisted profile used to prefill onboarding and settings.

### POST `/v1/routes/generate`

Generate route candidates for the selected mode.

Request:

```json
{
  "routeMode": "loop",
  "durationMinutes": 45,
  "desiredCount": 3,
  "start": {
    "latitude": 41.8819,
    "longitude": -87.6278
  },
  "destinationQuery": null
}
```

Response:

```json
{
  "requestId": "routes_req_123",
  "candidates": [
    {
      "routeId": "route_loop_01",
      "routeMode": "loop",
      "label": "Lakefront South Loop",
      "distanceMeters": 7100,
      "estimatedDurationSeconds": 2760,
      "polyline": "encoded_overview_polyline",
      "highlights": [
        "lakefront stretch",
        "turnaround near museum campus"
      ],
      "durationFitScore": 0.91,
      "routeComplexityScore": 0.32,
      "startLatitude": 41.8819,
      "startLongitude": -87.6278,
      "endLatitude": 41.8821,
      "endLongitude": -87.6276,
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
                "instruction": "Head south on the lakefront trail",
                "distanceMeters": 850,
                "durationSeconds": 320,
                "maneuver": "depart"
              }
            ]
          }
        ]
      }
    }
  ]
}
```

Behavior notes:

- `loop` requests should target `desiredCount = 3`
- backend should treat running routes as walking-style route generation for MVP
- route generation should return structured metadata that frontend can render directly

### POST `/v1/sessions`

Create a run session after the user selects a route.

Request:

```json
{
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
      "label": "Lakefront South Loop",
      "distanceMeters": 7100,
      "estimatedDurationSeconds": 2760,
      "polyline": "encoded_overview_polyline",
      "highlights": [
        "lakefront stretch",
        "turnaround near museum campus"
      ],
      "durationFitScore": 0.91,
      "routeComplexityScore": 0.32,
      "startLatitude": 41.8819,
      "startLongitude": -87.6278,
      "endLatitude": 41.8821,
      "endLongitude": -87.6276,
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
                "instruction": "Head south on the lakefront trail",
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
}
```

Response:

```json
{
  "sessionId": "sess_123",
  "status": "connecting",
  "websocketUrl": "wss://api.example.com/v1/live/sess_123",
  "openingSpeaker": "maya"
}
```

## Websocket Events

The websocket is the source of truth for active run coordination.

Frontend should send navigation and motion fields that are already normalized from device SDKs. Backend should enrich those snapshots with nearby place context and news eligibility before invoking any model turn.

### Client to Server

#### `session.join`

Sent immediately after the websocket connects.

```json
{
  "type": "session.join",
  "payload": {
    "sessionId": "sess_123"
  }
}
```

#### `context.snapshot`

Sent on a cadence during the active run.

```json
{
  "type": "context.snapshot",
  "payload": {
    "sessionId": "sess_123",
    "location": {
      "latitude": 41.8819,
      "longitude": -87.6278,
      "horizontalAccuracyMeters": 8.5,
      "speedMetersPerSecond": 2.9,
      "courseDegrees": 182.0,
      "timestamp": "2026-03-15T15:00:00Z"
    },
    "nav": {
      "nextInstruction": "Turn right on N Columbus Dr",
      "remainingDistanceMeters": 2800,
      "remainingDurationSeconds": 980,
      "distanceAlongRouteMeters": 4300,
      "offRoute": false,
      "approachingManeuver": false,
      "atTurnaroundPoint": false
    },
    "motion": {
      "elapsedSeconds": 780,
      "distanceMeters": 2350,
      "currentSpeedMetersPerSecond": 2.9,
      "derivedPaceSecondsPerKm": 345,
      "stepCount": 3020,
      "cadenceStepsPerSecond": 2.9,
      "isPaused": false
    },
    "weather": {
      "temperatureC": 9,
      "condition": "clear",
      "isDaylight": true
    }
  }
}
```

#### `interrupt.voice.start`

```json
{
  "type": "interrupt.voice.start",
  "payload": {
    "sessionId": "sess_123",
    "speakerAtInterrupt": "maya"
  }
}
```

#### `interrupt.voice.chunk`

```json
{
  "type": "interrupt.voice.chunk",
  "payload": {
    "sessionId": "sess_123",
    "audioBase64": "base64_pcm_chunk"
  }
}
```

#### `interrupt.voice.end`

```json
{
  "type": "interrupt.voice.end",
  "payload": {
    "sessionId": "sess_123"
  }
}
```

#### `interrupt.text`

```json
{
  "type": "interrupt.text",
  "payload": {
    "sessionId": "sess_123",
    "text": "Less news, more local context please."
  }
}
```

#### `quick_action`

```json
{
  "type": "quick_action",
  "payload": {
    "sessionId": "sess_123",
    "action": "more_news"
  }
}
```

#### `session.preferences.update`

Use this when settings should affect the active run immediately.

```json
{
  "type": "session.preferences.update",
  "payload": {
    "sessionId": "sess_123",
    "preferences": {
      "hostStyle": "sarcastic",
      "newsCategories": ["tech", "world"],
      "newsDensity": "medium",
      "talkDensity": "low",
      "quietModeEnabled": false,
      "quietModeUntil": null
    }
  }
}
```

#### `session.pause`

```json
{
  "type": "session.pause",
  "payload": {
    "sessionId": "sess_123"
  }
}
```

#### `session.resume`

```json
{
  "type": "session.resume",
  "payload": {
    "sessionId": "sess_123"
  }
}
```

#### `session.end`

```json
{
  "type": "session.end",
  "payload": {
    "sessionId": "sess_123"
  }
}
```

### Server to Client

#### `session.ready`

```json
{
  "type": "session.ready",
  "payload": {
    "sessionId": "sess_123",
    "status": "active",
    "openingSpeaker": "maya"
  }
}
```

#### `turn.plan`

This is optional for UI introspection and debugging. Frontend may use it to update the speaker chip before audio arrives.

```json
{
  "type": "turn.plan",
  "payload": {
    "turnId": "turn_456",
    "speaker": "maya",
    "segmentType": "main_turn",
    "contentBuckets": ["local_context", "banter"],
    "targetDurationSeconds": 18,
    "reason": "user_entered_new_area",
    "safeInterruptAfterMs": 4000
  }
}
```

#### `playback.segment`

```json
{
  "type": "playback.segment",
  "payload": {
    "turnId": "turn_456",
    "speaker": "maya",
    "segmentType": "main_turn",
    "audioUrl": "https://example.com/audio/turn_456.mp3",
    "transcriptPreview": "You are about to hit one of the best sunrise stretches on the route...",
    "safeInterruptAfterMs": 4000,
    "estimatedPlaybackMs": 17600
  }
}
```

#### `playback.filler`

```json
{
  "type": "playback.filler",
  "payload": {
    "turnId": "filler_001",
    "speaker": "theo",
    "segmentType": "filler",
    "audioUrl": "https://example.com/audio/filler_001.mp3",
    "transcriptPreview": "Hold on, this next bit is worth it.",
    "safeInterruptAfterMs": 0,
    "estimatedPlaybackMs": 1800
  }
}
```

#### `interrupt.result`

```json
{
  "type": "interrupt.result",
  "payload": {
    "turnId": "turn_457",
    "speaker": "theo",
    "segmentType": "interrupt_response",
    "intent": "preference_change",
    "audioUrl": "https://example.com/audio/turn_457.mp3",
    "transcriptPreview": "Got it. Less news, more local context from here."
  }
}
```

#### `session.preferences.updated`

```json
{
  "type": "session.preferences.updated",
  "payload": {
    "sessionId": "sess_123",
    "preferences": {
      "hostStyle": "sarcastic",
      "newsCategories": ["tech", "world"],
      "newsDensity": "medium",
      "talkDensity": "low",
      "quietModeEnabled": false,
      "quietModeUntil": null
    }
  }
}
```

#### `session.reconnect_required`

```json
{
  "type": "session.reconnect_required",
  "payload": {
    "sessionId": "sess_123",
    "status": "reconnecting",
    "resumeToken": "resume_abc",
    "reason": "live_session_rollover"
  }
}
```

#### `error`

```json
{
  "type": "error",
  "payload": {
    "code": "route_generation_failed",
    "message": "Unable to generate route candidates right now."
  }
}
```

## Session State Machine

Frontend should assume this state progression:

1. `idle`
2. `connecting`
3. `active`
4. `paused`
5. `active`
6. `reconnecting` when needed
7. `active` after recovery
8. `ended`

## Ownership Boundaries

Frontend owns:

- local UI state
- route candidate presentation
- navigation overlay rendering
- context snapshot capture
- local playback queue
- interruption controls
- destination autocomplete UX
- active settings UI that maps to `session.preferences.update`

Backend owns:

- speaker selection
- bucket selection
- route-aware content planning
- news selection and summarization
- model invocation
- filler selection
- checkpoint and reconnect policy
- place and landmark enrichment for spoken context
- route candidate ranking strategy

## Open Questions Reserved For Later

- whether host renaming will be supported
- whether transcript history beyond the compact strip will be persisted
- whether playback audio will later move from URL-based clips to streamed chunks
