import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { DOC_PAGES } from "./docs.ts";
import { appHref, appRouteFromHash } from "./site/shared.ts";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
};

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const GITHUB_SOURCE_BASE = "https://github.com/Federicocervelli/blazeplot/blob/development/";

const DOC_ROUTE_BY_SOURCE_PATH: Readonly<Record<string, string>> = Object.fromEntries(
  DOC_PAGES.map((page) => [page.sourcePath, `docs/${page.slug}`]),
);

export interface RenderMarkdownOptions {
  readonly sourcePath?: string;
}

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeLanguage = "";
  let codeLines: string[] = [];
  let paragraph: string[] = [];
  let list: "ul" | "ol" | null = null;
  let blockquote: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    html.push(`<p>${parseInline(paragraph.join(" "), options)}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };

  const flushBlockquote = (): void => {
    if (blockquote.length === 0) return;
    html.push(`<blockquote>${blockquote.map((line) => `<p>${parseInline(line, options)}</p>`).join("")}</blockquote>`);
    blockquote = [];
  };

  const closeFlow = (): void => {
    flushParagraph();
    flushList();
    flushBlockquote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        html.push(renderCodeBlock(codeLanguage, codeLines.join("\n")));
        inCode = false;
        codeLanguage = "";
        codeLines = [];
      } else {
        closeFlow();
        codeLanguage = trimmed.slice(3).trim();
        codeLines = [];
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (trimmed === "") {
      closeFlow();
      continue;
    }

    const chartDirective = /^:::\s*chart\s+([a-z0-9-]+)(?:\s+(.*))?$/iu.exec(trimmed);
    if (chartDirective) {
      closeFlow();
      const id = chartDirective[1] ?? "";
      const label = chartDirective[2]?.trim() || id.replace(/-/g, " ");
      html.push(`<figure class="doc-chart-card"><figcaption>${parseInline(label, options)}</figcaption><div class="doc-chart" data-doc-chart="${escapeAttribute(id)}" role="img" aria-label="${escapeAttribute(label)}"></div></figure>`);
      continue;
    }

    const detailsTag = /^<\/?details>$/iu.exec(trimmed);
    if (detailsTag) {
      closeFlow();
      html.push(trimmed.toLowerCase());
      continue;
    }

    const summary = /^<summary>(.*)<\/summary>$/iu.exec(trimmed);
    if (summary) {
      closeFlow();
      html.push(`<summary>${parseInlineHtml(summary[1] ?? "", options)}</summary>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      closeFlow();
      const tableRows: string[][] = [];
      tableRows.push(splitTableRow(rawLine));
      index += 2;
      while (index < lines.length) {
        const tableLine = lines[index] ?? "";
        if (!tableLine.includes("|") || tableLine.trim() === "") {
          index -= 1;
          break;
        }
        tableRows.push(splitTableRow(tableLine));
        index += 1;
      }
      html.push(renderTable(tableRows, options));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      closeFlow();
      const marker = heading[1] ?? "#";
      const text = heading[2] ?? "";
      const level = marker.length;
      const id = slugify(text);
      html.push(`<h${level} id="${id}">${parseInline(text, options)}</h${level}>`);
      continue;
    }

    if (trimmed === "---") {
      closeFlow();
      html.push("<hr>");
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushList();
      blockquote.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      flushBlockquote();
      if (list !== "ul") {
        flushList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${parseInline(unordered[1] ?? "", options)}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      flushBlockquote();
      if (list !== "ol") {
        flushList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${parseInline(ordered[1] ?? "", options)}</li>`);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(trimmed);
  }

  if (inCode) html.push(renderCodeBlock(codeLanguage, codeLines.join("\n")));
  closeFlow();
  return html.join("\n");
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const current = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  if (!current.includes("|") || !next.includes("|")) return false;

  const separatorCells = splitTableRow(next);
  return separatorCells.length > 0 && separatorCells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function splitTableRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/u, "");
  const cells: string[] = [];
  let cell = "";
  let inCode = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index] ?? "";
    const previous = trimmed[index - 1] ?? "";
    if (character === "`" && previous !== "\\") inCode = !inCode;
    if (character === "|" && previous !== "\\" && !inCode) {
      cells.push(cell.trim().replace(/\\\|/g, "|"));
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell.trim().replace(/\\\|/g, "|"));
  return cells;
}

function renderTable(rows: readonly string[][], options: RenderMarkdownOptions = {}): string {
  const [head = [], ...body] = rows;
  const hasVisibleHead = head.some((cell) => cell.trim() !== "");
  const headHtml = hasVisibleHead ? `<thead><tr>${head.map((cell) => `<th>${parseInline(cell, options)}</th>`).join("")}</tr></thead>` : "";
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${parseInline(cell, options)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table>${headHtml}<tbody>${bodyHtml}</tbody></table></div>`;
}

function renderCodeBlock(language: string, code: string): string {
  const requestedLanguage = language.split(/\s+/u)[0]?.toLowerCase() ?? "";
  const normalizedLanguage = LANGUAGE_ALIASES[requestedLanguage] ?? requestedLanguage;
  const languageClass = normalizedLanguage ? ` class="language-${escapeAttribute(normalizedLanguage)}"` : "";
  const languageLabel = requestedLanguage ? `<span class="code-language">${escapeHtml(requestedLanguage)}</span>` : "";
  return `<pre>${languageLabel}<code${languageClass}>${highlightCode(code, normalizedLanguage)}</code></pre>`;
}

function highlightCode(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return hljs.highlightAuto(code, ["typescript", "javascript", "xml", "bash"]).value;
}

function parseInline(value: string, options: RenderMarkdownOptions): string {
  return parseInlineEscaped(escapeHtml(value), options);
}

function parseInlineHtml(value: string, options: RenderMarkdownOptions): string {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/&lt;code&gt;([\s\S]*?)&lt;\/code&gt;/giu, (_match: string, code: string) => `<code>${code}</code>`);
  return parseInlineEscaped(rendered, options);
}

function parseInlineEscaped(value: string, options: RenderMarkdownOptions): string {
  let rendered = value;
  rendered = rendered.replace(/\[!\[([^\]]*)]\(([^)]+)\)]\(([^)]+)\)/g, (_match: string, alt: string, src: string, href: string) => {
    const safeHref = normalizeHref(href, options);
    const target = safeHref.startsWith("http") ? "_blank" : "_self";
    return `<a href="${escapeAttribute(safeHref)}" target="${target}" rel="noreferrer"><img src="${escapeAttribute(normalizeImageSrc(src))}" alt="${escapeAttribute(alt)}"></a>`;
  });
  rendered = rendered.replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_match: string, alt: string, src: string) => {
    return `<img src="${escapeAttribute(normalizeImageSrc(src))}" alt="${escapeAttribute(alt)}">`;
  });
  rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
  rendered = rendered.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match: string, label: string, href: string) => {
    const safeHref = normalizeHref(href, options);
    return `<a href="${escapeAttribute(safeHref)}" target="${safeHref.startsWith("http") ? "_blank" : "_self"}" rel="noreferrer">${label}</a>`;
  });
  return rendered;
}

function normalizeHref(href: string, options: RenderMarkdownOptions): string {
  if (/^https?:\/\//.test(href)) return href;
  const hashRoute = appRouteFromHash(href);
  if (hashRoute) return appHref(hashRoute);
  if (href.startsWith("#")) return href;
  const mdMatch = href.match(/^([^#?]+\.md)(#[^?]+)?$/);
  if (mdMatch) {
    const markdownPath = normalizeMarkdownPath(mdMatch[1] ?? "", options.sourcePath);
    const anchor = mdMatch[2] ?? "";
    const route = DOC_ROUTE_BY_SOURCE_PATH[markdownPath];
    if (route) return `${appHref(route)}${anchor}`;
    return `${GITHUB_SOURCE_BASE}${markdownPath}${anchor}`;
  }
  return href;
}

function normalizeMarkdownPath(hrefPath: string, sourcePath: string | undefined): string {
  if (hrefPath.startsWith("./") || hrefPath.startsWith("../")) {
    const sourceDirectory = sourcePath?.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    return normalizePath(`${sourceDirectory}/${hrefPath}`);
  }
  return normalizePath(hrefPath);
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function normalizeImageSrc(src: string): string {
  if (/^https?:\/\//.test(src) || src.startsWith("data:") || src.startsWith("/")) return src;
  return src;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPE[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
