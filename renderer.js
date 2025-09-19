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
    let sourcePath = null;
    let reactionPath = null;
  
    // Save the screen recording and get its file path
    if (screenChunks.length > 0) {
      const screenBlob = new Blob(screenChunks, { type: 'video/webm' });
      const screenData = new Uint8Array(await screenBlob.arrayBuffer());
      sourcePath = await window.electronAPI.saveFile({ name: `temp-source-${timestamp}.webm`, buffer: screenData });
    }
  
    // Save the webcam recording and get its file path
    if (webcamChunks.length > 0) {
      const webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
      const webcamData = new Uint8Array(await webcamBlob.arrayBuffer());
      reactionPath = await window.electronAPI.saveFile({ name: `temp-reaction-${timestamp}.webm`, buffer: webcamData });
    }
  
    // Clear chunks for the next session
    screenChunks = [];
    webcamChunks = [];
  
    // Corrected logic: Check if both files exist and then proceed
    if (sourcePath && reactionPath) {
      console.log("Both files saved, telling main process to stitch.");
  
      // This is the correct way to call the IPC handler and get the result.
      // The main process will return the final outputPath.
      const outputPath = await window.electronAPI.stitchVideos({ sourcePath, reactionPath });
  
      // Then, proceed with the upload
      try {
        console.log("Stitching complete. Starting YouTube upload...");
        const videoId = await window.electronAPI.uploadVideo({
          filePath: outputPath,
          title: "My Reaction Video",
          description: "A cool reaction video created with my Electron app."
        });
        console.log(`✅ Video uploaded with ID: ${videoId}`);
      } catch (err) {
        console.error("Video upload failed:", err);
      }
    }
  }