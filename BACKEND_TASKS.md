# Backend Tasks

Use this document as the implementation checklist for the `Pathly` backend.

## Goal

Build a backend that can orchestrate a two-host, content-first running podcast with:

- route generation
- live session management
- navigation-aware context
- contextual news
- interruption handling
- reconnect-safe long runs

Backend owns orchestration. Frontend should only send structured context and user actions.

## Backend Principles

- keep routing and prompt logic server-side
- keep the frontend contract stable and structured
- favor deterministic orchestration over vague model autonomy
- never assume the live session will stay up forever
- prefer short turn generation over long monologues
- prioritize smoothness during real runs

## External APIs and Providers

### Gemini APIs

- [ ] Use `Gemini Live` for spoken turn output
- [ ] Use `Gemini Live` for interruption response
- [ ] Use `Gemini Flash` or `Gemini Pro` for router and planning tasks
- [ ] Use `Gemini Flash` or `Gemini Pro` for transcript summarization
- [ ] Use `Gemini Flash` or `Gemini Pro` for news packaging
- [ ] Support ephemeral token flow if client-facing live sessions require it

### Google Maps Platform

- [ ] Use route generation provider logic built on Google routing services
- [ ] Use nearby place search for local context enrichment
- [ ] Use place details enrichment for selected landmarks
- [ ] Treat navigation fields coming from client as authoritative UI guidance input
- [ ] Do not rely on Google Maps grounding inside live turn generation

### News Sources

- [ ] Poll curated RSS feeds
- [ ] Keep source mapping server-side
- [ ] Expose only normalized news categories to frontend

## External API Logic Rules

- [ ] route, place, and news retrieval happen before live turn generation
- [ ] live turn generation consumes structured enrichment, not raw third-party responses
- [ ] place enrichment should be cached to reduce repeated external calls
- [ ] route generation should return frontend-ready metadata

## Core Backend Services

### 1. Profile Service

- [ ] Implement `POST /v1/profile`
- [ ] Implement `GET /v1/profile`
- [ ] Persist nickname
- [ ] Persist host style
- [ ] Persist route mode default
- [ ] Persist duration default
- [ ] Persist news categories
- [ ] Persist news density
- [ ] Persist talk density default
- [ ] Persist quiet mode default

### 2. Route Generation Service

- [ ] Implement `POST /v1/routes/generate`
- [ ] Support `one_way`
- [ ] Support `loop`
- [ ] Support `out_back`
- [ ] Return route candidates with consistent shape
- [ ] Return `3` loop candidates whenever possible
- [ ] Rank loop candidates by fit and coherence
- [ ] Attach route labels and highlights
- [ ] Mark route provider source if useful for debugging
- [ ] Return navigation-ready payload, not just display polyline
- [ ] Return strong errors for empty or failed generation

#### Loop Generation Logic

- [ ] Estimate target distance from requested duration
- [ ] Use default or recent pace when available
- [ ] Generate candidate loops near the start point
- [ ] Prefer routes with better place density and lower complexity
- [ ] Keep start and end close
- [ ] Tolerate reasonable duration variance
- [ ] Treat running routes as walking-style route generation for MVP

### 3. Session Service

- [ ] Implement `POST /v1/sessions`
- [ ] Generate unique session IDs
- [ ] Store selected route and user profile snapshot
- [ ] Set opening speaker
- [ ] Create websocket session state
- [ ] Track session status
- [ ] Support pause
- [ ] Support resume
- [ ] Support end

### 4. Websocket Orchestration Service

- [ ] Accept `session.join`
- [ ] Validate session ownership
- [ ] Receive `context.snapshot`
- [ ] Receive `interrupt.voice.start`
- [ ] Receive `interrupt.voice.chunk`
- [ ] Receive `interrupt.voice.end`
- [ ] Receive `interrupt.text`
- [ ] Receive `quick_action`
- [ ] Receive `session.preferences.update`
- [ ] Receive `session.pause`
- [ ] Receive `session.resume`
- [ ] Receive `session.end`
- [ ] Emit `session.ready`
- [ ] Emit `turn.plan`
- [ ] Emit `playback.segment`
- [ ] Emit `playback.filler`
- [ ] Emit `playback.audio.chunk`
- [ ] Emit `interrupt.result`
- [ ] Emit `session.preferences.updated`
- [ ] Emit `session.reconnect_required`
- [ ] Emit `error`

## State and Persistence

- [ ] `UserProfile` model
- [ ] `RouteCandidate` model
- [ ] `RouteSelection` model
- [ ] `RunSession` model
- [ ] `TurnRecord` model
- [ ] `PlaybackRecord` model
- [ ] `InterruptRecord` model
- [ ] `NewsItem` model
- [ ] `NewsCluster` model
- [ ] `PlaceCandidate` model
- [ ] `SessionCheckpoint` model
- [ ] `SessionPreferences` model
- [ ] `NavigationPayload` model

## Route-Aware Enrichment

### Nearby Place Service

- [ ] Query nearby places from current position
- [ ] Query route-adjacent places along the active route
- [ ] Support enrichment from route corridor, not just current point
- [ ] Filter low-value or repetitive candidates
- [ ] Cache recent results by route segment or geohash
- [ ] Return short structured place facts

### Local Context Packaging

- [ ] Convert raw place data into short fact candidates
- [ ] Attach why-it-matters context
- [ ] Mark novelty to reduce repetition
- [ ] Mark confidence and freshness

Important:

- do not rely on Google Maps grounding inside the live audio session
- gather place context outside the live call and inject it into turn composition

### Navigation-Driven Enrichment

- [ ] Accept normalized navigation fields from client
- [ ] Detect approaching maneuver and off-route states
- [ ] Detect turnaround or midpoint events
- [ ] Suppress non-essential content during navigation-critical moments

## News Service

### Feed Ingestion

- [ ] Poll curated feeds on a schedule
- [ ] Support `tech`
- [ ] Support `world`
- [ ] Support `sports`
- [ ] Parse title, summary, source, URL, and publish time
- [ ] Normalize timestamps

### News Processing

- [ ] Deduplicate similar items
- [ ] Cluster by topic
- [ ] Score freshness
- [ ] Score spoken suitability
- [ ] Store short spoken-ready summaries
- [ ] Keep source metadata for debugging and future attribution

### News Routing Rules

- [ ] Respect `newsDensity`
- [ ] Keep `medium` density around one news-bearing turn every 3 to 4 turns when stable
- [ ] Suppress news during critical navigation moments
- [ ] Suppress news after urgent interruptions
- [ ] Avoid repeating the same topic in one run
- [ ] Require a bridge back to current route or mood

## Router Service

Backend router should make explicit decisions instead of relying on model intuition.

- [ ] Select next speaker
- [ ] Select `1 to 3` content buckets
- [ ] Set target turn duration
- [ ] Decide whether navigation should override content
- [ ] Decide whether interruption response overrides show flow
- [ ] Decide whether filler is needed
- [ ] Track recent bucket history to reduce repetition

### Router Inputs

- [ ] latest context snapshot
- [ ] active route progress
- [ ] latest navigation state
- [ ] motion deltas
- [ ] transcript summary
- [ ] recent turn history
- [ ] news candidates
- [ ] place candidates
- [ ] user preference changes from quick actions
- [ ] provider-level freshness metadata when available

### Router Rules

- [ ] prefer `local_context` when entering a new area
- [ ] prefer `nudge` when pace drops or route attention is needed
- [ ] allow `news` only when route state is calm
- [ ] emit `run_metrics` every 6 to 8 minutes
- [ ] use `banter` to connect host turns
- [ ] respect `talkDensity`
- [ ] respect active `quietMode`

## Prompt and Turn Composer

- [ ] Build a structured turn package before each model call
- [ ] Inject speaker identity
- [ ] Inject host style
- [ ] Inject nickname when useful
- [ ] Inject route and navigation state
- [ ] Inject motion state
- [ ] Inject place candidates
- [ ] Inject selected news candidate when chosen
- [ ] Inject transcript summary
- [ ] Inject quick action effects
- [ ] Ask for concise turn outputs

### Turn Output Requirements

- [ ] short spoken turn
- [ ] strong continuity with previous turn
- [ ] no abrupt topic jumps
- [ ] route-aware or mood-aware bridge into news
- [ ] clear safe interruption point

## Gemini Integration

### Live Audio Path

- [ ] Decide the live session ownership model
- [ ] Keep backend as orchestration owner
- [ ] Use Gemini Live for spoken turn output and interruption response
- [ ] Keep only one active speaking lane at a time
- [ ] Preserve two host identities in backend state
- [ ] Ensure live turn input is already enriched with route, place, and news context

### Non-Live Model Path

- [ ] Use Gemini Flash or Pro for route-aware turn planning
- [ ] Use Gemini Flash or Pro for news summary packaging
- [ ] Use Gemini Flash or Pro for intent classification
- [ ] Use Gemini Flash or Pro for checkpoint summarization
- [ ] Use Gemini Flash or Pro for local context packaging if templating is insufficient

## Interruption Handling

### Voice Interrupt Path

- [ ] Detect interrupt start
- [ ] Stop or duck queued playback
- [ ] Accumulate audio chunks
- [ ] Detect end of user utterance
- [ ] Classify interrupt intent
- [ ] If urgent, prioritize direct answer
- [ ] After answer, resume the show plan

### Text Interrupt Path

- [ ] Cancel queued next turn
- [ ] Classify text intent
- [ ] Apply preference update or answer directly
- [ ] Rebuild the next turn plan

### Quick Actions

- [ ] Map quick actions to router weight changes
- [ ] Confirm quick action effects in session state
- [ ] Decay temporary actions such as `quiet_5_min`

### Session Preferences Updates

- [ ] Accept live settings updates over websocket
- [ ] Validate and persist session-scoped preference overrides
- [ ] Acknowledge with `session.preferences.updated`
- [ ] Apply updated preferences to subsequent turn planning immediately

## Audio and Playback Payloads

- [ ] Return `turn.plan` before playback when useful
- [ ] Return `playback.segment` as metadata only
- [ ] Return `playback.filler` as metadata only when generation gap appears
- [ ] Return `interrupt.result` as metadata only for user-driven overrides
- [ ] Stream audio bytes over repeated `playback.audio.chunk` events
- [ ] Normalize Gemini Live audio into `pcm_s16le`, `24000 Hz`, mono before sending to frontend
- [ ] Mark the last chunk with `isFinalChunk = true`
- [ ] Prevent duplicate segment delivery
- [ ] Track segment acknowledgements later if needed

## Filler Strategy

- [ ] Build filler library keyed by speaker and style
- [ ] Keep fillers between 1.5 and 3 seconds
- [ ] Rate-limit repetition
- [ ] Use fillers only to hide small latency gaps
- [ ] Do not let fillers carry core information

## Session Checkpointing and Recovery

- [ ] Create periodic transcript checkpoints
- [ ] Create compact summary checkpoints
- [ ] Track current speaker and bucket history
- [ ] Track active route progress and current preferences
- [ ] Emit `session.reconnect_required` when rollover is needed
- [ ] Support resumable sessions after reconnect
- [ ] Restore continuity after reconnect without restarting the show tone

## Safety and Guardrails

- [ ] Keep urgent answers short
- [ ] Suppress jokes during safety or discomfort events
- [ ] Suppress long news turns near critical maneuvers
- [ ] Avoid stale fact repetition
- [ ] Respect `Less talking`
- [ ] Respect quiet mode
- [ ] Keep sarcasm playful, not cruel

## Observability

- [ ] route-generation latency
- [ ] session-start latency
- [ ] time-to-first-audio
- [ ] average turn generation latency
- [ ] filler usage frequency
- [ ] reconnect count
- [ ] interrupt classification accuracy checks
- [ ] news insertion rate
- [ ] navigation override rate

## Suggested Build Order

1. profile endpoints
2. route generation
3. session creation
4. websocket orchestration
5. route-aware place enrichment
6. turn router
7. Gemini Live audio path
8. quick actions and interruptions
9. news ingestion and clustering
10. checkpoints and reconnect

## Demo Scenarios Backend Must Support

- [ ] loop route request returning 3 candidates
- [ ] one-way route request
- [ ] run start returning `session.ready`
- [ ] Maya opening turn
- [ ] Theo follow-up turn
- [ ] local context turn after entering a new area
- [ ] contextual news turn with smooth bridge
- [ ] `Less talking` quick action reducing density
- [ ] voice interruption causing direct answer
- [ ] reconnect-required event and continued session
