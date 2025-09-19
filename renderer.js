// renderer.js (Now records both screen and webcam)

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

async function startRecording() {
  webcamChunks = [];
  screenChunks = [];

  try {
    // Request the screen stream. The handler in main.js will provide it automatically.
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    
    // Request the webcam stream
    const webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    // Create two separate recorders
    screenRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm' });
    webcamRecorder = new MediaRecorder(webcamStream, { mimeType: 'video/webm' });

    // --- Setup Event Listeners ---
    screenRecorder.ondataavailable = event => {
      if (event.data.size > 0) screenChunks.push(event.data);
    };
    webcamRecorder.ondataavailable = event => {
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
  const recorders = [screenRecorder, webcamRecorder].filter(r => r && r.state === 'recording');
  if (recorders.length === 0) return;

  console.log("Telling recorders to stop.");

  // Use Promise.all to wait for both 'onstop' events to fire
  const stopPromises = recorders.map(recorder => 
    new Promise(resolve => recorder.onstop = resolve)
  );
  
  recorders.forEach(recorder => recorder.stop());

  Promise.all(stopPromises).then(() => {
    console.log("Both recorders have stopped. Saving files...");
    saveFiles();
  });
}

async function saveFiles() {
  const timestamp = Date.now();

  // Save the screen recording
  if (screenChunks.length > 0) {
    const screenBlob = new Blob(screenChunks, { type: 'video/webm' });
    const screenData = new Uint8Array(await screenBlob.arrayBuffer());
    await window.electronAPI.saveFile({ name: `SOURCE-${timestamp}.webm`, buffer: screenData });
  }

  // Save the webcam recording
  if (webcamChunks.length > 0) {
    const webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
    const webcamData = new Uint8Array(await webcamBlob.arrayBuffer());
    await window.electronAPI.saveFile({ name: `REACTION-${timestamp}.webm`, buffer: webcamData });
  }

  // Clear chunks for the next session
  screenChunks = [];
  webcamChunks = [];
}