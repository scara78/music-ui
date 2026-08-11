import { type SyntheticEvent, useId, useState } from "react";
import {
  AUDIO_FORMATS,
  type AudioFormat,
  type Bitrate,
  BITRATES,
  type CreateGenerationInput,
  SAMPLE_RATES,
  type SampleRate,
  TRACK_MODELS,
  type TrackModel,
} from "@contracts";
import { ChevronDown, Dice5, Music2, Sparkles, WandSparkles } from "lucide-react";
import {
  type ComposerMode,
  type LyricsMode,
  setInstrumental,
  setLyricsMode,
  validateDraft,
} from "../lib/draft";

const IDEAS = [
  "Nocturnal synth-pop with glassy arpeggios and a soaring chorus",
  "Warm tape-saturated jazz-hop for a rainy late-night train",
  "Cinematic post-rock instrumental building from whispers to thunder",
];

const LYRIC_IDEAS = [
  `[Intro]
Neon trembles in a puddle
Last train humming underground

[Verse]
I kept your postcard in my jacket
Creased along the words we never said
Every crossing light turns amber
Like the city knows I am not ready yet

[Pre Chorus]
If the night can hold a secret
Let it carry mine to you

[Chorus]
Meet me where the skyline opens
Where the river catches fire
We can turn these almost-moments
Into something that survives
If tomorrow pulls us onward
I will leave one light for you
Meet me where the skyline opens
I will find my way there too

[Verse]
Coffee cooling on the counter
Morning drawing silver through the blinds
I can hear your old song playing
In the quiet spaces traffic leaves behind

[Bridge]
No more rehearsing our goodbyes
No more living between lines
Take my hand before the daylight
Changes both our minds

[Chorus]
Meet me where the skyline opens
Where the river catches fire
We can turn these almost-moments
Into something that survives

[Outro]
One light on the water
One light leading home`,
  `[Verse]
Morning rolls across the orchard
Gold dust waking on the leaves
I have worn the road like armor
Now the road is asking me to breathe

[Pre Chorus]
All the miles I carried
Fall away beneath my feet

[Chorus]
I am coming back to the table
Back to the names that know me well
Back to the hands that kept a place for me
When I could not keep myself
Let the old screen door sing open
Let the kettle tell the time
I am coming back to the table
With an open heart this time

[Post Chorus]
Leave a light, leave a light
I can see it from the county line

[Verse]
There are photographs in boxes
There is laughter hiding in the hall
Every scar becomes a compass
When you finally stop outrunning it all

[Bridge]
I thought home was just a memory
Something distance would erase
But love kept setting one more chair
And saving me a place

[Chorus]
I am coming back to the table
Back to the names that know me well
Back to the hands that kept a place for me
When I could not keep myself

[Outro]
Leave a light beside the window
I am almost home`,
  `[Intro]
Count the sparks above the avenue
Three, two, one, we move

[Verse]
Static in the midnight air
Silver sneakers on the stair
Every rooftop radio
Calls us where the wild lights go

[Build Up]
Heartbeat climbing, colors collide
Doors are opening wide

[Chorus]
We are weightless for a minute
No horizon, no ceiling
Turn the whole world up and spin it
Till the dark becomes a feeling
We are louder than the sirens
We are brighter on our own
We are weightless for a minute
And a minute takes us home

[Interlude]
Oh, let it rise
Oh, electric skies

[Verse]
Names in vapor, hands in time
Bassline rolling down the spine
Every stranger in the glow
Sings the words they somehow know

[Break]
Cut the lights
Hold the sound
Feel the whole room leave the ground

[Hook]
Weightless, weightless
Nothing holding us tonight
Weightless, weightless
We are made of borrowed light

[Chorus]
We are weightless for a minute
No horizon, no ceiling
Turn the whole world up and spin it
Till the dark becomes a feeling

[Outro]
Three, two, one
Morning comes
We keep moving`,
];

export interface ComposerProps {
  draft: CreateGenerationInput;
  busy: boolean;
  onChange: (draft: CreateGenerationInput) => void;
  onSubmit: (draft: CreateGenerationInput) => void;
}

export function Composer({ draft, busy, onChange, onSubmit }: ComposerProps) {
  const [mode, setMode] = useState<ComposerMode>(() =>
    draft.title || draft.lyrics ? "custom" : "quick"
  );
  const [lyricsMode, setLocalLyricsMode] = useState<LyricsMode>(
    draft.lyricsOptimizer ? "auto" : "write",
  );
  const [ideaIndex, setIdeaIndex] = useState(0);
  const [lyricIdeaIndex, setLyricIdeaIndex] = useState(-1);
  const formId = useId();
  const error = validateDraft(draft);

  function chooseMode(nextMode: ComposerMode) {
    setMode(nextMode);
    if (nextMode === "quick" && !draft.instrumental) {
      setLocalLyricsMode("auto");
      onChange(setLyricsMode(draft, "auto"));
    }
  }

  function chooseLyricsMode(nextMode: LyricsMode) {
    setLocalLyricsMode(nextMode);
    onChange(setLyricsMode(draft, nextMode));
  }

  function randomize() {
    const nextIndex = (ideaIndex + 1) % IDEAS.length;
    setIdeaIndex(nextIndex);
    onChange({ ...draft, prompt: IDEAS[nextIndex]! });
  }

  function inspireLyrics() {
    const nextIndex = (lyricIdeaIndex + 1) % LYRIC_IDEAS.length;
    setLyricIdeaIndex(nextIndex);
    onChange({ ...draft, lyrics: LYRIC_IDEAS[nextIndex]! });
  }

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!error && !busy) onSubmit(draft);
  }

  return (
    <section className="composer-panel" aria-labelledby={`${formId}-title`}>
      <div className="composer-heading">
        <div>
          <p className="eyebrow">Music 3 workspace</p>
          <h1 id={`${formId}-title`}>Shape a new track</h1>
        </div>
        <div className="mode-switch" aria-label="Composer mode">
          <button
            className={mode === "quick" ? "is-active" : ""}
            type="button"
            onClick={() => chooseMode("quick")}
          >
            Quick
          </button>
          <button
            className={mode === "custom" ? "is-active" : ""}
            type="button"
            onClick={() => chooseMode("custom")}
          >
            Custom
          </button>
        </div>
      </div>

      <form onSubmit={submit}>
        {mode === "custom" && (
          <label className="field">
            <span className="field__label">
              Track title <small>local label</small>
            </span>
            <input
              value={draft.title ?? ""}
              maxLength={80}
              placeholder="Midnight on Avala"
              onChange={(event) => onChange({ ...draft, title: event.target.value || undefined })}
            />
          </label>
        )}

        <label className="field field--hero">
          <span className="field__label">
            Describe your sound <span>{draft.prompt.length}/2000</span>
          </span>
          <textarea
            value={draft.prompt}
            maxLength={2000}
            rows={mode === "quick" ? 7 : 4}
            placeholder="Genre, mood, instruments, voice, tempo, scene…"
            onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
          />
          <button
            className="dice-button"
            type="button"
            onClick={randomize}
            aria-label="Try another prompt idea"
          >
            <Dice5 size={16} /> Inspire me
          </button>
        </label>

        {mode === "custom" && !draft.instrumental && (
          <div className="lyrics-card">
            <div className="lyrics-card__header">
              <span className="field__label">Lyrics</span>
              <div className="mini-tabs" aria-label="Lyrics mode">
                <button
                  className={lyricsMode === "auto" ? "is-active" : ""}
                  type="button"
                  onClick={() => chooseLyricsMode("auto")}
                >
                  <WandSparkles size={14} /> Auto
                </button>
                <button
                  className={lyricsMode === "write" ? "is-active" : ""}
                  type="button"
                  onClick={() => chooseLyricsMode("write")}
                >
                  Write
                </button>
              </div>
            </div>
            {lyricsMode === "auto"
              ? (
                <p className="quiet-copy">
                  MiniMax will write lyrics from your description. Generated lyrics are not returned
                  separately by the Music API.
                </p>
              )
              : (
                <label className="field field--flush">
                  <span className="sr-only">Custom lyrics</span>
                  <textarea
                    aria-label="Custom lyrics"
                    value={draft.lyrics}
                    maxLength={3500}
                    rows={10}
                    style={{ paddingBottom: 43 }}
                    placeholder={`[Verse]
Streetlights soften in the rain…

[Chorus]
…`}
                    onChange={(event) => onChange({ ...draft, lyrics: event.target.value })}
                  />
                  <button
                    className="dice-button"
                    type="button"
                    onClick={inspireLyrics}
                    aria-label="Try another lyric idea"
                  >
                    <Dice5 size={16} /> Inspire me
                  </button>
                  <span className="char-count">{draft.lyrics.length}/3500</span>
                </label>
              )}
          </div>
        )}

        <label className="switch-row">
          <span>
            <Music2 size={17} />
            <span>
              <strong>Instrumental</strong>
              <small>No vocals or lyric generation</small>
            </span>
          </span>
          <input
            type="checkbox"
            checked={draft.instrumental}
            onChange={(event) => {
              let next = setInstrumental(draft, event.target.checked);
              if (event.target.checked) setLocalLyricsMode("write");
              if (!event.target.checked && mode === "quick") {
                setLocalLyricsMode("auto");
                next = setLyricsMode(next, "auto");
              }
              onChange(next);
            }}
          />
        </label>

        <details className="advanced-card">
          <summary>
            <span>Advanced output</span>
            <ChevronDown size={17} />
          </summary>
          <div className="advanced-grid">
            <label className="field">
              <span className="field__label">Model</span>
              <select
                value={draft.model}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    model: event.target.value as TrackModel,
                  })}
              >
                {TRACK_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                    {model.endsWith("-free") ? " · 3 RPM" : " · paid"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Format</span>
              <select
                value={draft.audio.format}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    audio: {
                      ...draft.audio,
                      format: event.target.value as AudioFormat,
                    },
                  })}
              >
                {AUDIO_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Sample rate</span>
              <select
                value={draft.audio.sampleRate}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    audio: {
                      ...draft.audio,
                      sampleRate: Number(event.target.value) as SampleRate,
                    },
                  })}
              >
                {SAMPLE_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {(rate / 1000).toFixed(rate === 44100 ? 1 : 0)} kHz
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Bitrate</span>
              <select
                value={draft.audio.bitrate}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    audio: {
                      ...draft.audio,
                      bitrate: Number(event.target.value) as Bitrate,
                    },
                  })}
              >
                {BITRATES.map((bitrate) => (
                  <option key={bitrate} value={bitrate}>
                    {bitrate / 1000} kbps
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="micro-copy">
            MiniMax supports one output per request. Tempo, key, instruments and vocal direction
            belong in your description.
          </p>
        </details>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button
          className="create-button"
          type="submit"
          disabled={busy || Boolean(error)}
        >
          {busy ? <span className="spinner" /> : <Sparkles size={18} />}
          {busy ? "Adding to queue…" : "Create track"}
        </button>
      </form>
    </section>
  );
}
