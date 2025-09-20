// renderer.js

let webcamRecorder;
let screenRecorder;
let webcamChunks = [];
let screenChunks = [];

window.electronAPI.onChromeMessage((message) => {
  if (message.status === "PLAY") {
    console.log("Renderer received PLAY signal. Starting recordings...");
    startRecording();
  } else if (message.status === "STOP") {
    console.log("Renderer received STOP signal. Stopping recordings...");
    stopRecording();
  }
});

// ✅ STEP 1: The new, refactored function to find the mic ID
async function findPreferredMicId() {
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === "audioinput");
  const preferredMic = microphones.find((mic) =>
    mic.label.includes("MacBook Air Microphone")
  );
  if (preferredMic) {
    console.log("✅ Found preferred mic: MacBook Air Microphone");
    return preferredMic.deviceId;
  } else {
    console.log("⚠️ MacBook Air Microphone not found. Using system default.");
    return null;
  }
}

async function startRecording() {
  webcamChunks = [];
  screenChunks = [];

  try {
    // Screen stream request remains the same
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

    // ✅ STEP 2: Use the findPreferredMicId function here
    const preferredMicId = await findPreferredMicId();

    const webcamConstraints = {
      video: {
        width: { ideal: 256, max: 256 }, // try 256×144 first
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

    // If a preferred mic ID was found, add it to the constraints
    if (preferredMicId) {
      webcamConstraints.audio.deviceId = { exact: preferredMicId };
    }

    const webcamStream = await navigator.mediaDevices.getUserMedia(
      webcamConstraints
    );

    const options = {
      mimeType: "video/webm",
      videoBitsPerSecond: 10000000,
    };

    // Create two separate recorders
    screenRecorder = new MediaRecorder(screenStream, options);
    webcamRecorder = new MediaRecorder(webcamStream, options);

    // --- Setup Event Listeners ---
    screenRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) screenChunks.push(event.data);
    };
    webcamRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) webcamChunks.push(event.data);
    };

    // --- Start Both Recorders ---
    screenRecorder.start();
    webcamRecorder.start();
    console.log("Both screen and webcam recorders have started.");
  } catch (err) {
    console.error("Error starting recordings:", err);
  }
}

function stopRecording() {
  const recorders = [screenRecorder, webcamRecorder].filter(
    (r) => r && r.state === "recording"
  );
  if (recorders.length === 0) return;

  console.log("Telling recorders to stop.");

  // Use Promise.all to wait for both 'onstop' events to fire
  const stopPromises = recorders.map(
    (recorder) => new Promise((resolve) => (recorder.onstop = resolve))
  );

  recorders.forEach((recorder) => recorder.stop());

  Promise.all(stopPromises).then(() => {
    console.log("Both recorders have stopped. Saving files...");
    saveFiles();
  });
}

async function saveFiles() {
  const timestamp = Date.now();
  let sourcePath = null;
  let reactionPath = null;

  // Save the screen recording and get its file path
  if (screenChunks.length > 0) {
    const screenBlob = new Blob(screenChunks, { type: "video/webm" });
    const screenData = new Uint8Array(await screenBlob.arrayBuffer());
    sourcePath = await window.electronAPI.saveFile({
      name: `temp-source-${timestamp}.webm`,
      buffer: screenData,
    });
  }

  // Save the webcam recording and get its file path
  if (webcamChunks.length > 0) {
    const webcamBlob = new Blob(webcamChunks, { type: "video/webm" });
    const webcamData = new Uint8Array(await webcamBlob.arrayBuffer());
    reactionPath = await window.electronAPI.saveFile({
      name: `temp-reaction-${timestamp}.webm`,
      buffer: webcamData,
    });
  }

  // Clear chunks for the next session
  screenChunks = [];
  webcamChunks = [];

  // Corrected logic: Check if both files exist and then proceed
  if (sourcePath && reactionPath) {
    console.log("Both files saved, telling main process to stitch.");

    // This is the correct way to call the IPC handler and get the result.
    // The main process will return the final outputPath.
    const outputPath = await window.electronAPI.stitchVideos({
      sourcePath,
      reactionPath,
    });

    // Then, proceed with the upload
    // try {
    //   console.log("Stitching complete. Starting YouTube upload...");
    //   const videoId = await window.electronAPI.uploadVideo({
    //     filePath: outputPath,
    //     title: "My Reaction Video",
    //     description: "A cool reaction video created with my Electron app."
    //   });
    //   console.log(`✅ Video uploaded with ID: ${videoId}`);
    // } catch (err) {
    //   console.error("Video upload failed:", err);
    // }
    console.log(
      "✅ Stitching complete. Video is in your Downloads folder at:",
      outputPath
    );
  }
}
