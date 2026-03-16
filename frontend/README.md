# Frontend

SwiftUI iPhone client for `Pathly`.

## Local Setup

After cloning the repo, create your local config file:

```bash
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig
```

Then open `Config/Secrets.xcconfig` and fill the values needed for your local run.

The app now has a built-in hosted backend fallback:

`https://pathly-production.up.railway.app`

So if you do not set any `PATHLY_API_*` override, Pathly will use that production API by default.

Use `PATHLY_API_SCHEME` + `PATHLY_API_AUTHORITY` for real backend URLs.
`xcconfig` treats `//` as a comment marker, so a raw `PATHLY_API_BASE_URL = https://...` entry can collapse into `https:`.

For a live hosted backend:

```xcconfig
PATHLY_API_BASE_URL =
PATHLY_API_SCHEME = https
PATHLY_API_AUTHORITY = pathly-production.up.railway.app
PATHLY_API_BASE_PATH =
PATHLY_USE_MOCKS = NO
GOOGLE_MAPS_API_KEY = YOUR_IOS_GOOGLE_MAPS_KEY
PATHLY_DEVELOPMENT_TEAM = YOUR_APPLE_DEVELOPMENT_TEAM
```

For the built-in mock backend:

```xcconfig
PATHLY_API_BASE_URL =
PATHLY_API_SCHEME =
PATHLY_API_AUTHORITY =
PATHLY_API_BASE_PATH =
PATHLY_USE_MOCKS = YES
GOOGLE_MAPS_API_KEY = YOUR_IOS_GOOGLE_MAPS_KEY
PATHLY_DEVELOPMENT_TEAM = YOUR_APPLE_DEVELOPMENT_TEAM
```

What each value does:

- `PATHLY_API_BASE_URL`: optional direct base URL override if you inject it from somewhere other than plain `xcconfig`
- `PATHLY_API_SCHEME`: optional URL scheme override, for example `https` or `http`
- `PATHLY_API_AUTHORITY`: optional backend host or host:port override, for example `pathly-production.up.railway.app` or `192.168.1.20:8080`
- `PATHLY_API_BASE_PATH`: optional base path if your backend is mounted below the origin root
- `PATHLY_USE_MOCKS`: `YES` to use the built-in mock backend, `NO` to call a real backend
- `GOOGLE_MAPS_API_KEY`: required for Google Maps, Places, and Navigation SDK usage on iPhone
- `PATHLY_DEVELOPMENT_TEAM`: required for signing and running on a real iPhone from Xcode

`PATHLY_USE_MOCKS=YES` keeps the app fully runnable against the local contract-faithful mock layer, including:

- profile defaults with `talkDensityDefault` and `quietModeDefault`
- route generation with `navigationPayload`
- websocket `session.preferences.update` and `session.preferences.updated`
- Maya/Theo opening turns, quick actions, interrupts, and reconnect banner

When using a hosted backend:

- if no override is set, the app falls back to `https://pathly-production.up.railway.app`
- prefer `PATHLY_API_SCHEME=https` and `PATHLY_API_AUTHORITY=...`
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
