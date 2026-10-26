// The Web Worker the auto-crop runs in, off the UI thread (spec #159): pixels in, a Crop out.

import { cropBox, type Pixels } from "./crop";

onmessage = (event: MessageEvent<Pixels>) => {
  postMessage(cropBox(event.data));
};
