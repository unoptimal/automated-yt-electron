const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
// RE-ADDED: A variable to hold the target window title from the Chrome extension.
let targetWindowTitle = '';
let messageQueue = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-finish-load', () => {
    console.log("Renderer has finished loading.");
    if (messageQueue) {
      console.log("Processing queued message:", messageQueue.status);
      mainWindow.webContents.send('from-chrome', messageQueue);
      messageQueue = null;
    }
  });
}

app.whenReady().then(() => {
  // RE-ADDED: The handler that automatically selects the screen source.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });

    if (!targetWindowTitle) {
      console.error("Target window title not set. Cannot select a source.");
      return callback({});
    }

    console.log(`Searching for window with title including: "${targetWindowTitle}"`);
    const targetSource = sources.find(s => s.name.includes(targetWindowTitle));

    if (targetSource) {
      console.log("✅ Found matching screen source:", targetSource.name);
      // Approve this source for video and add system audio via 'loopback'.
      callback({ video: targetSource, audio: 'loopback' });
    } else {
      console.error(`❌ Could not find a source with title: "${targetWindowTitle}"`);
      callback({});
    }
  });

  ipcMain.handle('save-file', (event, { buffer, name }) => {
    const fileBuffer = Buffer.from(buffer);
    const filePath = path.join(app.getPath('downloads'), name);
    fs.writeFile(filePath, fileBuffer, (err) => {
      if (err) console.error("Failed to save file:", err);
      else console.log(`✅ Saved video to ${filePath}`);
    });
    return filePath;
  });

  createWindow();
  listenForMessages();
});

function listenForMessages() {
  process.stdin.on('data', (data) => {
    try {
      const messageLength = data.readUInt32LE(0);
      const message = data.toString('utf-8', 4, 4 + messageLength);
      const parsedMessage = JSON.parse(message);

      // UPDATED: Store the title when a PLAY signal is received.
      if (parsedMessage.status === "PLAY" && parsedMessage.title) {
        targetWindowTitle = parsedMessage.title;
        console.log(`Set target window title to: "${targetWindowTitle}"`);
      }
      
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send('from-chrome', parsedMessage);
      } else {
        messageQueue = parsedMessage;
      }
    } catch (err) {
      console.error("Error reading message from Chrome:", err);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});