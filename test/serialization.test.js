import { describe, it, expect, vi, afterEach } from "vitest";
import * as csstree from "css-tree";
import { CssTransformer } from "../src/CssTransformer.js";

vi.mock("css-tree", async (importOriginal) => {
	const original = await importOriginal();
	return { ...original, parse: vi.fn(original.parse) };
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("generate", () => {
	it("serializes prepared nodes without running rules or mutating the AST", async () => {
		const transform = vi.fn(() => ({ value: "blue" }));
		const transformer = new CssTransformer({ rules: [{ type: "declaration", match: () => true, transform }] });
		const ast = await transformer.prepare("p { color: red }");
		const before = csstree.toPlainObject(csstree.clone(ast));
		const rule = ast.children.first;
		expect(transformer.generate(ast)).toBe("p{color:red}");
		expect(transformer.generate(rule.block.children.first.value)).toBe("red");
		expect(transform).not.toHaveBeenCalled();
		expect(csstree.toPlainObject(csstree.clone(ast))).toEqual(before);
		expect(ast.children.first).toBe(rule);
	});

	it("serializes transformed nodes repeatedly without running rules again", async () => {
		const transform = vi.fn(() => ({ value: "blue" }));
		const transformer = new CssTransformer({ rules: [{ type: "declaration", match: () => true, transform }] });
		const prepared = await transformer.prepare("p { color: red }");
		const ast = transformer.apply(prepared);
		const before = csstree.toPlainObject(csstree.clone(ast));
		const rule = ast.children.first;
		expect(ast).toBe(prepared);
		expect(transformer.generate(ast)).toBe("p{color:blue}");
		expect(transformer.generate(ast)).toBe("p{color:blue}");
		expect(transform).toHaveBeenCalledTimes(1);
		expect(csstree.toPlainObject(csstree.clone(ast))).toEqual(before);
		expect(ast.children.first).toBe(rule);
	});

	it("serializes an empty sheet", async () => {
		const transformer = new CssTransformer();
		expect(transformer.generate(await transformer.prepare(""))).toBe("");
	});
});

describe("import wrappers", () => {
	it("reuses parsed children under layer, supports, and media wrappers", async () => {
		const css = "p{background:url(\"img/paper.png\")} @page{size:A4}";
		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => css })));
		const transformer = new CssTransformer();
		const ast = await transformer.prepare([{
			css: "@import \"chapter.css\" layer(book) supports(display:grid) print; h1{color:red}",
			cssBaseURL: "https://example.com/css/main.css",
		}]);
		const calls = csstree.parse.mock.calls;
		const index = calls.findIndex(([text]) => text === css);
		const imported = csstree.parse.mock.results[index].value;
		const layer = ast.children.first;
		const supports = layer.block.children.first;
		const media = supports.block.children.first;
		expect([layer.name, supports.name, media.name]).toEqual(["layer", "supports", "media"]);
		expect(media.block.children).toBe(imported.children);
		expect(media.block.children.first).toBe(imported.children.first);
		expect(calls.filter(([text]) => text === css)).toHaveLength(1);
		expect(calls.filter(([text]) => text.includes("paper.png"))).toHaveLength(1);
		expect(transformer.generate(ast)).toBe("@layer book{@supports (display:grid){@media print{p{background:url(https://example.com/css/img/paper.png)}@page{size:A4}}}}h1{color:red}");
	});

	it("preserves anonymous layers, nested imports, order, and imported URL bases", async () => {
		const sources = {
			"https://example.com/a.css": "@import \"nested/b.css\"; a{color:red}",
			"https://example.com/nested/b.css": "b{background:url(image.png)}",
		};
		vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, text: async () => sources[url] })));
		const transformer = new CssTransformer();
		const ast = await transformer.prepare([{ css: "@import \"a.css\" layer;", cssBaseURL: "https://example.com/main.css" }]);
		expect(transformer.generate(ast)).toBe("@layer{b{background:url(https://example.com/nested/image.png)}a{color:red}}");
	});

	it("retains cycle, duplicate, and fetch-error removal", async () => {
		const fetch = vi.fn(async (url) => ({ ok: !url.endsWith("missing.css"), status: 404, text: async () => "@import \"a.css\";a{color:red}" }));
		vi.stubGlobal("fetch", fetch);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const transformer = new CssTransformer();
		const ast = await transformer.prepare([{ css: "@import \"a.css\"; @import \"a.css\"; @import \"missing.css\";", cssBaseURL: "https://example.com/main.css" }]);
		expect(transformer.generate(ast)).toBe("a{color:red}");
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});
});
