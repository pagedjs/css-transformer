import * as csstree from "css-tree";
import {
	itemsOf,
	parseSelectorParts,
	replaceItem,
	splitArguments,
} from "./helpers.js";

const PSEUDO_KINDS = {
	PseudoElementSelector: "element",
	PseudoClassSelector: "class",
};

/** Runs rule, selector, then pseudo rules in one `Rule` traversal. */
export function transformRules(ast, rules = {}) {
	const ruleRules = rules.rule ?? [];
	const selectorRules = rules.selector ?? [];
	const pseudoRules = rules.pseudo ?? [];
	if (!ruleRules.length && !selectorRules.length && !pseudoRules.length) {
		return ast;
	}

	csstree.walk(ast, {
		visit: "Rule",
		enter(node, item, list) {
			if (applyRuleRules(node, item, list, ruleRules)) return;

			if (!selectorRules.length && !pseudoRules.length) return;
			if (node.prelude?.type !== "SelectorList") return;

			csstree.walk(node.prelude, {
				visit: "Selector",
				enter(selector, selectorItem, selectorList) {
					const dropped = applySelectorRules(
						selector,
						selectorItem,
						selectorList,
						selectorRules,
						node,
					);
					if (!dropped) applyPseudoRules(selector, pseudoRules, node);
				},
			});

			if (node.prelude.children.isEmpty && item && list) list.remove(item);
		},
	});

	return ast;
}

function applyRuleRules(node, item, list, rules) {
	if (!rules.length) return false;

	const ctx = {
		selector: node.prelude ? csstree.generate(node.prelude) : "",
		block: node.block,
		node,
		item,
		list,
	};

	for (const rule of rules) {
		if (!rule.match(ctx)) continue;

		const result = rule.transform(ctx);
		if (!result) continue;

		if (result.remove) {
			if (!item || !list) continue;
			list.remove(item);
			return true;
		}
		if (result.selector != null && result.selector !== ctx.selector) {
			node.prelude = csstree.parse(result.selector, {
				context: "selectorList",
			});
			ctx.selector = csstree.generate(node.prelude);
		}
	}

	return false;
}

function applySelectorRules(selector, item, list, rules, rule) {
	if (!rules.length) return false;

	const ctx = {
		selector: csstree.generate(selector),
		node: selector,
		item,
		list,
		rule,
	};

	for (const selectorRule of rules) {
		if (!selectorRule.match(ctx)) continue;

		const result = selectorRule.transform(ctx);
		if (!result) continue;

		if (result.remove) {
			if (!item || !list) continue;
			list.remove(item);
			return true;
		}
		if (result.selector != null && result.selector !== ctx.selector) {
			selector.children = csstree.parse(result.selector, {
				context: "selector",
			}).children;
			ctx.selector = csstree.generate(selector);
		}
	}

	return false;
}

function applyPseudoRules(selector, rules, rule) {
	if (!rules.length) return;

	for (const item of itemsOf(selector.children)) {
		const node = item.data;
		const kind = PSEUDO_KINDS[node.type];
		if (!kind) continue;

		const ctx = {
			name: node.name,
			kind,
			args: node.children ? splitArguments(node) : null,
			selector: csstree.generate(selector),
			node,
			item,
			list: selector.children,
			rule,
		};

		for (const pseudoRule of rules) {
			if (!pseudoRule.match(ctx)) continue;

			const result = pseudoRule.transform(ctx);
			if (!result) continue;

			if (result.remove) {
				selector.children.remove(item);
				break;
			}
			if (result.selector != null) {
				replaceItem(
					selector.children,
					item,
					parseSelectorParts(result.selector),
				);
				break;
			}
		}
	}
}
