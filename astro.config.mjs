// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import expressiveCode, { ExpressiveCodeTheme } from "astro-expressive-code";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { parse as parseYaml } from "yaml";
import { glossarySchema } from "./src/schemas/glossary.ts";

/**
 * @typedef {import("hast").Element} HastElement
 * @typedef {import("hast").RootContent} HastContent
 * @typedef {import("hast").RootContent} HastNode
 * @typedef {import("hast").Parent} HastParent
 * @typedef {import("hast").Root} HastRoot
 */

const codeFontStack = '"JetBrains Mono", monospace';
const site = "https://talkinghead.blog.br";

/**
 * @param {HastNode | null | undefined} node
 */
function hasGifEmojiMarker(node) {
  return node?.type === "element" &&
    node["tagName"] === "img" &&
    typeof node["properties"]?.["alt"] === "string" &&
    node["properties"]["alt"].startsWith("gif:");
}

/**
 * @param {HastNode | null | undefined} node
 */
function isGifEmoji(node) {
  if (hasGifEmojiMarker(node)) return true;
  if (node?.type !== "element") return false;

  const className = node["properties"]["className"];
  return Array.isArray(className)
    ? className.includes("gif-emoji")
    : className === "gif-emoji";
}

/**
 * @param {HastContent} node
 */
function prepareGifEmoji(node) {
  if (node.type !== "element" || !hasGifEmojiMarker(node)) return;

  const alt = node["properties"]["alt"];
  if (typeof alt !== "string") return;

  const className = node["properties"]["className"];
  const classes = Array.isArray(className)
    ? className
    : typeof className === "string" || typeof className === "number"
      ? [className]
      : [];
  node["properties"]["className"] = [...classes, "gif-emoji"];
  node["properties"]["alt"] = alt.slice("gif:".length).trim();
}

/**
 * @param {HastNode | null | undefined} node
 */
function isWhitespaceText(node) {
  return node?.type === "text" && !node.value.trim();
}

/**
 * @param {HastNode | null | undefined} node
 * @returns {{mediaNode: HastElement, caption: string} | null}
 */
function getCaptionedImage(node) {
  if (node?.type !== "element" || node.tagName !== "p") return null;

  const children = node.children.filter((child) => !isWhitespaceText(child));
  if (children.length !== 1) return null;

  const child = children[0];
  if (child?.type === "element" && child.tagName === "img" && child["properties"]["alt"] && !isGifEmoji(child)) {
    return { mediaNode: child, caption: String(child["properties"]["alt"]) };
  }

  if (
    child?.type === "element" &&
    child.tagName === "a" &&
    child.children.length === 1
  ) {
    const image = child.children[0];
    if (image?.type === "element" && image.tagName === "img" && image["properties"]["alt"] && !isGifEmoji(image)) {
      return { mediaNode: child, caption: String(image["properties"]["alt"]) };
    }
  }

  return null;
}

/**
 * @param {HastContent} node
 * @param {HastParent} parent
 */
function visit(node, parent) {
  prepareGifEmoji(node);

  if (node.type === "element") {
    for (const child of node.children) {
      visit(child, node);
    }
  }

  const image = getCaptionedImage(node);
  if (!image) return;

  const index = parent.children.indexOf(node);
  if (index === -1) return;

  /** @type {HastElement} */
  const figure = {
    type: "element",
    tagName: "figure",
    properties: {},
    children: [
      image.mediaNode,
      {
        type: "element",
        tagName: "figcaption",
        properties: {},
        children: [{ type: "text", value: image.caption }],
      },
    ],
  };
  parent.children[index] = figure;
}

function rehypeImageCaptions() {
  /**
   * @param {HastRoot} tree
   */
  return (tree) => {
    for (const child of tree.children) {
      visit(child, tree);
    }
  };
}

/**
 * @param {string} text
 */
function normalizeTerm(text) {
  return text.trim().toLowerCase().replace(/[\s-]+/g, "-");
}

/**
 * Lê `src/content/glossary/*.md` e indexa cada termo (nome do arquivo, `term` e `aliases`)
 * pela forma normalizada, apontando para a definição (corpo do arquivo).
 * @returns {Map<string, string>}
 */
function loadGlossary() {
  const dir = new URL("./src/content/glossary/", import.meta.url);
  /** @type {Map<string, string>} */
  const index = new Map();

  for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const [, frontmatter = "", body = ""] = match ?? [];
    const parsed = glossarySchema.safeParse(parseYaml(frontmatter));
    if (!parsed.success) throw new Error(`glossary/${file}: ${parsed.error.message}`);

    const { term, aliases } = parsed.data;
    for (const name of [file.replace(/\.md$/, ""), term, ...aliases]) {
      index.set(normalizeTerm(name), body.trim());
    }
  }

  return index;
}

const glossary = loadGlossary();

/**
 * Envolve `<em>` cujo texto está em `src/content/glossary` com um tooltip.
 */
function rehypeGlossary() {
  /**
   * @param {HastNode} node
   * @param {HastParent} parent
   */
  function walk(node, parent) {
    if (node.type !== "element") return;
    if (node.tagName === "code" || node.tagName === "pre") return;

    const text = node.children[0];
    if (node.tagName === "em" && node.children.length === 1 && text?.type === "text") {
      const definition = glossary.get(normalizeTerm(text.value));
      const index = parent.children.indexOf(node);
      if (definition && index !== -1) {
        parent.children[index] = {
          type: "element",
          tagName: "span",
          properties: { className: ["term"], tabIndex: 0, "data-tip": definition },
          children: [node],
        };
      }
      return;
    }

    for (const child of [...node.children]) walk(child, node);
  }

  /**
   * @param {HastRoot} tree
   */
  return (tree) => {
    for (const child of [...tree.children]) walk(child, tree);
  };
}

/**
 * Abre links externos em nova aba.
 */
function rehypeExternalLinks() {
  /**
   * @param {HastNode} node
   */
  function walk(node) {
    if (node.type !== "element") return;

    const href = node.properties["href"];
    if (node.tagName === "a" && typeof href === "string" && /^https?:\/\//.test(href) && !href.startsWith(site)) {
      node.properties["target"] = "_blank";
      node.properties["rel"] = ["noopener", "noreferrer"];
    }

    for (const child of node.children) walk(child);
  }

  /**
   * @param {HastRoot} tree
   */
  return (tree) => {
    for (const child of tree.children) walk(child);
  };
}

export default defineConfig({
  integrations: [expressiveCode({
    themes: [
      ExpressiveCodeTheme.fromJSONString(readFileSync(new URL("./src/themes/monochrome-dark.json", import.meta.url), "utf8")),
    ],
    defaultProps: {
      frame: "none",
    },
    minSyntaxHighlightingColorContrast: 0,
    themeCssSelector: () => false,
    styleOverrides: {
      borderRadius: "0",
      codeFontFamily: codeFontStack,
      codeFontSize: "0.8125rem",
    },
  })],
  vite: {
    plugins: /** @type {NonNullable<import("astro").ViteUserConfig["plugins"]>} */ (
      /** @type {unknown} */ (tailwindcss())
    ),
  },
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex, rehypeImageCaptions, rehypeGlossary, rehypeExternalLinks],
  },
  site,
});
