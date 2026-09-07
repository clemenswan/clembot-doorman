/**
 * The isomorphic surface: everything the laptop runner shares with the Worker.
 *
 * The runner imports the BUILT version of this file (runner/lib.mjs, produced
 * by `npm run build:shared`). That is deliberate. If the runner reimplemented
 * grade math in JavaScript, the two would drift and a laptop-produced grade
 * would stop meaning the same thing as a Worker-produced one.
 *
 * Nothing exported here may touch a platform API. src/ is typechecked against
 * Workers types only, which enforces it at build time.
 */

export * from './grade/types.js';
export * from './grade/grade.js';
export * from './grade/mcpscore.js';
export * from './probes/types.js';
export * from './probes/index.js';
export * from './probes/guidance.js';
export * from './outputs/report.js';
export * from './outputs/recipe.js';
export * from './outputs/badge.js';
export * from './outputs/evidence.js';
