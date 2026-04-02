# MMM-OperatorAmbient Implementation Plan

## Summary

Build a new custom MagicMirror module, `MMM-OperatorAmbient`, as an always-on ambient companion to Operator for a Raspberry Pi smart mirror. The module should be passive, glanceable, reliable when the laptop is asleep, and visually aligned with a monochrome glass aesthetic using Software InFocus accents.

The module should own the entire mirror composition rather than stitching together stock MagicMirror modules. Reuse Operator's Google Calendar integration approach and event normalization rules as a reference, but implement the runtime natively in MagicMirror's Node-based `node_helper`.

Primary requirements:

- Display time continuously.
- Rotate at least 200 quotes from notable thinkers.
- Show Google Calendar data with a 15-minute sync cadence.
- Rotate short tech and politics headlines throughout the day.
- Show weather in a compact Operator-like layout.

Additional v1 ambient features:

- Next meeting countdown.
- Focus window indicator when the calendar is clear.
- Sync status and stale-data indicators.
- Burn-in mitigation and scheduled dimming.

## Visual Direction

The visual treatment should feel like "Operator for a mirror", not a generic dashboard.

Use a black-first glass interface with minimal chrome and a restrained accent system:

- `--ambient-bg: #06080b`
- `--ambient-surface: rgba(255, 255, 255, 0.05)`
- `--ambient-border: rgba(255, 255, 255, 0.12)`
- `--ambient-text: #E8EEF2`
- `--ambient-muted: rgba(232, 238, 242, 0.68)`
- `--ambient-accent: #EE6C4D`
- `--ambient-accent-dim: rgba(238, 108, 77, 0.18)`
- `--ambient-ink: #292A38`

Software InFocus accent usage:

- Use the coral accent for sync pulses, active chips, precipitation or urgency indicators, and divider highlights.
- Keep the rest of the UI neutral and low-fatigue.
- Avoid large coral blocks; this should remain mirror-first, not website-first.

Motion:

- Quote changes should crossfade.
- Headlines should slide or fade softly.
- Layout should have optional micro-drift every few minutes to reduce burn-in risk.
- Scheduled dimming should reduce brightness during evenings and overnight.

## Architecture

### Module layout

Create a new directory:

- `modules/MMM-OperatorAmbient/`

Planned files:

- `modules/MMM-OperatorAmbient/MMM-OperatorAmbient.js`
- `modules/MMM-OperatorAmbient/node_helper.js`
- `modules/MMM-OperatorAmbient/operator-ambient.css`
- `modules/MMM-OperatorAmbient/quotes.json`
- `modules/MMM-OperatorAmbient/README.md`

### Runtime model

`MMM-OperatorAmbient.js` should:

- Render the full mirror layout.
- Maintain the current visible quote and headline state.
- Handle client-side timers for rotation animation.
- Receive normalized snapshots from `node_helper`.
- Render stale or offline states without blanking the screen.

`node_helper.js` should:

- Own all network access and disk-backed caching.
- Handle Google OAuth setup and refresh token exchange.
- Fetch and normalize Google Calendar events.
- Fetch and normalize weather data.
- Fetch and normalize RSS headlines.
- Load and validate the quotes dataset.
- Send a single normalized snapshot payload to the front-end.

### Snapshot contract

Use one internal payload shape between `node_helper` and the front-end:

```ts
type AmbientSnapshot = {
  generatedAt: string;
  status: {
    isOffline: boolean;
    lastCalendarSyncAt: string | null;
    lastHeadlineSyncAt: string | null;
    lastWeatherSyncAt: string | null;
    calendarStale: boolean;
    headlineStale: boolean;
    weatherStale: boolean;
  };
  clock: {
    timezone: string;
  };
  weather: {
    location: string;
    periods: Array<{
      label: string;
      condition: string;
      temperatureF: number | null;
      rainChance: number | null;
      isNow: boolean;
    }>;
  } | null;
  calendar: {
    events: Array<{
      id: string;
      title: string;
      startAt: string;
      endAt: string | null;
      isAllDay: boolean;
      location: string | null;
      sourceCalendar: string | null;
      status: string | null;
    }>;
    nextMeetingStartsAt: string | null;
    nextFreeWindowMinutes: number | null;
  };
  quotes: {
    items: Array<{
      text: string;
      author: string;
      tag: string | null;
    }>;
  };
  headlines: {
    items: Array<{
      id: string;
      title: string;
      source: string;
      category: "tech" | "politics";
      publishedAt: string | null;
      url: string;
    }>;
  };
};
```

The front-end should never consume raw Google or RSS payloads directly.

## Data Integration

### Google Calendar

Implement Google Calendar directly on the Pi in `node_helper.js`.

Do not:

- Depend on the laptop to publish data.
- Depend on MagicMirror's stock `calendar` module.
- Attempt to run the full Operator runtime inside MagicMirror.

Follow Operator's integration model as reference only:

- Token refresh behavior from `/Users/mattrusso/src/tower/src-tauri/src/google/mod.rs`
- Event normalization behavior from `/Users/mattrusso/src/tower/src-tauri/src/google/mod.rs`

Do not reuse Operator's desktop-specific pieces directly:

- Tauri app session state.
- Rust keyring storage.
- Rust-only storage or database plumbing.
- Desktop localhost callback expectations that are tightly coupled to Operator UI.

Mirror-specific auth requirements:

- Scope set should be limited to:
  - `https://www.googleapis.com/auth/calendar.readonly`
  - `https://www.googleapis.com/auth/userinfo.email`
- Store refresh tokens in a simple local file or Pi-safe secret store that the module controls.
- Cache the last successful normalized calendar snapshot to disk.

Calendar polling and rendering rules:

- Poll every 15 minutes.
- Show only the next 3 to 5 events within the next 24 hours.
- Ignore cancelled events.
- Respect all-day events.
- Render times in the Pi's local timezone.
- If the last sync is older than 20 minutes, show a stale indicator.
- If the network fails, keep showing cached events and mark the feed stale rather than emptying the module.

### Weather

Weather should visually match the compact Operator pattern:

- Show location.
- Show `Now` plus the next two forecast periods.
- Show condition icon, temperature, and rain chance where available.

Implementation rules:

- Poll every 10 minutes.
- Cache the last successful weather snapshot to disk.
- Preserve cached weather on network failure.
- Use a single consistent provider in v1.

### Headlines

Use configurable RSS feeds for two categories:

- `tech`
- `politics`

Rules:

- Poll every 15 minutes.
- Dedupe by normalized title across all feeds.
- Discard items older than 24 hours.
- Keep only short one-sentence headlines.
- Truncate to a maximum of 120 characters for display.
- Rotate one item at a time every 20 seconds.

Headline sources should be configurable in the module config rather than hard-coded in rendering logic.

### Quotes

Ship a checked-in `quotes.json` with at least 250 curated entries.

Each quote should include:

- `text`
- `author`
- `tag`

Rules:

- Rotate every 45 seconds.
- Do not repeat until the full pool is exhausted.
- Filter out quotes that are too long to remain readable from desk distance.
- Curate for a "smart office mirror" tone: scientists, engineers, founders, writers, strategists, statesmen.

## Layout and Behavior

Use one full-screen composition:

- Upper left: oversized clock with weekday and date.
- Upper right: weather card.
- Center: quote panel with author line.
- Side rail: next events list.
- Bottom bar: rotating headline ticker and sync health.

Behavioral details:

- Time updates every second if `showSeconds` is enabled, otherwise every minute.
- If the next meeting starts within 30 minutes, show a coral-accent "Next meeting in X min" chip.
- If the next meeting is not soon, show a "Clear for Y min" focus chip if a meaningful gap exists.
- If there are no events today, show a calm empty state instead of a blank panel.
- If there are no fresh headlines, keep the most recent cached headlines visible with a stale marker.

## Configuration Surface

Expose a single config surface in `config/config.js`:

```js
{
  module: "MMM-OperatorAmbient",
  position: "fullscreen_below",
  config: {
    timeFormat: 12,
    showSeconds: false,
    quoteRotationMs: 45000,
    headlineRotationMs: 20000,
    calendarPollMs: 15 * 60 * 1000,
    weatherPollMs: 10 * 60 * 1000,
    headlinePollMs: 15 * 60 * 1000,
    accentColor: "#EE6C4D",
    sleepHours: { start: 22, end: 6 },
    google: {
      clientId: "",
      clientSecret: "",
      calendarIds: ["primary"]
    },
    headlines: {
      tech: [],
      politics: []
    }
  }
}
```

Defaults:

- Use Software InFocus coral as the default accent.
- Default to passive ambient behavior.
- Default to local caching enabled.
- Default to showing one unified module full-screen.

## Implementation Sequence

1. Scaffold `modules/MMM-OperatorAmbient/` with front-end module, `node_helper`, stylesheet, quotes seed file, and README.
2. Define the normalized snapshot contract and front-end rendering shell.
3. Implement disk-backed cache loading so the module can render immediately on boot.
4. Implement quotes loading and client-side rotation.
5. Implement headline ingestion, normalization, dedupe, caching, and rotation.
6. Implement weather fetch, normalization, caching, and Operator-style card rendering.
7. Implement Google OAuth, token refresh, calendar fetch, normalization, and 15-minute polling.
8. Add meeting countdown and focus-window logic.
9. Add stale-data states, offline states, dimming, and burn-in mitigation.
10. Add config example to the repo's MagicMirror config sample or module README.

## Test Plan

Functional coverage:

- Verify cold boot with cache present renders immediately.
- Verify cold boot without cache renders a clean loading state.
- Verify OAuth success flow stores a refresh token and subsequent background refreshes work.
- Verify expired or revoked refresh token yields a clear degraded state.
- Verify calendar sync cadence of 15 minutes.
- Verify all-day events, timezone correctness, and cancelled-event filtering.
- Verify quote rotation covers the full set before repeating.
- Verify malformed quote entries are skipped safely.
- Verify headline dedupe across feeds and clean truncation to one line.
- Verify weather continues showing cached data during outages.
- Verify next-meeting chip and focus-window chip logic.

Visual and device coverage:

- Verify readability from desk distance on the actual mirror.
- Verify the Pi remains responsive in kiosk mode over long runs.
- Verify animation and refresh behavior do not cause noticeable CPU spikes.
- Verify dimming and burn-in mitigation are subtle and not distracting.

## Assumptions

- The mirror runs directly on the Raspberry Pi and must keep working when the laptop is unavailable.
- This module is a supplement to Operator, not a replacement for Operator.
- Google Calendar is the only required authenticated source in v1.
- Gmail and deeper Operator data are out of scope for v1.
- Software InFocus accent colors are based on the live site as of April 1, 2026.
