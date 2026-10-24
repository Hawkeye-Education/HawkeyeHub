// An Assistant reply's Markdown as HTML for the Assistant Panel. markdown-it with `html: false`
// escapes raw HTML, and refuses javascript:, vbscript:, file: and data: links, so a reply cannot
// put markup into the Hub Chrome. Images are off: a reply could otherwise make the Hub Chrome
// fetch any URL.

import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false });
markdown.disable("image");
const { fence } = markdown.renderer.rules;
if (fence === undefined) throw new Error("markdown-it has a fence rule");
const defaultFence = fence;

/** A reply as HTML, each code block followed by a copy button labelled `copy`. */
export function replyHtml(text: string, copy: string): string {
  markdown.renderer.rules["fence"] = (...args) =>
    `<div class="code">${defaultFence(...args)}<button type="button" class="copy">${markdown.utils.escapeHtml(copy)}</button></div>`;
  return markdown.render(text);
}
