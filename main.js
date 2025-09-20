const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  Tray,
  Menu,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");
const { spawn } = require("child_process");
// NEW: Import the package to get the path to the ffmpeg executable
const ffmpegPath = require("ffmpeg-static");

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

let mainWindow;
let tray = null;
// RE-ADDED: A variable to hold the target window title from the Chrome extension.
let targetWindowTitle = "";
let messageQueue = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");
  // mainWindow.webContents.openDevTools();

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("Renderer has finished loading.");
    if (messageQueue) {
      console.log("Processing queued message:", messageQueue.status);
      mainWindow.webContents.send("from-chrome", messageQueue);
      messageQueue = null;
    }
  });
}

function stitchVideos(sourcePath, reactionPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log("Starting to stitch videos at 1920x1080 with larger PiP...");

    // 1920x1080 landscape canvas
    // [0:v] = screen, [1:v] = webcam
    // - Screen: scale to fill then crop (cover)
    // - Webcam: scale to 600px width, preserve aspect
    // - Overlay bottom-right with 40px margin
    // - Mix both audios
    const filter = [
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[bg]",
      "[1:v]scale=600:-1,setsar=1[pip]",
      "[bg][pip]overlay=W-w-40:H-h-40[v]",
      "[0:a][1:a]amix=inputs=2:dropout_transition=2[a]",
    ].join(";");

    const ffmpeg = spawn(ffmpegPath, [
      "-i",
      sourcePath, // Input 0: screen
      "-i",
      reactionPath, // Input 1: webcam
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-r",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    ffmpeg.on("close", (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      if (code === 0) {
        console.log("✅ Stitching successful!");
        try {
          fs.unlinkSync(sourcePath);
          fs.unlinkSync(reactionPath);
        } catch (_) {}
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.stderr.on("data", (data) => {
      // Uncomment to debug:
      // console.error(`ffmpeg stderr: ${data}`);
    });

    ffmpeg.on("error", (err) => {
      console.error("Failed to start FFmpeg process.", err);
      reject(err);
    });
  });
}

app.whenReady().then(() => {
  // RE-ADDED: The handler that automatically selects the screen source.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
      });

      if (!targetWindowTitle) {
        console.error("Target window title not set. Cannot select a source.");
        return callback({});
      }

      console.log(
        `Searching for window with title including: "${targetWindowTitle}"`
      );
      const targetSource = sources.find((s) =>
        s.name.includes(targetWindowTitle)
      );

      if (targetSource) {
        console.log("✅ Found matching screen source:", targetSource.name);
        // Approve this source for video and add system audio via 'loopback'.
        callback({ video: targetSource, audio: "loopback" });
      } else {
        console.error(
          `❌ Could not find a source with title: "${targetWindowTitle}"`
        );
        callback({});
      }
    }
  );

  ipcMain.handle("save-file", (event, { buffer, name }) => {
    const fileBuffer = Buffer.from(buffer);
    const filePath = path.join(app.getPath("downloads"), name);
    try {
      fs.writeFileSync(filePath, fileBuffer);
      console.log(`✅ File saved to ${filePath}`);
      return filePath; // Return the path so the renderer knows where it is
    } catch (err) {
      console.error("Failed to save file:", err);
      return null;
    }
  });

  // NEW: A listener to receive the file paths and start the stitching process
  ipcMain.handle(
    "stitch-videos",
    async (event, { sourcePath, reactionPath }) => {
      const timestamp = Date.now();
      const outputPath = path.join(
        app.getPath("downloads"),
        `REACTION-FINAL-${timestamp}.mp4`
      );
      await stitchVideos(sourcePath, reactionPath, outputPath);
      return outputPath; // Return the path after stitching is done
    }
  );

  ipcMain.handle(
    "upload-video",
    async (event, { filePath, title, description }) => {
      try {
        const credentials = JSON.parse(fs.readFileSync("client_secret.json"));
        const { client_secret, client_id, redirect_uris } =
          credentials.installed;
        const oAuth2Client = new OAuth2Client(
          client_id,
          client_secret,
          redirect_uris[0]
        );

        const tokenPath = path.join(app.getPath("userData"), "token.json");

        // The rest of your code stays the same
        if (fs.existsSync(tokenPath)) {
          // This will now always be false
          oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenPath)));
        } else {
          // THIS 'ELSE' BLOCK WILL NOW ALWAYS RUN
          const authUrl = oAuth2Client.generateAuthUrl({
            access_type: "offline",
            scope: SCOPES,
          });

          // Open a browser window for the user to authenticate
          const authWindow = new BrowserWindow({
            width: 800,
            height: 600,
            show: false,
          });
          authWindow.loadURL(authUrl);
          authWindow.show();

          // Listen for the redirect URL in the browser window
          const authCode = await new Promise((resolve) => {
            authWindow.webContents.on("will-redirect", (event, url) => {
              const urlParams = new URL(url).searchParams;
              const code = urlParams.get("code");
              if (code) {
                authWindow.close();
                resolve(code);
              }
            });
          });

          // Exchange the authorization code for a token
          const { tokens } = await oAuth2Client.getToken(authCode);
          oAuth2Client.setCredentials(tokens);

          // Save the token for future use
          fs.writeFileSync(tokenPath, JSON.stringify(tokens));
        }

        const youtube = google.youtube({ version: "v3", auth: oAuth2Client });

        // Upload the video
        const res = await youtube.videos.insert({
          part: "snippet,status",
          requestBody: {
            snippet: {
              title,
              description,
            },
            status: {
              privacyStatus: "public", // "private" for testing
            },
          },
          media: {
            body: fs.createReadStream(filePath),
          },
        });

        console.log("✅ Video upload successful!", res.data.id);
        return res.data.id;
      } catch (error) {
        console.error("❌ Video upload failed:", error);
        throw error;
      }
    }
  );

  ipcMain.handle("get-file-path", async (event, filename) => {
    const downloadsPath = app.getPath("downloads");
    return path.join(downloadsPath, filename);
  });

  createWindow();
  listenForMessages();
});

function listenForMessages() {
  process.stdin.on("data", (data) => {
    try {
      const messageLength = data.readUInt32LE(0);
      const message = data.toString("utf-8", 4, 4 + messageLength);
      const parsedMessage = JSON.parse(message);

      // UPDATED: Store the title when a PLAY signal is received.
      if (parsedMessage.status === "PLAY" && parsedMessage.title) {
        targetWindowTitle = parsedMessage.title;
        console.log(`Set target window title to: "${targetWindowTitle}"`);
      }

      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.webContents.isLoading()
      ) {
        mainWindow.webContents.send("from-chrome", parsedMessage);
      } else {
        messageQueue = parsedMessage;
      }
    } catch (err) {
      console.error("Error reading message from Chrome:", err);
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
