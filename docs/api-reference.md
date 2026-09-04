# API reference

`@pagedjs/css-transformer` exports `CssTransformer`, a rule-driven wrapper around `css-tree`. It parses stylesheet sources, resolves imports and URLs, and mutates the resulting AST in ordered passes.

## Import

```js
import { CssTransformer } from "@pagedjs/css-transformer";
```

Use `prepare()` to parse CSS, inspect the returned AST directly, and use `generate()` to serialize a sheet or subtree. These operations need no separate CSS Tree installation.

The package root resolves to `dist/index.js`, a browser ESM bundle with no external runtime imports. Third-party licenses ship in `dist/THIRD-PARTY-NOTICES.txt`.

## Quick start

```js
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

console.log(transformer.generate(ast));
// aside{--float:footnote;display:none}
```

## `CssTransformer`

### `new CssTransformer(options?)`

```js
const transformer = new CssTransformer({ rules });
```

`options.rules` is an array of rule objects. Each transformer instance keeps its own registry. Rules cannot be added through a public method after construction.

Rules with no `type`, or with an unsupported `type`, are ignored. `match` and `transform` are required for rules of a supported type.

### `await transformer.prepare(input)`

Parses one or more stylesheet sources and returns a combined `css-tree` stylesheet AST.

```js
const ast = await transformer.prepare(cssText);
```

The string form has no base URL. Use the array form when CSS contains relative `@import` or `url()` references:

```js
const ast = await transformer.prepare([
	{
		css: '@import "./theme.css"; main { background: url("img/paper.png"); }',
		cssBaseURL: "https://example.com/styles/book.css",
	},
	{
		css: "aside { color: navy; }",
		cssBaseURL: "https://example.com/styles/notes.css",
	},
]);
```

Each source has this shape:

| Field | Type | Description |
| --- | --- | --- |
| `css` | `string` | CSS text. Defaults to an empty string. |
| `cssBaseURL` | `string` | Base URL for relative imports and URL values. Defaults to an empty string. |

Sources are concatenated in array order. `prepare()` performs these operations per source:

1. Parse `css` with `css-tree`.
2. Recursively inline `@import` rules.
3. Resolve imported URL values against the imported stylesheet URL.
4. Resolve remaining URL values against `cssBaseURL` and run `url` rules.
5. Append the source AST children to the combined stylesheet.

Import behavior:

- String and `url()` import targets are supported.
- `layer`, `supports()`, and media conditions wrap imported rules in that order, from outermost to innermost. Wrappers reuse the imported AST nodes; only the wrapper syntax is parsed.
- `data:` imports support percent-encoded and base64 CSS.
- Duplicate, cyclic, malformed, unresolvable, and deeper-than-eight imports are removed.
- Failed fetches emit `console.warn` and remove the import.

CSS parse errors, including errors in imported stylesheets, and exceptions from `url` rule callbacks reject the returned promise.

### `transformer.apply(ast)`

Synchronously applies non-URL rules to a `css-tree` AST. It mutates and returns the same AST.

```js
const ast = await transformer.prepare("p { legacy-color: navy; }");
const result = transformer.apply(ast);

console.log(result === ast);
// true
```

`apply()` accepts an AST created by `prepare()` or directly by `css-tree`. Direct ASTs do not receive import processing, URL resolution, or `url` rules.

### `transformer.generate(ast)`

Synchronously serializes a stylesheet or subtree to CSS text without mutating nodes, parsing CSS, or running rules. `prepare()` and `apply()` return ASTs. Inspect original declarations between those phases, and pass subtrees to `generate()` when you need text.

## Processing order

Rule types run in fixed passes, regardless of their order in the constructor array:

1. During `prepare()`: `url`
2. During `apply()`: `declaration`, then `function`
3. During `apply()`: `at-rule`, then `media-query`
4. During `apply()`: `rule`, then `selector`, then `pseudo`

Rules retain registration order within their type. A pass is skipped when the transformer has no rules for any type in that pass.

The ordering has observable effects:

- Function rules see values produced by declaration rules.
- Media-query rules see at-rules that survive the at-rule rules.
- Rule, selector, and pseudo rules see style rules created from at-rules.

## Rule contract

```js
const rule = {
	type: "declaration",
	match(context) {
		return context.property === "legacy-color";
	},
	transform(context) {
		return { property: "color" };
	},
};
```

`match` and `transform` are synchronous. `transform` is called only when `match` returns a truthy value. Returning `null` or `undefined` makes no change and allows the next rule of the same type to run.

Both callbacks receive the same context object. Every context has these fields:

| Field | Description |
| --- | --- |
| `node` | Matched `css-tree` AST node. |
| `item` | Node position in its enclosing `css-tree` `List`, when available. |
| `list` | Enclosing `css-tree` `List`, when available. |

Supported in-place results update serialized context fields before the next rule of the same type. Results that replace, remove, or reparent an AST node stop that node's rule chain. URL replacements are in-place and remain visible to later URL rules.

Context AST nodes are mutable. Direct mutations are not normalized or reflected in serialized context fields unless the documented result shape performs that update.

## Declaration rules

Declaration rules match every `Declaration` node.

```js
{
	type: "declaration",
	match: ({ property }) => property === "legacy-color",
	transform: ({ value }) => ({
		property: "color",
		value: `color-mix(in srgb, ${value}, white 20%)`,
	}),
}
```

Input:

```css
p { legacy-color: navy; }
```

Output:

```css
p { color: color-mix(in srgb, navy, white 20%); }
```

Context fields:

| Field | Description |
| --- | --- |
| `property` | Declaration property name. |
| `value` | Serialized declaration value. |
| `valueAST` | Declaration value AST. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ property?: string, value?: string }` | Update non-empty fields in place. Later declaration rules see the update. |
| `{ declarations: Array<{ property, value, important? }> }` | Replace the declaration and stop its rule chain. `value` may be CSS text or a value AST. |
| `{ remove: true }` | Remove the declaration and stop its rule chain. |

## Function rules

Function rules match `Function` nodes within declaration values, including nested functions. They run after declaration rules on the value that remains.

```js
{
	type: "function",
	match: ({ name, declaration }) =>
		name === "shout" && declaration.property === "content",
	transform: ({ args }) => ({
		value: `"${args[0].toUpperCase()}"`,
	}),
}
```

Input:

```css
p { content: shout(hello); }
```

Output:

```css
p { content: "HELLO"; }
```

Context fields:

| Field | Description |
| --- | --- |
| `name` | Function name without parentheses. |
| `value` | Serialized function, including its name and parentheses. |
| `args` | Serialized arguments split only at top-level commas. |
| `declaration` | Owning `Declaration` AST node. |
| `rule` | Enclosing style `Rule` AST node, or `null` when the declaration is directly inside an at-rule block. |
| `selector` | Serialized selector list for `rule`, or `null` when there is no enclosing style rule. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ value?: string, declarations?: Array<{ property, value, important? }> }` | Replace the function when `value` is present, append companion declarations to the enclosing block, and stop its rule chain. Companion declarations are appended after the value walk, so their values are not revisited by function rules in the same pass. |
| `{ remove: true }` | Remove the function and stop its rule chain. |

## At-rule rules

At-rule rules match every `Atrule` node.

```js
{
	type: "at-rule",
	match: ({ name }) => name === "widget",
	transform: () => ({
		selector: ".widget",
		removeDeclarations: ["size"],
		prependDeclarations: [
			{ property: "page", value: "cover" },
		],
	}),
}
```

Input:

```css
@widget { size: A4; color: red; }
```

Output:

```css
.widget { page: cover; color: red; }
```

Context fields:

| Field | Description |
| --- | --- |
| `name` | At-rule name without `@`. |
| `prelude` | At-rule prelude AST, or `null`. |
| `block` | At-rule block AST, or `null`. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ selector: string }` | Convert the at-rule to a style rule and stop its at-rule chain. |
| `{ unwrap: true }` | Replace the at-rule with its block children and stop its rule chain. |
| `{ remove: true }` | Remove the at-rule and stop its rule chain. |

`{ selector }` may include these optional operations:

| Field | Type | Effect |
| --- | --- | --- |
| `removeDeclarations` | `string[]` or `Set<string>` | Remove matching direct declarations before conversion. |
| `prependDeclarations` | declaration descriptors | Insert declarations at the start of the block before conversion. |
| `splitDeclarations` | split descriptors | Move selected declarations into adjacent style rules. |

A declaration descriptor has `{ property, value, important? }`. A split descriptor has `{ selector, properties }`, where `properties` is a string array or `Set`. Operations run in this order: remove, prepend, split, convert.

```js
{
	type: "at-rule",
	match: ({ name }) => name === "region",
	transform: () => ({
		selector: ".region",
		splitDeclarations: [
			{
				selector: ".region::before",
				properties: ["content"],
			},
		],
	}),
}
```

Input:

```css
@region { content: "Title"; color: navy; }
```

Output:

```css
.region { color: navy; }
.region::before { content: "Title"; }
```

## Media-query rules

Media-query rules match each `MediaQuery` in an at-rule prelude.

```js
{
	type: "media-query",
	match: ({ mediaType }) => mediaType === "screen",
	transform: () => ({ query: "print" }),
}
```

Input:

```css
@media screen { p { color: navy; } }
```

Output:

```css
@media print { p { color: navy; } }
```

Context fields:

| Field | Description |
| --- | --- |
| `name` | Owning at-rule name. |
| `modifier` | Media-query modifier AST field. |
| `mediaType` | Media type AST field. |
| `condition` | Serialized condition, or `null`. |
| `query` | Serialized complete media query. |
| `atrule` | Owning `Atrule` AST node. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ query: string }` | Replace the current query with a parsed media-query list and stop its rule chain. One query may expand into several. |
| `{ unwrap: true }` | Replace the owning at-rule with its block children and stop processing its query list. |
| `{ remove: true }` | Remove the current query. The owning at-rule is removed when no queries remain. |

## Rule rules

Rule rules match every style `Rule` node. They run after at-rule conversion.

```js
{
	type: "rule",
	match: ({ selector }) => selector === ".legacy",
	transform: () => ({ selector: ".component" }),
}
```

Input:

```css
.legacy { color: navy; }
```

Output:

```css
.component { color: navy; }
```

Context fields:

| Field | Description |
| --- | --- |
| `selector` | Serialized selector list. |
| `block` | Rule block AST. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ selector: string }` | Replace the selector list in place. Later rule rules see the update. |
| `{ remove: true }` | Remove the style rule and stop its rule chain. |

## Selector rules

Selector rules match each individual `Selector` in a style rule's selector list. Selectors nested in functional pseudo-classes such as `:is()` and `:not()` are also visited.

```js
{
	type: "selector",
	match: ({ selector }) => selector === ".legacy",
	transform: () => ({ remove: true }),
}
```

Input:

```css
.legacy, .current { color: navy; }
```

Output:

```css
.current { color: navy; }
```

Context fields:

| Field | Description |
| --- | --- |
| `selector` | Serialized individual selector. |
| `rule` | Owning style `Rule` AST node. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ selector: string }` | Replace the selector in place. Later selector rules see the update. |
| `{ remove: true }` | Remove the selector and stop its rule chain. The style rule is removed when no selectors remain. |

## Pseudo rules

Pseudo rules match each pseudo-class and pseudo-element part within a selector, including selectors nested in functional pseudo-classes.

```js
{
	type: "pseudo",
	match: ({ kind, name }) => kind === "class" && name === "nth-page",
	transform: ({ args }) => ({
		selector: `:nth-of-type(${args[0]})`,
	}),
}
```

Input:

```css
paged-page:nth-page(2n) { color: navy; }
```

Output:

```css
paged-page:nth-of-type(2n) { color: navy; }
```

Context fields:

| Field | Description |
| --- | --- |
| `name` | Pseudo name without `:` or `::`. |
| `kind` | `"class"` or `"element"`. |
| `args` | Serialized arguments split at top-level commas, or `null` for a non-functional pseudo. |
| `selector` | Serialized containing selector. |
| `rule` | Owning style `Rule` AST node. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ selector: string }` | Replace the pseudo with a parsed selector fragment and stop its rule chain. |
| `{ remove: true }` | Remove the pseudo and stop its rule chain. |

## URL rules

URL rules match `Url` nodes during `prepare()`. Relative values are resolved against the source's `cssBaseURL` before matching. Without a base URL, relative values remain relative.

```js
const transformer = new CssTransformer({
	rules: [
		{
			type: "url",
			match: ({ url }) => url.endsWith(".png"),
			transform: ({ url }) => ({ url: `${url}?v=1` }),
		},
	],
});

const ast = await transformer.prepare([
	{
		css: 'p { background: url("img/paper.png"); }',
		cssBaseURL: "https://example.com/styles/book.css",
	},
]);

console.log(transformer.generate(ast));
// p{background:url(https://example.com/styles/img/paper.png?v=1)}
```

Context fields:

| Field | Description |
| --- | --- |
| `url` | Serialized URL value after base URL resolution when possible. |
| `baseURL` | `cssBaseURL` for the source being prepared. |

Transform results:

| Result | Effect |
| --- | --- |
| `{ url: string }` | Replace the URL value. Later URL rules see the replacement. |

## Errors and mutation

- Errors from `css-tree` while parsing input CSS or replacement fragments propagate to the caller.
- Exceptions from `match` or `transform` propagate to the caller.
- `prepare()` is asynchronous because imports may use `fetch`; rule callbacks remain synchronous.
- `apply()` mutates the supplied AST. Clone it before applying rules when the original must be preserved.
