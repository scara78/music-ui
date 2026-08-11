# MiniMax Music 3 integration notes

This implementation was checked against the current global MiniMax documentation on 2026-08-11:

- [Music Generation guide](https://platform.minimax.io/docs/guides/music-generation)
- [Music Generation API](https://platform.minimax.io/docs/api-reference/music-generation)
- [Rate limits](https://platform.minimax.io/docs/guides/rate-limits)
- [Error codes](https://platform.minimax.io/docs/api-reference/errorcode)

## Provider request

Cadence calls `POST https://api.minimax.io/v1/music_generation` with Bearer authentication.
Production requests use `stream: false` and `output_format: "url"`, then immediately copy the
returned file into local tenant-scoped storage because provider URLs expire after 24 hours.

```ts
interface MiniMaxMusic3Request {
  model: "music-3.0-free" | "music-3.0";
  prompt?: string; // up to 2,000 characters
  lyrics?: string; // up to 3,500 characters
  lyrics_optimizer: boolean;
  is_instrumental: boolean;
  stream: false;
  output_format: "url";
  audio_setting: {
    sample_rate: 16000 | 24000 | 32000 | 44100;
    bitrate: 32000 | 64000 | 128000 | 256000;
    format: "mp3" | "wav" | "pcm";
  };
}
```

Rules enforced by both UI and API:

- instrumentals require a prompt and cannot include lyrics or automatic lyrics;
- automatic lyrics require a prompt and cannot be combined with supplied lyrics;
- vocal songs without automatic lyrics require custom lyrics;
- the free model is queued at no more than 3 requests per minute;
- retries are explicit because an ambiguous transport failure cannot safely be retried without
  risking a duplicate song.

Supported lyric structure tags include `[Intro]`, `[Verse]`, `[Pre Chorus]`, `[Chorus]`,
`[Interlude]`, `[Bridge]`, `[Outro]`, `[Post Chorus]`, `[Transition]`, `[Break]`, `[Hook]`,
`[Build Up]`, `[Inst]`, and `[Solo]`.

## Provider response handling

Cadence checks both the HTTP response and `base_resp.status_code`. It accepts the result URL from
either `data.audio_url` or `data.audio` for compatibility with MiniMax's current official clients.
Hex audio is also decoded defensively if the provider returns it despite the requested URL format.

The local lifecycle is `queued → generating → completed | failed`. MiniMax does not provide a music
task-history/query endpoint, so history belongs to Cadence. If the service restarts during a
synchronous provider call, that record is marked `failed/interrupted` rather than automatically
submitted again.

Common provider codes are normalized into user-facing failures:

- `1002`: rate limited
- `1004` / `2049`: invalid or rejected key
- `1008`: insufficient balance/quota
- `1026` / `1027`: sensitive input/output
- `2013`: invalid parameters
- `2056`: free resource window exhausted

## Lyrics generation

`POST /api/lyrics` proxies MiniMax's `POST /v1/lyrics_generation` without exposing the API key. The
local camel-case contract supports every provider option:

```ts
interface GenerateLyricsInput {
  mode: "write_full_song" | "edit";
  prompt?: string; // up to 2,000 characters; empty/missing requests a random song
  lyrics?: string; // up to 3,500 characters; used by edit mode
  title?: string; // preserved by MiniMax when supplied
}

interface GenerateLyricsResult {
  songTitle: string;
  styleTags: string;
  lyrics: string;
}
```

The result lyrics use MiniMax structure tags and can be copied into a normal Music 3 request.
Provider and transport failures are returned as safe `502` API errors.

## Cover generation

Cover output uses the same durable generation queue and local audio storage as Music 3. Submit a
cover to `POST /api/generations` with `music-cover` or `music-cover-free`, a 10–300 character style
prompt, the existing audio output settings, and one of these sources:

```ts
type CoverGenerationSource =
  | { type: "url"; url: string }
  | { type: "base64"; data: string }
  | { type: "feature"; featureId: string };
```

- **One step:** use a URL or base64 source. Lyrics are optional (10–1,000 characters); when omitted,
  MiniMax extracts them from the reference through ASR.
- **Two step:** first call `POST /api/covers/preprocess` with a URL or base64 source. It returns
  `coverFeatureId`, `formattedLyrics`, `structureResult`, `audioDuration`, and `traceId`. Edit the
  formatted lyrics, then submit a cover generation with the feature source and required 10–1,000
  character lyrics.

Reference audio must be 6 seconds to 6 minutes, at most 50 MB, and use a common audio format. The
preprocess provider request always uses `music-cover`, as required by MiniMax; the returned feature
ID is valid for 24 hours. `lyrics_optimizer` and `is_instrumental` are never sent for covers.

Cover sources are private durable worker inputs. They are never included in public generation JSON.
Normal detail, list, create-response, rename, delete, audio, and queued-recovery reads deliberately
do not materialize persisted base64 values; only processing one job or explicitly retrying a cover
loads its source. Retries copy the private source so queued work survives service restarts. As with
every generation, the provider call keeps `stream: false` and `output_format: "url"`, and the result
is immediately copied to local storage.

## Deletion and media delivery

`DELETE /api/generations/:id` permanently removes completed or failed generation metadata and its
stored audio, returning `204`. Queued or generating rows return `409` so a provider response cannot
race deletion and leave orphaned audio. Deleting an original clears retry lineage on its children.

Full and ranged audio responses include a sanitized UTF-8 `Content-Disposition: inline` filename
derived from the local track title while retaining byte-range playback support.
