import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const result = await build({
	absWorkingDir: fileURLToPath(root),
	entryPoints: ["src/CssTransformer.js"],
	outfile: "dist/index.js",
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	sourcemap: true,
	minify: false,
	legalComments: "inline",
	metafile: true,
});

for (const output of Object.values(result.metafile.outputs)) {
	if (output.imports.length) throw new Error("The browser bundle contains external imports");
}

const notices = [];
for (const name of ["css-tree", "source-map-js", "mdn-data"]) {
	const packageDir = dirname(require.resolve(`${name}/package.json`));
	const pkg = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
	const license = await readFile(resolve(packageDir, "LICENSE"), "utf8");
	notices.push(`${name} ${pkg.version} (${pkg.license})\n\n${license.trim()}`);
}
await writeFile(new URL("dist/THIRD-PARTY-NOTICES.txt", root), notices.join("\n\n") + "\n");
