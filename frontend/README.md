# Frontend

SwiftUI iPhone client for `Pathly`.

## Local Setup

Copy `Config/Secrets.example.xcconfig` to `Config/Secrets.xcconfig` and fill in local values.

Required local values:

- `GOOGLE_MAPS_API_KEY`
- `PATHLY_DEVELOPMENT_TEAM` for real-device signing

Optional local values:

- `PATHLY_API_BASE_URL`
- `PATHLY_USE_MOCKS`

`PATHLY_USE_MOCKS=YES` keeps the app fully runnable against the local contract-faithful mock layer, including:

- profile defaults with `talkDensityDefault` and `quietModeDefault`
- route generation with `navigationPayload`
- websocket `session.preferences.update` and `session.preferences.updated`
- Maya/Theo opening turns, quick actions, interrupts, and reconnect banner

Do not commit `Config/Secrets.xcconfig`.

## Current Scope

- pitch page
- onboarding
- route selection with loop 3 candidates
- live run page with map-first overlays
- settings with live session preference sync
- Google Maps, Places, and Navigation SDK integration points
