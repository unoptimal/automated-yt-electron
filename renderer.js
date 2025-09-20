// renderer.js — record, stitch, upload; robust META handling

let webcamRecorder;
let screenRecorder;
let webcamChunks = [];
let screenChunks = [];

// Only accept META while a session is open
let isSessionOpen = false;

// Store metadata keyed by URL to avoid cross-mixing
const urlOrder = []; // preserves watch order
const urlToTitle = new Map(); // url -> latest/best title
let lastMetaAt = 0; // for meta-idle wait

// Debug
let lastChromeMessage = null;

function addMeta({ title, url }) {
  if (!url) return;
  if (!urlOrder.includes(url)) urlOrder.push(url);
  if (title) {
    const t = String(title).trim();
    if (t && !/^YouTube$/i.test(t)) urlToTitle.set(url, t);
  }
  lastMetaAt = Date.now();
  console.log("META Added:", { title, url, total: urlOrder.length });
}

function buildYouTubeFields(urlOrder, urlToTitle) {
  const seen = new Set();
  const titles = [];

  for (const u of urlOrder) {
    const t = (urlToTitle.get(u) || "").replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    titles.push(t);
  }

  // --- THIS IS THE CHANGE ---
  // Create a new array where each title is wrapped in quotes.
  const quotedTitles = titles.map((t) => `"${t}"`);
  // --- END OF CHANGE ---

  const prefix = "Justin Watches ";
  let headline = prefix;

  if (quotedTitles.length === 0) {
    headline = "Justin Watches";
  } else if (quotedTitles.length === 1) {
    headline += quotedTitles[0];
  } else if (quotedTitles.length === 2) {
    headline += quotedTitles.join(" and ");
  } else {
    // For 3 or more, use the Oxford comma
    const lastTitle = quotedTitles.pop();
    headline += quotedTitles.join(", ") + ", and " + lastTitle;
  }

  // Clamp to 100 chars, using the quoted titles for length calculation
  if (headline.length > 100) {
    for (let k = titles.length; k >= 1; k--) {
      // We use the original 'titles' array here for slicing, then quote them for the string.
      const slicedQuotedTitles = titles.slice(0, k).map((t) => `"${t}"`);
      const attempt =
        prefix +
        slicedQuotedTitles.join(", ") +
        (k < titles.length ? ` and ${titles.length - k} more…` : "");
      if (attempt.length <= 100) {
        headline = attempt;
        break;
      }
    }
    if (headline.length > 100) headline = headline.slice(0, 97) + "…";
  }

  const description = urlOrder.length
    ? "Links:\n" + urlOrder.join("\n")
    : "Links:";
  return { title: headline, description };
}

async function waitForMetaIdle(msIdle = 800, maxWait = 4000) {
  const deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    const since = Date.now() - lastMetaAt;
    if (since >= msIdle) break;
    await new Promise((r) => setTimeout(r, Math.min(120, msIdle - since)));
  }
}

// ---------- Chrome <-> Electron bridge ----------
window.electronAPI.onChromeMessage((message) => {
  if (message?.type === "META") {
    if (!isSessionOpen) return; // Only accept META after session starts
    addMeta({ title: message.title, url: message.url });
    return;
  }

  if (message?.status === "PLAY") {
    console.log("Renderer received PLAY signal. Starting recordings...");
    // --- THIS IS THE FIX ---
    // Start the recording AND log the metadata from the initial PLAY signal.
    startRecording();
    addMeta({ title: message.title, url: message.url });
    // --- END OF FIX ---
  } else if (message.status === "STOP") {
    console.log("Renderer received STOP signal. Stopping recordings...");
    stopRecording();
  }
});

// ---------- Recording ----------
async function findPreferredMicId() {
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((d) => d.kind === "audioinput");
  const preferred = microphones.find((m) =>
    m.label.includes("MacBook Air Microphone")
  );
  return preferred ? preferred.deviceId : null;
}

async function startRecording() {
  webcamChunks = [];
  screenChunks = [];
  isSessionOpen = true; // start accepting META

  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 20, max: 20 },
      },
      audio: {
        channelCount: 2,
        sampleRate: 48000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const preferredMicId = await findPreferredMicId();
    const webcamConstraints = {
      video: {
        width: { ideal: 256, max: 256 },
        height: { ideal: 144, max: 144 },
        frameRate: { ideal: 15, max: 15 },
        facingMode: "user",
      },
      audio: {
        channelCount: 2,
        sampleRate: 48000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };
    if (preferredMicId)
      webcamConstraints.audio.deviceId = { exact: preferredMicId };
    const webcamStream = await navigator.mediaDevices.getUserMedia(
      webcamConstraints
    );

    const screenOptions = {
      mimeType: "video/webm;codecs=vp8",
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    };
    const webcamOptions = {
      mimeType: "video/webm;codecs=vp8",
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    };

    screenRecorder = new MediaRecorder(screenStream, screenOptions);
    webcamRecorder = new MediaRecorder(webcamStream, webcamOptions);

    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data);
    };
    webcamRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) webcamChunks.push(e.data);
    };

    // chunk every second to keep buffers small and reduce jank
    screenRecorder.start(1000);
    webcamRecorder.start(1000);
    console.log("Both screen and webcam recorders have started.");
  } catch (err) {
    console.error("Error starting recordings:", err);
  }
}

function stopRecording() {
  // Stop accepting META *immediately* for this session
  isSessionOpen = false;

  const recorders = [screenRecorder, webcamRecorder].filter(
    (r) => r && r.state === "recording"
  );
  if (recorders.length === 0) return;

  console.log("Telling recorders to stop.");
  const stopPromises = recorders.map(
    (rec) => new Promise((resolve) => (rec.onstop = resolve))
  );
  recorders.forEach((rec) => rec.stop());

  Promise.all(stopPromises).then(() => {
    console.log("Both recorders have stopped. Saving files...");
    saveFiles();
  });
}

async function saveFiles() {
  const timestamp = Date.now();
  let sourcePath = null;
  let reactionPath = null;

  if (screenChunks.length > 0) {
    const screenBlob = new Blob(screenChunks, { type: "video/webm" });
    sourcePath = await window.electronAPI.saveFile({
      name: `temp-source-${timestamp}.webm`,
      buffer: new Uint8Array(await screenBlob.arrayBuffer()),
    });
  }
  if (webcamChunks.length > 0) {
    const webcamBlob = new Blob(webcamChunks, { type: "video/webm" });
    reactionPath = await window.electronAPI.saveFile({
      name: `temp-reaction-${timestamp}.webm`,
      buffer: new Uint8Array(await webcamBlob.arrayBuffer()),
    });
  }

  screenChunks = [];
  webcamChunks = [];

  if (sourcePath && reactionPath) {
    console.log("Both files saved, telling main process to stitch.");
    const outputPath = await window.electronAPI.stitchVideos({
      sourcePath,
      reactionPath,
    });
    console.log(
      "✅ Stitching complete. Video is in your Downloads folder at:",
      outputPath
    );

    // Allow late titles from THIS session to arrive (but cap the wait)
    await waitForMetaIdle(800, 4000);

    try {
      const { title, description } = buildYouTubeFields(urlOrder, urlToTitle);
      console.log("Starting YouTube upload with:", { title, description });

      const videoId = await window.electronAPI.uploadVideo({
        filePath: outputPath,
        title,
        description,
      });
      console.log(`✅ Video uploaded (private) with ID: ${videoId}`);
    } catch (err) {
      console.error("❌ Video upload failed:", err);
    } finally {
      // reset session meta after each upload
      urlOrder.length = 0;
      urlToTitle.clear();
    }
  }
}
