#!/usr/bin/env node
// Runs automatically before "npm pack" / "npm publish" (npm's prepack
// lifecycle hook). This package's own directory has no README or LICENSE
// of its own; the ones that matter live at the repo root, so copy fresh
// copies in right before packing rather than keeping a second copy that
// could drift out of sync. Gitignored: these are generated, not source.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

copyFileSync(path.join(ROOT, "README.md"), path.join(HERE, "README.md"));
copyFileSync(path.join(ROOT, "LICENSE"), path.join(HERE, "LICENSE"));
console.log("[prepack] copied README.md and LICENSE from the repo root");
