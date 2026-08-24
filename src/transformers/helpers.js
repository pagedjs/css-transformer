import * as csstree from "css-tree";

/**
 * Snapshot a `List`'s items so a caller can splice while iterating.
 * @param {import("css-tree").List | undefined} list
 * @returns {Array<Object>}
 */
export function itemsOf(list) {
	const items = [];
	list?.forEach((data, item) => items.push(item));
	return items;
}

/**
 * Inserts replacements before `item` so the current traversal does not revisit
 * them.
 */
export function replaceItem(list, item, nodes) {
	for (const node of nodes) {
		list.insert(list.createItem(node), item);
	}
	list.remove(item);
}

/**
 * Inserts unwrapped children after `item` so the current traversal visits them.
 */
export function unwrapAtrule(node, item, list) {
	let after = item;
	for (const child of itemsOf(node.block?.children)) {
		node.block.children.remove(child);
		list.insert(child, after.next);
		after = child;
	}
	list.remove(item);
}

export function parseSelectorParts(text) {
	return csstree.parse(text, { context: "selector" }).children.toArray();
}

export function parseValueParts(text) {
	return csstree.parse(text, { context: "value" }).children.toArray();
}

export function buildDeclaration({ property, value, important = false }) {
	return {
		type: "Declaration",
		important,
		property,
		value:
			typeof value === "string"
				? csstree.parse(value, { context: "value" })
				: value,
	};
}

/** Serializes arguments and splits only at top-level commas. */
export function splitArguments(node) {
	const args = [];
	let group = [];
	const flush = () => args.push(generateGroup(group));

	node.children?.forEach((child) => {
		if (child.type === "Operator" && child.value === ",") {
			flush();
			group = [];
			return;
		}
		group.push(child);
	});
	if (group.length || args.length) flush();

	return args;
}

function generateGroup(nodes) {
	if (!nodes.length) return "";
	return csstree
		.generate({ type: "Value", children: new csstree.List().fromArray(nodes) })
		.trim();
}

export function removeDeclarations(block, properties) {
	if (!block?.children) return;
	const names = properties instanceof Set ? properties : new Set(properties);
	for (const item of itemsOf(block.children)) {
		const child = item.data;
		if (child.type === "Declaration" && names.has(child.property)) {
			block.children.remove(item);
		}
	}
}

export function prependDeclarations(block, declarations) {
	if (!block?.children) return;
	for (const decl of [...declarations].reverse()) {
		block.children.prepend(block.children.createItem(buildDeclaration(decl)));
	}
}
