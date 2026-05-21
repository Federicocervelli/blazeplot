import { describe, expect, test } from "bun:test";

import { renderMarkdown } from "../../website/src/markdown.ts";

describe("website markdown links", () => {
  test("maps relative public docs links to their routed pages", () => {
    const html = renderMarkdown("[Docs map](./README.md) [Data](./data-semantics.md#x-ordering)", {
      sourcePath: "docs/overview.md",
    });

    expect(html).toContain('href="/docs/docs-map"');
    expect(html).toContain('href="/docs/data-semantics#x-ordering"');
  });

  test("keeps internal maintainer docs as source links", () => {
    const html = renderMarkdown("[Local development](./internal/local-development.md)", {
      sourcePath: "docs/README.md",
    });

    expect(html).toContain(
      'href="https://github.com/Federicocervelli/blazeplot/blob/development/docs/internal/local-development.md"',
    );
  });
});
