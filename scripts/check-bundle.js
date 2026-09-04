import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CssTransformer } from "@pagedjs/css-transformer";

const transformer = new CssTransformer({ rules: [{
	type: "declaration",
	match: ({ property }) => property === "color",
	transform: () => ({ property: "--ink" }),
}] });
const ast = await transformer.prepare("p { color: red }");
const first = ast.children.first;
assert.equal(transformer.generate(ast), "p{color:red}");
assert.equal(transformer.apply(ast), ast);
assert.equal(transformer.generate(ast), "p{--ink:red}");
assert.equal(ast.children.first, first);
assert.equal(transformer.generate(await transformer.prepare("")), "");
const notices = await readFile(new URL("../dist/THIRD-PARTY-NOTICES.txt", import.meta.url), "utf8");
for (const name of ["css-tree", "source-map-js", "mdn-data"]) assert.ok(notices.includes(name));
