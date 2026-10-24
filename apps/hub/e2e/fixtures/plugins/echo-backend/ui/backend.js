/* global window */
// Calls the Backend while the page is still parsing, before `initialize` can have answered, and
// keeps what comes back on `window.observed` for the smoke test to read.

window.observed = { hellos: [], pongs: [], answer: null, error: null };

window.hub.backend.onNotification("hello", (params) => {
  window.observed.hellos.push(params);
});

window.hub.backend.onNotification("pong", (params) => {
  window.observed.pongs.push(params);
});
window.hub.backend.request("ping", { n: 1 }).then((answer) => {
  window.observed.answer = answer;
});
window.hub.backend.request("fail", {}).catch((error) => {
  window.observed.error = error;
});
