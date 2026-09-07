import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { allDocs } from "./docs";
import { llmsFull, llmsIndex } from "./ai-discovery";
import { absoluteUrl, SITE_URL } from "./site";

function markdownLinks(markdown: string) {
  const links: string[] = [];
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type === "link") links.push(token.href);
  });
  return links;
}

describe("public documentation discovery", () => {
  it("lists every public Markdown document once, including agent setup and the skill", () => {
    const links = markdownLinks(llmsIndex());
    expect(links.filter((href) => href.startsWith(`${SITE_URL}/docs-md/`)).sort())
      .toEqual(allDocs().map((doc) => absoluteUrl(doc.markdownUrl)).sort());
    expect(links).toContain(absoluteUrl("/ply-skill.md"));
  });

  it("keeps documentation links valid in rendered HTML", () => {
    const pages = new Set(allDocs().map((doc) => doc.url));
    for (const doc of allDocs()) {
      for (const match of doc.html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
        const url = new URL(match[1], absoluteUrl(doc.url));
        if (url.origin === SITE_URL && url.pathname.startsWith("/docs/")) {
          expect(pages.has(url.pathname), `${doc.url} links to ${url.pathname}`).toBe(true);
        }
      }
    }
  });

  it("keeps documentation links valid when combined into one Markdown file", () => {
    const docs = allDocs();
    const pages = new Set(docs.flatMap((doc) => [doc.url, doc.markdownUrl]));
    const filenames = new Set(docs.map((doc) => `${doc.slug}.md`));
    for (const href of markdownLinks(llmsFull())) {
      const url = new URL(href, absoluteUrl("/llms-full.txt"));
      if (url.origin !== SITE_URL) continue;
      if (url.pathname.startsWith("/docs/") || filenames.has(url.pathname.split("/").at(-1)!)) {
        expect(pages.has(url.pathname), `combined docs link to ${url.pathname}`).toBe(true);
      }
    }
  });
});

