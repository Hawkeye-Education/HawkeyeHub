import { expect, test } from "vitest";
import { replyHtml } from "./reply-markdown";

test("a reply's raw HTML is escaped, and script links and images are not rendered", () => {
  const html = replyHtml(
    [
      '<img src="x" onerror="alert(1)"><script>alert(2)</script>',
      "[click](javascript:alert(3)) ![seen](https://tracker.example/pixel.png)",
    ].join("\n\n"),
    "Copy",
  );
  expect(html).not.toMatch(/<img|<script|href="javascript/);
  expect(html).toContain("&lt;script&gt;");
});

test("each code block gets a copy button, its label escaped", () => {
  expect(replyHtml("```\n^Page \\d+$\n```", "<Copy>")).toBe(
    '<div class="code"><pre><code>^Page \\d+$\n</code></pre>\n<button type="button" class="copy">&lt;Copy&gt;</button></div>',
  );
});
