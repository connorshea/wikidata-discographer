# Wikidata Discographer

Turns an album's tracklist into Wikidata items, following the
[WikiProject Music](https://www.wikidata.org/wiki/Wikidata:WikiProject_Music) model:

```
album —P658 tracklist→ track —P2550 recording or performance of→ composition
single —P658 tracklist→ track, single —P13602 single taken from→ album
```

Paste a tracklist per disc, map the artist names to QIDs, and the app creates
the album (or reuses an existing one), a composition and a track for each song,
and any singles, all linked together. The edits are made directly with the
logged-in user's account through OAuth. There is no QuickStatements step. Each
run is one [EditGroup](https://editgroups.toolforge.org/), so the whole run can
be reviewed or undone in one place.

## Toolchain

React 19 + TypeScript 7 SPA on the [Vite+](https://viteplus.dev) toolchain (the
`vp` CLI), a [Hono](https://hono.dev) (Node 24) API server, and
[Drizzle](https://orm.drizzle.team) on **MariaDB**. Managed with pnpm and built
to run on [Wikimedia Toolforge](https://wikitech.wikimedia.org/wiki/Help:Toolforge).

## Development

Needs a local MariaDB. On macOS:

```sh
brew install mariadb && brew services start mariadb
mariadb -e "CREATE DATABASE discographer CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
  CREATE USER 'discographer'@'localhost' IDENTIFIED BY 'discographer';
  GRANT ALL ON discographer.* TO 'discographer'@'localhost';"
```

Use the `utf8mb4_bin` collation, so external IDs compare exactly. Label search
lowercases both sides itself.

```sh
cp .env.example .env   # local DB defaults match the setup above
pnpm install
pnpm db:migrate        # apply migrations
pnpm dev               # Vite on :5173 (proxying /api) + the Hono server on :8000
```

Without the `OAUTH_*` variables the form, preview and duplicate checks all work,
but nobody can log in to make edits.

## Commands

```sh
pnpm build              # build the SPA to dist/client
pnpm start              # production server (API + dist/client)
pnpm db:generate        # generate a migration from db/schema.ts
pnpm db:migrate         # apply pending migrations
pnpm job:import-dump    # refresh the music mirror from the Wikidata JSON dump
pnpm job:prune-sessions # delete expired login sessions

vp check                # format, lint and type-check
vp test                 # run the tests
```

## How a run works

1. The browser builds the plan (`src/lib/plan.ts`) on every keystroke for the
   errors and the edit preview.
2. **Create on Wikidata** posts the form state. The server rebuilds the plan
   from it, so it only makes edits it built itself, records a `submissions` row
   and runs the plan in the background. Each user can have one run at a time,
   of at most 50 tracks per disc and 100 tracks in all.
3. Operations run in order, using `wbeditentity`. Items created earlier in the
   run (`album`, `comp:0:3`, `track:0:3`, `single:0:3`) are swapped for their
   new QIDs as the run goes. Adding statements to an existing item skips the
   ones it already has, so a run that stopped part-way can be started again.
4. Every edit is logged in `wikidata_edits` and shown on the page as it happens.
   At the end, the created QIDs are written back into the form, so a second
   run reuses them instead of creating duplicates.

Edits carry `assert=user`, and retry on `badtoken` and rate limits. They don't
send `maxlag`: a run is started by hand, like an edit in the Wikidata UI. The
edit summary ends with an EditGroups link
(`[[:toolforge:editgroups/b/CB/<id>|details]]`). Point `WIKIDATA_API_URL` at
Test Wikidata while developing.

## The music mirror

`music_items` and `music_external_ids` hold every Wikidata item that is an
album, EP, single, song, musical work, track or music group, or that has an
artist identifier (MusicBrainz, Discogs, Spotify, Apple Music, …). For each one
they store its `instance of`, label, description and music identifiers.
`music_links` holds the item-valued statements that tie them together:
performer, composer and lyricist (P175, P86, P676), recording or performance of
(P2550), published in and part of (P1433, P361), and tracklist (P658), for
everything but artists: about a million rows. The lists are in
`src/lib/music.ts`. The mirror is used to:

- block creating an album whose Spotify, MusicBrainz or Apple Music ID is
  already on Wikidata, and warn about albums with the same title
- suggest QIDs for the performers
- suggest existing compositions, tracks and singles for each tracklist row
  (`server/matches.ts`): items with the row's title (ignoring case and curly
  quotes) that share one of its performers, or that are on the existing album.
  A suggested track brings the composition it records (P2550) and its singles,
  so reusing it doesn't give it a second composition. "Fill in unambiguous
  matches" fills every empty field that has exactly one suggestion.

Items a run creates, and existing items it adds statements to, are written to
the mirror straight away. Anything else created since the last dump can be
added by QID under the Performers section.

`jobs/import-dump.ts` refreshes the mirror weekly by streaming
`latest-all.json.gz`. Each row stores the revision it was built from (`revid`),
and every dump line starts with its id and ends with its `lastrevid`, so an
item the mirror already has at that revision is skipped without being parsed
or written. Most weeks only the music items edited since the last dump are
written. Of the rest, a cheap text check skips most lines before parsing.
After a complete pass, it deletes mirrored items it didn't see, but never more
than 20% of the mirror unless `DUMP_PRUNE_FORCE=1`.

When what the mirror extracts changes (a new column, a class added or removed
in `src/lib/music.ts`), bump `MIRROR_VERSION` in `server/mirror.ts`. Rows
from an older version aren't skipped, so the next import rewrites them all. Locally, point
`WIKIDATA_JSON_DUMP` at any dump-format `.json.gz`, and use `DUMP_LIMIT=2000`
for a quick test.

## Authentication

Login uses **Wikimedia OAuth 2.0** (authorization code + PKCE, confidential
client).

1. Register a consumer at
   [Special:OAuthConsumerRegistration/propose/oauth2](https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2):
   - OAuth 2.0, not owner-only.
   - Callback URL exactly `<BASE_URL>/api/auth/callback`.
   - Projects `wikidatawiki`, plus `testwikidatawiki` for development.
   - Grants "Basic rights", "Edit existing pages" and "Create, edit, and move
     pages".

   Consumers with edit grants are approved by hand. An owner-only consumer
   works for its owner in the meantime.

2. Set the authentication variables from `.env.example`: in `.env` locally, or
   with `toolforge envvars create` on Toolforge.

Session cookies are `HttpOnly; SameSite=Lax`, and the database stores only
their hash. OAuth tokens are encrypted with `TOKEN_ENC_KEY`. Requests that
change state must be same-origin.

## Deploying to Toolforge

The tool is `wikidata-discographer`, served at
<https://wikidata-discographer.toolforge.org> (so `BASE_URL` is that, and the
OAuth callback is `https://wikidata-discographer.toolforge.org/api/auth/callback`).
Run these as the tool (`become wikidata-discographer`).

Create the ToolsDB database with `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
and set the `DB_*`, `OAUTH_*`, `BASE_URL`, `SESSION_SECRET`, `TOKEN_ENC_KEY` and
`USER_AGENT` envvars. Then build, migrate and start:

```sh
toolforge build start https://github.com/connorshea/wikidata-discographer
toolforge jobs run migrate --image tool-wikidata-discographer/tool-wikidata-discographer:latest \
  --command "node scripts/migrate.ts" --wait
toolforge webservice buildservice start --mount none
```

The server refuses to start while migrations are pending (`server/preflight.ts`).

Load the mirror once by hand. The dump is visible only with `--mount all`:

```sh
toolforge jobs run import-dump --image tool-wikidata-discographer/tool-wikidata-discographer:latest \
  --command "node --max-old-space-size=384 jobs/import-dump.ts" \
  --mount all --mem 1Gi --cpu 2 --emails onfailure
```

Then load the weekly schedule. Rerun this whenever `jobs.yaml` changes, but not
while `import-dump` is running:

```sh
curl -fsSL https://raw.githubusercontent.com/connorshea/wikidata-discographer/main/jobs.yaml \
  -o ~/jobs.yaml && toolforge jobs load ~/jobs.yaml
```

Job and Procfile commands call `node` directly, because the launch image has
npm but not pnpm.

### Redeploying

The Build Service clones the repo itself, so there is no checkout on the
bastion to `git pull`. Each build takes the latest `main` (pass `--ref <branch>`
for another). Watch it with `toolforge build show`. A running web service and
the scheduled jobs keep the old image until they restart:

```sh
toolforge build start https://github.com/connorshea/wikidata-discographer
# only if the build adds a migration, and before the restart:
toolforge jobs run migrate --image tool-wikidata-discographer/tool-wikidata-discographer:latest \
  --command "node scripts/migrate.ts" --wait
toolforge webservice restart
```

Run the migration first. The new code may query tables or columns that only
exist after it. Scheduled jobs pick up the new image on their next run. A
running `import-dump` keeps the old one until it finishes.

## License

[MIT](LICENSE)
