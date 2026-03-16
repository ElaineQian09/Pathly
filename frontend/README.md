# Frontend

SwiftUI iPhone client for `Pathly`.

## Local Setup

After cloning the repo, create your local config file:

```bash
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig
```

Then open `Config/Secrets.xcconfig` and fill the values needed for your local run.

For a live hosted backend:

```xcconfig
PATHLY_API_BASE_URL = https://pathly-production.up.railway.app
PATHLY_USE_MOCKS = NO
GOOGLE_MAPS_API_KEY = YOUR_IOS_GOOGLE_MAPS_KEY
PATHLY_DEVELOPMENT_TEAM = YOUR_APPLE_DEVELOPMENT_TEAM
```

For the built-in mock backend:

```xcconfig
PATHLY_API_BASE_URL =
PATHLY_USE_MOCKS = YES
GOOGLE_MAPS_API_KEY = YOUR_IOS_GOOGLE_MAPS_KEY
PATHLY_DEVELOPMENT_TEAM = YOUR_APPLE_DEVELOPMENT_TEAM
```

What each value does:

- `PATHLY_API_BASE_URL`: HTTPS origin for the Pathly backend REST API
- `PATHLY_USE_MOCKS`: `YES` to use the built-in mock backend, `NO` to call a real backend
- `GOOGLE_MAPS_API_KEY`: required for Google Maps, Places, and Navigation SDK usage on iPhone
- `PATHLY_DEVELOPMENT_TEAM`: required for signing and running on a real iPhone from Xcode

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
Only commit `Config/Secrets.example.xcconfig`.

## Current Scope

- pitch page
- onboarding
- route selection with loop 3 candidates
- live run page with map-first overlays
- settings with live session preference sync
- Google Maps, Places, and Navigation SDK integration points
