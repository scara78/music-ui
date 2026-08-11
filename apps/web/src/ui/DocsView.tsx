import {
  AudioLines,
  FileAudio,
  History,
  ListMusic,
  MicVocal,
  PenLine,
  SlidersHorizontal,
  Trash2,
  WalletCards,
} from "lucide-react";

export function DocsView() {
  return (
    <section className="settings-view" aria-labelledby="docs-title">
      <div>
        <p className="eyebrow">Music 3 docs</p>
        <h1 id="docs-title">Prompting guide</h1>
        <p className="settings-intro">
          Write or revise lyrics, turn an idea into an original track, restyle reference audio, and
          keep every result organized in your private workspace.
        </p>
      </div>

      <div className="settings-grid">
        <article>
          <span className="settings-icon" aria-hidden="true">
            <AudioLines />
          </span>
          <div>
            <h2>Sound prompting</h2>
            <p>
              Describe genre and era, instrumentation, tempo or energy, mood, production texture,
              vocal character, and how the arrangement should develop. For example: “Warm 1970s
              soul, brushed drums, intimate alto vocal, slow-burning verses, then a wide final
              chorus.”
            </p>
            <p>
              Music 3 has no separate controls here for BPM, key, duration, seed, genre, voice, or
              negative prompts, so put useful musical direction in the sound prompt.
            </p>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <MicVocal />
          </span>
          <div>
            <h2>Vocal and lyric modes</h2>
            <p>
              <strong>Custom vocals:</strong> turn off automatic lyrics and provide your own lyrics.
              {" "}
              <strong>Automatic lyrics:</strong>{" "}
              provide a sound prompt, leave lyrics empty, and enable the optimizer.{" "}
              <strong>Instrumental:</strong>{" "}
              provide a prompt, leave lyrics empty, and turn on instrumental mode; automatic lyrics
              stays off.
            </p>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <PenLine />
          </span>
          <div>
            <h2>Lyrics workshop</h2>
            <p>
              <strong>Write full song</strong>{" "}
              can start from a theme or generate a surprise when its instruction is empty.{" "}
              <strong>Edit or continue</strong>{" "}
              takes existing lyrics and an optional direction. A supplied title stays locked, while
              every response includes a title, style tags, and structured lyrics that you can apply
              to the song composer.
            </p>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <FileAudio />
          </span>
          <div>
            <h2>One-step and two-step covers</h2>
            <p>
              Start from an audio URL or a local audio file. One-step cover sends the reference and
              target style together, with optional replacement lyrics. Two-step cover first prepares
              the reference, then lets you review and edit the extracted structured lyrics before
              generating. Prepared feature IDs remain valid for 24 hours.
            </p>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <ListMusic />
          </span>
          <div>
            <h2>Structure tags</h2>
            <p>
              Shape custom lyrics with <code>[Intro]</code>, <code>[Verse]</code>,{" "}
              <code>[Pre Chorus]</code>, <code>[Chorus]</code>, <code>[Interlude]</code>,{" "}
              <code>[Bridge]</code>, <code>[Outro]</code>, <code>[Post Chorus]</code>,{" "}
              <code>[Transition]</code>, <code>[Break]</code>, <code>[Hook]</code>,{" "}
              <code>[Build Up]</code>, <code>[Inst]</code>, and{" "}
              <code>[Solo]</code>. Tags guide the form; the surrounding words still carry the
              lyrical intent.
            </p>
            <pre
              className="prompt-example"
              aria-label="Structured lyric example"
            ><code>{`[Verse]
Streetlights shimmer after rain
I hear your footsteps in the passing trains

[Pre Chorus]
Every signal turns to gold

[Chorus]
Meet me where the skyline opens
We can make this moment last

[Bridge]
No more living in the almost
No more shadows from the past

[Outro]
Meet me where the skyline opens`}</code></pre>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <SlidersHorizontal />
          </span>
          <div>
            <h2>Audio settings</h2>
            <p>
              Choose a sample rate of 16, 24, 32, or 44.1 kHz and a bitrate of 32, 64, 128, or 256
              kbps. MP3 is compact for everyday listening, WAV is convenient for editing, and PCM is
              raw audio for workflows that expect it.
            </p>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <History />
          </span>
          <div>
            <h2>History, reuse, and retry</h2>
            <p>
              Cadence saves every local request and output because MiniMax does not expose a music
              task-history endpoint. Open Details to inspect a generation, use Use settings to copy
              it into the composer, and use Load more for older history. Retry submits a fresh,
              linked request with the same immutable generation settings; renaming only changes the
              local title.
            </p>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <Trash2 />
          </span>
          <div>
            <h2>Playback, queue, and removal</h2>
            <p>
              The player keeps track progress synchronized with library cards. Open Queue to jump
              between playable results, change playback speed when reviewing a track, and download
              audio with its local title. Remove permanently deletes a generation and its stored
              audio from this workspace.
            </p>
          </div>
        </article>

        <article>
          <span className="settings-icon" aria-hidden="true">
            <WalletCards />
          </span>
          <div>
            <h2>Free vs paid</h2>
            <p>
              <code>music-3.0-free</code>{" "}
              is queued sequentially at no more than three requests per minute.{" "}
              <code>music-3.0</code>{" "}
              skips that app-side free-model interval, while your MiniMax quota and billing still
              apply. Both modes create one track per request. Cadence never automatically repeats an
              ambiguous generation call, so use the explicit Retry action when needed.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
