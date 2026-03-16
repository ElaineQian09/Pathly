# Frontend Tasks

Use this document as the iOS implementation checklist for the `Pathly` MVP.

## Goal

Build a SwiftUI-first iPhone app that supports:

- onboarding
- route selection
- a content-first live run page
- settings
- interruption
- reconnect-safe run sessions

The app should remain clear and tappable while the user is moving.

## Frontend Principles

- keep the map as the visual anchor
- keep controls large and obvious
- keep active-run UI minimal
- keep navigation visible but not visually dominant
- prefer native iOS patterns over custom chrome overload
- do not let the UI feel like a dense dashboard

## Stack Assumptions

- SwiftUI
- Google Maps SDK for iOS
- Google Places SDK for iOS
- Google Navigation SDK for iOS
- CoreLocation
- CoreMotion
- AVFoundation
- URLSession or websocket client for backend events

## External SDK Responsibilities

### Google Maps SDK for iOS

- [ ] Render route selection map
- [ ] Render active run map
- [ ] Render route polylines
- [ ] Render candidate route highlighting
- [ ] Render current location puck

### Google Places SDK for iOS

- [ ] Implement destination autocomplete for `One Way`
- [ ] Fetch selected destination place metadata when needed
- [ ] Support nearby place lookup only if frontend owns that path
- [ ] Keep returned place data structured for backend enrichment

### Google Navigation SDK for iOS

- [ ] Start guidance for selected route
- [ ] Surface next instruction
- [ ] Surface remaining distance and ETA
- [ ] Surface off-route state
- [ ] Surface arrival or turnaround events
- [ ] Keep guidance voice under product control

### CoreLocation

- [ ] Capture live location updates
- [ ] Capture speed and course
- [ ] Capture location accuracy
- [ ] Timestamp snapshots

### CoreMotion

- [ ] Capture step count
- [ ] Capture distance
- [ ] Capture pace
- [ ] Capture cadence
- [ ] Capture pause and resume events

## Frontend API Boundary

Frontend should only own:

- map rendering
- destination autocomplete UX
- navigation overlay state
- live sensor capture
- structured snapshot delivery

Frontend should not own:

- news retrieval
- place fact writing
- route-aware prompt construction
- model routing decisions

## App-Level Architecture

### Root Flow

- [ ] Root coordinator decides between onboarding and main route selection
- [ ] Route selection leads into main run page
- [ ] Settings is reachable from both route selection and run page

### Core Stores

- [ ] App settings store
- [ ] User profile store
- [ ] Route selection store
- [ ] Active session store
- [ ] Playback queue store
- [ ] Navigation state store
- [ ] Motion metrics store
- [ ] Transcript strip store
- [ ] Interruption state store
- [ ] Connection and recovery state store

### Persistence

- [ ] Persist first-launch completion
- [ ] Persist nickname
- [ ] Persist selected host style
- [ ] Persist preferred route mode
- [ ] Persist default duration
- [ ] Persist news category choices
- [ ] Persist talk density default
- [ ] Persist quiet mode default
- [ ] Persist last successful route selection if useful

## Data Models To Define

- [ ] `UserProfile`
- [ ] `RouteMode`
- [ ] `HostStyle`
- [ ] `NewsCategory`
- [ ] `RouteCandidate`
- [ ] `RouteSelection`
- [ ] `RunSession`
- [ ] `NavigationState`
- [ ] `MotionSnapshot`
- [ ] `ContextSnapshot`
- [ ] `PlaybackSegment`
- [ ] `TranscriptPreview`
- [ ] `QuickAction`
- [ ] `InterruptState`
- [ ] `SessionPreferences`
- [ ] `NavigationPayload`

## Permissions

- [ ] Ask for location permission
- [ ] Ask for microphone permission
- [ ] Explain motion usage if needed
- [ ] Keep HealthKit out of the initial flow

## Screen 1: Pitch Page

- [ ] Render product title `Pathly`
- [ ] Render one-line value proposition
- [ ] Render one primary CTA
- [ ] Keep page to one screen without scrolling
- [ ] Transition cleanly into onboarding

## Screen 2: Onboarding

- [ ] Nickname text field
- [ ] Host style selector
- [ ] Route mode selector
- [ ] Glass-style duration picker from 10 minutes to 3 hours
- [ ] Optional news category multi-select
- [ ] Continue CTA
- [ ] Validate required choices before continuing
- [ ] Persist onboarding choices locally

### Host Style UI

- [ ] Show `Balanced` as default
- [ ] Label `Balanced` as `Users' choice`
- [ ] Keep `Sarcastic` visible in the main list
- [ ] Add short helper copy under each style

### News Preferences UI

- [ ] Present categories instead of custom RSS URLs
- [ ] Support at least `Tech`, `World`, and `Sports`
- [ ] Make news optional

## Screen 3: Route Selection

- [ ] Render map centered on current location
- [ ] Show current location marker
- [ ] Show selected route mode clearly
- [ ] Allow switching route modes without leaving the page
- [ ] Show duration context while selecting routes

### One Way Mode

- [ ] Destination search field
- [ ] Destination search results
- [ ] Use Places autocomplete for destination search
- [ ] Fetch route candidates or primary route
- [ ] Show duration and distance summary

### Loop Mode

- [ ] Trigger backend route generation using duration and current location
- [ ] Render exactly 3 loop candidates when available
- [ ] Show each candidate with distance, estimated time, and short label
- [ ] Highlight selected candidate on map
- [ ] Make it obvious loop starts and ends near same point

### Out and Back Mode

- [ ] Fetch candidate routes
- [ ] Render 3 candidates for consistency if backend provides them
- [ ] Show turnaround point clearly

### Route Selection States

- [ ] idle
- [ ] locating
- [ ] generating
- [ ] generated
- [ ] empty
- [ ] error

### Route Generation API Handling

- [ ] Send requested duration, mode, and start point to backend
- [ ] Request exactly 3 loop candidates for loop mode
- [ ] Handle empty candidate responses cleanly
- [ ] Surface route-generation beta warning copy if needed for walking-style routes

### Route Candidate UX

- [ ] Candidate cards should be quickly tappable
- [ ] Switching candidates should update highlighted map polyline
- [ ] Selection CTA should be distinct from regeneration CTA

## Screen 4: Main Run Page

- [ ] Full-screen map with route polyline
- [ ] Current location puck
- [ ] Navigation overlay
- [ ] Speaker chip for `Maya` or `Theo`
- [ ] Start CTA
- [ ] Countdown overlay
- [ ] Pause CTA
- [ ] Compact transcript strip
- [ ] Interrupt microphone button
- [ ] Text input or text sheet entry point
- [ ] Quick action chips
- [ ] Compact run metrics
- [ ] Settings entry point

### Navigation Overlay

- [ ] Show next instruction
- [ ] Show remaining distance
- [ ] Show ETA
- [ ] Show off-route state
- [ ] Make the overlay readable at a glance
- [ ] Avoid blocking the map

### Before Run Start

- [ ] Show selected route summary
- [ ] Show selected style and news setting summary
- [ ] Allow user to go back and change route
- [ ] Disable pause and interrupt actions

### On Start Tap

- [ ] Show 3-second countdown
- [ ] Lock active route selection
- [ ] Create run session with backend
- [ ] Transition to connecting state
- [ ] Start location updates
- [ ] Start motion updates
- [ ] Start navigation progress updates
- [ ] Wait for first playback segment

### During Active Run

- [ ] Keep route line visible
- [ ] Keep navigation overlay live
- [ ] Keep current speaker chip updated
- [ ] Keep transcript strip updated with latest spoken preview
- [ ] Show compact elapsed time, distance, and pace
- [ ] Allow quick actions at all times
- [ ] Show clear connection state if reconnecting

### Pause Behavior

- [ ] Stop active playback
- [ ] Stop voice interrupt capture if running
- [ ] Notify backend of pause
- [ ] Maintain resumable state
- [ ] Allow resume

## Settings Page

- [ ] Edit nickname
- [ ] Edit host style
- [ ] Edit route mode default
- [ ] Edit duration default
- [ ] Edit news categories
- [ ] Edit talk density
- [ ] Edit quiet mode preference
- [ ] Persist changes
- [ ] Push active changes to backend if a run is live using `session.preferences.update`

## Run-Time Interaction

### Transcript Strip

- [ ] Show short preview of current or latest spoken turn
- [ ] Keep transcript non-blocking
- [ ] Visually distinguish system response and user interruption result if needed

### Speaker Indicator

- [ ] Clearly show whether `Maya` or `Theo` is speaking
- [ ] Reflect speaker changes as soon as playback payload arrives

### Quick Actions

- [ ] `More news`
- [ ] `More local`
- [ ] `Less talking`
- [ ] `Repeat`
- [ ] `Quiet for 5 min`

### Quick Action Behavior

- [ ] Send structured quick-action event to backend
- [ ] Update local pending state while awaiting confirmation
- [ ] Reflect quiet mode in UI immediately

## Voice Interruption UX

- [ ] Tap-to-interrupt microphone button
- [ ] Immediate playback ducking
- [ ] Clear listening state
- [ ] Show recording waveform or simple indicator
- [ ] Capture until VAD end or manual stop
- [ ] Send interrupt start, chunks, and end events to backend
- [ ] Resume show after response

## Text Interruption UX

- [ ] Provide a compact composer or sheet
- [ ] Support submission without leaving the run page
- [ ] Cancel queued next turn locally when needed
- [ ] Show sending state
- [ ] Show response linkage in transcript strip

## Audio Playback

- [ ] Playback queue that guarantees one active segment at a time
- [ ] Support host-specific audio segments
- [ ] Support streamed audio chunks over websocket instead of clip URLs
- [ ] Decode `pcm_s16le` chunks into a native playback pipeline
- [ ] Support filler clips
- [ ] Support stop, duck, resume, and cancel
- [ ] Prevent overlapping host audio
- [ ] Keep transition latency low between turns

## Networking

### REST

- [ ] Implement profile bootstrap or settings fetch
- [ ] Implement route generation request
- [ ] Implement session creation request

### Websocket

- [ ] Connect to backend orchestration socket
- [ ] Send `session.join`
- [ ] Send `context.snapshot`
- [ ] Send `interrupt.voice.start`
- [ ] Send `interrupt.voice.chunk`
- [ ] Send `interrupt.voice.end`
- [ ] Send `interrupt.text`
- [ ] Send `quick_action`
- [ ] Send `session.preferences.update`
- [ ] Send `session.pause`
- [ ] Send `session.resume`
- [ ] Send `session.end`
- [ ] Handle `session.ready`
- [ ] Handle `turn.plan`
- [ ] Handle `playback.segment`
- [ ] Handle `playback.filler`
- [ ] Handle `playback.audio.chunk`
- [ ] Handle `interrupt.result`
- [ ] Handle `session.preferences.updated`
- [ ] Handle `session.reconnect_required`
- [ ] Handle `error`

## Enrichment Data Flow On Frontend

- [ ] Collect navigation fields from Navigation SDK
- [ ] Collect sensor and location fields from CoreLocation and CoreMotion
- [ ] Keep snapshots structured and small
- [ ] Send snapshots on a stable cadence during active run
- [ ] Do not send raw prompt text
- [ ] Do not attempt local place-fact generation in UI code

## Context Snapshot Collection

Each active-run snapshot should include:

- [ ] timestamp
- [ ] current location
- [ ] route progress
- [ ] navigation instruction state
- [ ] remaining distance and ETA
- [ ] elapsed time
- [ ] distance traveled
- [ ] current speed
- [ ] derived pace
- [ ] step count
- [ ] cadence
- [ ] pause state

## Navigation SDK Integration

- [ ] Start guidance once route is selected for run
- [ ] Read navigation-ready payload returned with selected route
- [ ] Surface next instruction into UI state
- [ ] Surface off-route state into UI state
- [ ] Surface remaining distance and ETA into UI state
- [ ] Surface arrival or midpoint events into UI state
- [ ] Decide whether built-in voice guidance stays silent
- [ ] Ensure spoken navigation moments can coexist with Pathly playback

## Motion and Sensor Integration

- [ ] CoreLocation current speed
- [ ] CoreLocation route position updates
- [ ] CoreLocation course and accuracy
- [ ] CMPedometer step count
- [ ] CMPedometer distance
- [ ] CMPedometer pace
- [ ] CMPedometer cadence
- [ ] CMPedometer pause and resume events

## Connection and Recovery

- [ ] Detect websocket disconnects
- [ ] Show reconnecting state
- [ ] Handle resume token or reconnect instruction from backend
- [ ] Preserve active route and local playback state across reconnect
- [ ] Prevent duplicate UI actions during reconnect

## Error States

- [ ] location permission denied
- [ ] mic permission denied
- [ ] route generation failed
- [ ] session creation failed
- [ ] live playback failed
- [ ] websocket disconnected
- [ ] no candidate routes returned

## Telemetry

- [ ] countdown-to-first-audio latency
- [ ] route-generation latency
- [ ] average turn gap
- [ ] voice interrupt completion rate
- [ ] quick action usage
- [ ] reconnect count per run
- [ ] filler frequency

## Demo Checklist

- [ ] onboarding happy path
- [ ] loop mode showing 3 candidates
- [ ] one-way route selection
- [ ] start countdown
- [ ] Maya opening segment
- [ ] Theo follow-up segment
- [ ] local context turn
- [ ] contextual news turn
- [ ] voice interruption
- [ ] reconnect or quiet-mode demo if time allows
