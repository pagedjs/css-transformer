# @pagedjs/css-transformer

Rule-driven CSS AST transformations built on [`css-tree`](https://github.com/csstree/csstree). The transformer parses one or more stylesheets, resolves imports and URLs against per-source base URLs, and applies transformation rules in fixed passes.

## Usage

```js
import { CssTransformer } from "@pagedjs/css-transformer";
import * as csstree from "css-tree";

const transformer = new CssTransformer({
	rules: [
		{
			type: "declaration",
			match: ({ property }) => property === "float",
			transform: ({ value }) => ({
				declarations: [
					{ property: "--float", value },
					{ property: "display", value: "none" },
				],
			}),
		},
	],
});

const ast = await transformer.prepare("aside { float: footnote; }");
transformer.apply(ast);

console.log(csstree.generate(ast));
```

`prepare()` accepts CSS text or an array of `{ css, cssBaseURL }` entries and returns a `css-tree` AST. `cssBaseURL` resolves relative `@import` and `url()` references; supply it for sources that contain either. `apply()` mutates and returns the AST.

Rules have the shape `{ type, match, transform }`. URL rules run during `prepare()`; `apply()` then runs `declaration`/`function`, `at-rule`/`media-query`, and `rule`/`selector`/`pseudo` passes. Rules retain registration order within each type. See the [API reference](./docs/api-reference.md) for every context, result shape, and rule type.

## Development

```bash
npm install
npm run check
```

The package targets browsers and Node.js 18+ with `URL`, `fetch`, and `atob` globals.
