// The Hub Chrome is built from the Theme as a Plugin UI is (ADR 0006): hawkeye.css and native.css
// on the page, through a constructed sheet the CSP allows. Element styles do not cross into a
// Shadow DOM, so each component puts `native` first in its own styles; the tokens inherit.

import { unsafeCSS } from "lit";
import hawkeyeCss from "../hub-kit/hawkeye.css?raw";
import nativeCss from "../hub-kit/native.css?raw";

const page = new CSSStyleSheet();
page.replaceSync(`${hawkeyeCss}\n${nativeCss}`);
document.adoptedStyleSheets = [page];

export const native = unsafeCSS(nativeCss);
