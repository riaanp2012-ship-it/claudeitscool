# J.A.R.V.I.S. for macOS

A voice-first desktop assistant: always-on listening, ElevenLabs voice, Gemini brain, and real Mac control.

## Run
```bash
cd jarvis
npm install
```
Then pick one:
- **Real Mac app:** `npm run build:mac` builds **JARVIS.app**, copies it into Applications and opens it.
  After that, launch it from Launchpad/Spotlight like any app (drag it to the Dock to keep it there).
  Unsigned app: if macOS blocks it, right-click JARVIS in Applications → Open → Open.
- **Browser:** `npm start` opens **http://localhost:3000** (use Chrome for the mic).
- **Dev window:** `npm run app`.
On first launch the Settings panel opens; paste your **ElevenLabs** and **Gemini** API keys (stored only in
`~/Library/Application Support/jarvis/config.json`). Or copy `.env.example` to `.env` and fill it in.

macOS will ask for **Microphone** access, and the first time JARVIS controls another app it will ask for
**Automation** / **Accessibility** access (System Settings → Privacy & Security).

## How it works
- **Voice (default):** just talk. Speech is detected automatically, transcribed by ElevenLabs Scribe, answered by
  Gemini, and spoken back with an ElevenLabs voice. `M` toggles the mic, `Esc` or clicking the orb interrupts him.
- **Typing:** use the bar at the bottom any time.
- **Abilities:** open/quit apps, Google search, open sites, read webpages, volume, Spotify/Music control,
  system status, notifications, and arbitrary AppleScript / shell commands.
- **Permissions:** opening apps, AppleScript and shell commands pop a dialog: *Allow once*, *Always allow*, or *Deny*.
  Reset "Always allow" in Settings.

Try: "Open Spotify and play some music", "Google the weather in Cape Town", "Turn the volume down to 20",
"What's my battery at?", "Switch to dark mode".
