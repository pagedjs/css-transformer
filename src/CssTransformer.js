import * as csstree from "css-tree";
import { transformValues } from "./transformers/transformValues.js";
import { transformAtRules } from "./transformers/transformAtRules.js";
import { transformRules } from "./transformers/transformRules.js";
import { transformUrls } from "./transformers/transformUrls.js";
import { inlineImports } from "./utils/inlineImports.js";

/**
 * `apply()` groups rule types into three ordered AST traversals. URL rules run
 * in `prepare()` so resolution uses each source's base URL.
 */
const PASSES = [
	{ types: ["declaration", "function"], apply: transformValues },
	{ types: ["at-rule", "media-query"], apply: transformAtRules },
	{ types: ["rule", "selector", "pseudo"], apply: transformRules },
];

/**
 * Rewrites `css-tree` ASTs with `{ type, match, transform }` rules.
 *
 * `match` and `transform` receive the same context object. Every context has
 * `node`, `item`, and `list`; the remaining fields depend on `type`. Unknown
 * types are ignored.
 *
 * | type          | matches                          | ctx adds                                          | `transform` may return                                                                |
 * | ------------- | -------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
 * | `declaration` | every `Declaration`              | `property`, `value`, `valueAST`                    | `{ property?, value? }`, `{ declarations: [{ property, value, important? }] }`, `{ remove }` |
 * | `function`    | every `Function` in a value      | `name`, `value`, `args`, `declaration`, `rule`, `selector` | `{ value, declarations? }`, `{ remove }`                                             |
 * | `at-rule`     | every `Atrule`                   | `name`, `prelude`, `block`                         | `{ selector, removeDeclarations?, prependDeclarations?, splitDeclarations? }`, `{ unwrap }`, `{ remove }`   |
 * | `media-query` | every `MediaQuery` in a prelude  | `name`, `modifier`, `mediaType`, `condition`, `query`, `atrule` | `{ query }`, `{ unwrap }`, `{ remove }`                                    |
 * | `rule`        | every `Rule`                     | `selector`, `block`                                | `{ selector }`, `{ remove }`                                                            |
 * | `selector`    | every `Selector`, nested too     | `selector`, `rule`                                 | `{ selector }`, `{ remove }`                                                            |
 * | `pseudo`      | every `::element` / `:class` part | `name`, `kind`, `args`, `selector`, `rule`        | `{ selector }`, `{ remove }`                                                            |
 * | `url`         | every `Url` during `prepare()`   | `url`, `baseURL`                                   | `{ url }`                                                                               |
 *
 * In-place edits update the context for later rules of the same type.
 * Node replacement, removal, or reparenting stops the rule chain for that node.
 */
export class CssTransformer {
	#rulesByType = new Map();

	/**
	 * @param {Object} [options]
	 * @param {Array<{ type: string, match: Function, transform: Function }>} [options.rules]
	 */
	constructor({ rules = [] } = {}) {
		for (const rule of rules) {
			if (!rule?.type) continue;
			const forType = this.#rulesByType.get(rule.type);
			if (forType) {
				forType.push(rule);
			} else {
				this.#rulesByType.set(rule.type, [rule]);
			}
		}
	}

	/**
	 * Parses and combines stylesheet sources.
	 *
	 * @param {string | Array<{ css: string, cssBaseURL?: string }>} input
	 *   CSS text or sources to concatenate. `cssBaseURL` resolves imports and URLs.
	 * @returns {Promise<import("css-tree").CssNode>} Combined AST ready for `apply()`.
	 */
	async prepare(input) {
		const entries = typeof input === "string" ? [{ css: input }] : input;
		const urlRules = this.#rulesByType.get("url") ?? [];
		const combined = csstree.parse("");
		for (const { css = "", cssBaseURL = "" } of entries) {
			const ast = csstree.parse(css);
			await inlineImports(ast, cssBaseURL);
			transformUrls(ast, urlRules, { baseURL: cssBaseURL });
			ast.children.forEach((c) => {
				combined.children.append(combined.children.createItem(c));
			});
		}
		return combined;
	}

	/**
	 * @param {import("css-tree").CssNode} ast
	 * @returns {import("css-tree").CssNode} The mutated AST.
	 */
	apply(ast) {
		for (const pass of PASSES) {
			const rules = {};
			let active = false;
			for (const type of pass.types) {
				const forType = this.#rulesByType.get(type);
				if (forType) {
					rules[type] = forType;
					active = true;
				}
			}
			if (active) pass.apply(ast, rules);
		}
		return ast;
	}

	/**
	 * Serialize an AST without applying rules or modifying its nodes.
	 *
	 * @param {import("css-tree").CssNode} ast The AST to serialize.
	 * @returns {string} Generated CSS text.
	 */
	generate(ast) {
		return csstree.generate(ast);
	}
}
