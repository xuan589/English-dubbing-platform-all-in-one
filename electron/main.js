const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

let mainWindow = null;
let pythonProcess = null;

const BACKEND_PORT = 8765;
const FRONTEND_PORT = 5173;
const IS_DEV = process.env.NODE_ENV !== 'production';

function startPythonBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  const mainPy = path.join(backendDir, 'main.py');

  pythonProcess = spawn('python', [mainPy], {
    cwd: backendDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python] ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.log(`[Python] ${data}`);
  });

  pythonProcess.on('error', (err) => {
    console.error('无法启动 Python 后端:', err.message);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`Python 后端退出，代码: ${code}`);
  });

  return pythonProcess;
}

async function waitForBackend() {
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        const client = net.createConnection({ port: BACKEND_PORT }, () => {
          client.end();
          resolve();
        });
        client.on('error', reject);
        setTimeout(() => { client.destroy(); reject(new Error('timeout')); }, 1000);
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: '英语配音工具',
    backgroundColor: '#2C2C2C',
    icon: path.join(__dirname, '..', 'frontend', 'public', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const url = IS_DEV
    ? `http://localhost:${FRONTEND_PORT}`
    : `http://localhost:${BACKEND_PORT}`;

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // 启动 Python 后端
  console.log('启动 Python 后端...');
  startPythonBackend();
  await waitForBackend();
  console.log('Python 后端就绪');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});
