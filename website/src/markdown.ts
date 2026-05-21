import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

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

export function renderMarkdown(markdown: string): string {
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
    html.push(`<p>${parseInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };

  const flushBlockquote = (): void => {
    if (blockquote.length === 0) return;
    html.push(`<blockquote>${blockquote.map((line) => `<p>${parseInline(line)}</p>`).join("")}</blockquote>`);
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

    const detailsTag = /^<\/?details>$/iu.exec(trimmed);
    if (detailsTag) {
      closeFlow();
      html.push(trimmed.toLowerCase());
      continue;
    }

    const summary = /^<summary>(.*)<\/summary>$/iu.exec(trimmed);
    if (summary) {
      closeFlow();
      html.push(`<summary>${parseInlineHtml(summary[1] ?? "")}</summary>`);
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
      html.push(renderTable(tableRows));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      closeFlow();
      const marker = heading[1] ?? "#";
      const text = heading[2] ?? "";
      const level = marker.length;
      const id = slugify(text);
      html.push(`<h${level} id="${id}">${parseInline(text)}</h${level}>`);
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
      html.push(`<li>${parseInline(unordered[1] ?? "")}</li>`);
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
      html.push(`<li>${parseInline(ordered[1] ?? "")}</li>`);
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

function renderTable(rows: readonly string[][]): string {
  const [head = [], ...body] = rows;
  const hasVisibleHead = head.some((cell) => cell.trim() !== "");
  const headHtml = hasVisibleHead ? `<thead><tr>${head.map((cell) => `<th>${parseInline(cell)}</th>`).join("")}</tr></thead>` : "";
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${parseInline(cell)}</td>`).join("")}</tr>`)
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

function parseInline(value: string): string {
  return parseInlineEscaped(escapeHtml(value));
}

function parseInlineHtml(value: string): string {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/&lt;code&gt;([\s\S]*?)&lt;\/code&gt;/giu, (_match: string, code: string) => `<code>${code}</code>`);
  return parseInlineEscaped(rendered);
}

function parseInlineEscaped(value: string): string {
  let rendered = value;
  rendered = rendered.replace(/\[!\[([^\]]*)]\(([^)]+)\)]\(([^)]+)\)/g, (_match: string, alt: string, src: string, href: string) => {
    const safeHref = normalizeHref(href);
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
    const safeHref = normalizeHref(href);
    return `<a href="${escapeAttribute(safeHref)}" target="${safeHref.startsWith("http") ? "_blank" : "_self"}" rel="noreferrer">${label}</a>`;
  });
  return rendered;
}

function normalizeHref(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  const hashRoute = appRouteFromHash(href);
  if (hashRoute) return appHref(hashRoute);
  if (href.startsWith("#")) return href;
  const mdMatch = href.match(/(?:^|\/)([^/#?]+)\.md(?:(#[^?]+))?$/);
  if (mdMatch) {
    const slug = mdMatch[1] ?? "examples";
    const anchor = mdMatch[2] ?? "";
    return `${appHref(`docs/${slug}`)}${anchor}`;
  }
  return href;
}

function appRouteFromHash(href: string): string | null {
  const hash = href.replace(/^#/, "").replace(/^\/+|\/+$/gu, "");
  if (hash === "home") return "home";
  if (hash === "previews" || hash.startsWith("previews/") || hash.startsWith("docs/")) return hash;
  return null;
}

function appHref(route: string): string {
  const normalizedBase = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const normalizedRoute = route.replace(/^\/+|\/+$/gu, "");
  return normalizedRoute === "" || normalizedRoute === "home" ? normalizedBase : `${normalizedBase}${normalizedRoute}`;
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
