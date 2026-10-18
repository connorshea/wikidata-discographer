<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# No third-party requests from the browser

The site runs on Toolforge, whose [terms of use](https://wikitech.wikimedia.org/wiki/Wikitech:Cloud_Services_Terms_of_use) treat a visitor's IP address and user agent as personal information and don't allow sending them to third parties. Any request the browser makes to another host sends that host the visitor's IP address, so the pages must make no requests to other hosts.

- That rules out Google Fonts, Google Analytics or any other analytics, third-party CDNs (unpkg, jsDelivr, cdnjs), embedded widgets, and remote images and avatars.
- Install fonts and libraries as packages, or put them in `public/`, so they're served from our own origin.
- The CSP in `server/app.ts` enforces this. Don't loosen it to let a third-party host in. `vp dev` doesn't send the CSP, so a third-party request can go unnoticed in development.
- Server-side requests to Wikidata, SPARQL and MusicBrainz are fine, as they don't come from the visitor's browser.
- Plain links to other sites (Wikidata, MusicBrainz) are fine too, as the browser only contacts them when the visitor follows the link.

# No accent stripes on the side of boxes

Don't mark a banner, card, callout or row with a thick colored line down one side, whether it's a `border-left`, a `border-right` or an inset `box-shadow`. Show its kind with the background, a full border or an icon instead.
