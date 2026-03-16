# Frontend

SwiftUI iPhone client for `Pathly`.

## Local Setup

Copy `Config/Secrets.example.xcconfig` to `Config/Secrets.xcconfig` and fill in local values.

The committed file is:

- `Config/Secrets.example.xcconfig`

The local-only file is:

- `Config/Secrets.xcconfig`

`Config/Secrets.xcconfig` is gitignored and must never be committed.

Required local values:

- `GOOGLE_MAPS_API_KEY`
- `PATHLY_DEVELOPMENT_TEAM` for real-device signing

Optional local values:

- `PATHLY_API_BASE_URL`
- `PATHLY_USE_MOCKS`

Recommended local flow:

1. Copy the example file:
   `cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig`
2. Choose one runtime mode:
   `PATHLY_USE_MOCKS=YES` for the built-in mock backend
   `PATHLY_USE_MOCKS=NO` plus `PATHLY_API_BASE_URL=https://...` for a live backend
3. Fill `GOOGLE_MAPS_API_KEY` so Google Maps, Places, and Navigation SDK entry points can run on device
4. Fill `PATHLY_DEVELOPMENT_TEAM` for local signing on a real iPhone

Example hosted-backend configuration:

```xcconfig
PATHLY_API_BASE_URL = https://pathly-production.up.railway.app
PATHLY_USE_MOCKS = NO
GOOGLE_MAPS_API_KEY =
PATHLY_DEVELOPMENT_TEAM =
```

Example mock-only configuration:

```xcconfig
PATHLY_API_BASE_URL =
PATHLY_USE_MOCKS = YES
GOOGLE_MAPS_API_KEY =
PATHLY_DEVELOPMENT_TEAM =
```

`PATHLY_USE_MOCKS=YES` keeps the app fully runnable against the local contract-faithful mock layer, including:

- profile defaults with `talkDensityDefault` and `quietModeDefault`
- route generation with `navigationPayload`
- websocket `session.preferences.update` and `session.preferences.updated`
- Maya/Theo opening turns, quick actions, interrupts, and reconnect banner

When using a hosted backend:

- `PATHLY_API_BASE_URL` should point at the HTTPS REST origin
- `/v1/sessions` must return a public `wss://...` websocket URL
- backend secrets stay in the backend platform environment, not in this iOS project

Do not commit `Config/Secrets.xcconfig`.
Do commit `Config/Secrets.example.xcconfig` when the expected local variables change.

## Current Scope

- pitch page
- onboarding
- route selection with loop 3 candidates
- live run page with map-first overlays
- settings with live session preference sync
- Google Maps, Places, and Navigation SDK integration points
