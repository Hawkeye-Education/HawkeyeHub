/* global window, document, console, navigator, Notification, location */
// Each lockdown attempt reports what happened, on the page and in the Plugin's log.

function report(text) {
  const item = document.createElement("li");
  item.textContent = text;
  document.getElementById("results").append(item);
  console.log(`lockdown: ${text}`);
}

function on(id, action) {
  document.getElementById(id).addEventListener("click", () => {
    Promise.resolve()
      .then(action)
      .then(
        (result) => {
          report(`${id}: ${result}`);
        },
        (error) => {
          report(`${id}: threw ${error.name}: ${error.message}`);
        },
      );
  });
}

document.getElementById("loaded").textContent = new Date().toISOString();
report(`loaded ${location.href}`);

const opened = (url) => () => `returned ${String(window.open(url))}`;
on("open-https", opened("https://example.com/"));
on("open-blank", opened("about:blank"));
on("open-own", opened("./index.html"));

on("nav-assign", () => {
  location.href = "https://example.com/";
  return "assigned";
});

on("camera", () =>
  navigator.mediaDevices.getUserMedia({ video: true }).then(() => "granted"),
);
on("microphone", () =>
  navigator.mediaDevices.getUserMedia({ audio: true }).then(() => "granted"),
);
on("notifications", () => Notification.requestPermission());
on(
  "geolocation",
  () =>
    new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          resolve("granted");
        },
        (error) => {
          resolve(`error ${String(error.code)} ${error.message}`);
        },
      );
    }),
);
on("permission-states", async () => {
  const names = ["camera", "microphone", "notifications", "geolocation"];
  const states = await Promise.all(
    names.map((name) =>
      navigator.permissions.query({ name }).then(({ state }) => state),
    ),
  );
  return names.map((name, i) => `${name}=${states[i]}`).join(" ");
});
on("clipboard", async () => {
  const text = `lockdown ${String(Date.now())}`;
  await navigator.clipboard.writeText(text);
  const read = await navigator.clipboard.readText();
  return read === text ? `wrote and read back "${read}"` : `read "${read}"`;
});
