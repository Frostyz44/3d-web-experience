# Avatar world (Frostyz44/3d-web-experience)

A fork of [mml-io/3d-web-experience](https://github.com/mml-io/3d-web-experience): a multiplayer 3D avatar world that
showcases the user's MML fork (Frostyz44/mml-test). It is public at https://world.oswiki.xyz, with the fork's
documentation at https://world.oswiki.xyz/docs/.

## Using the MML fork

The world runs the fork's builds, copied over the published `@mml-io` packages:

```bash
# with the fork cloned next to this repo as ../upstream-mml and built (npm install && npm run build there)
npm install
node scripts/use-mml-fork.mjs
npm run build -- --force   # --force: turbo does not notice changes inside node_modules
```

Run it locally: `PORT=8080 NODE_ENV=production node build/index.js` in `example/multi-user-3d-web-experience/server`.
Spawn anywhere with a URL hash: `#charX,charY,charZ,qx,qy,qz,qw,camX,camY,camZ,qx,qy,qz,qw`.

## The world's content

- MML documents live in `example/multi-user-3d-web-experience/server/mml-documents/` and reload live when saved.
  Their positions in the world are set in `server/src/index.ts` (changing those needs a rebuild and restart).
- `hub.html` is the spawn plaza at the origin (its coordinates are world coordinates) with gates and paths to every
  area. A new area needs a free spot, an entry in `index.ts`, and a gate or path in the hub.
- Use `m-text` (3D text) for titles, buttons and labels, not flat `m-label` panels.
- `physics.html` is generated from the fork (`packages/mml-physics/demo/physics.html`, see the fork's CLAUDE.md);
  change the template there and copy the built file here.
- Check changes in the running world, for example with headless Chrome (puppeteer with
  `--use-angle=swiftshader --enable-unsafe-swiftshader`) and a screenshot.

## Rule: documentation

New MML features belong in the fork, and the fork's rule applies: every feature change updates the documentation
site (`docs-site/` in Frostyz44/mml-test) in the same change. When an area here shows off a new feature, make sure
the fork's documentation covers that feature too.

## Working in this repository

- Node 22 or newer. Before pushing: `npm run build`, `npm run test-all` and `npx turbo run lint`. The bridge
  integration test can time out on Windows; it is unrelated to world content.
- Line endings: the user's Windows checkout uses CRLF; preserve them when editing files with scripts.
- Cloud sessions work on their own branch and do not merge into `main` or deploy.
