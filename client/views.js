// UI para a tela de contatos e mensagens

// Estilização igual do WPP
// Lista de contatos de um lado, ao clicar no contato abre o chat anterior com aquele contato
// Salvar em algum canto todas as mensagens enviada em uma conversa

const { app, BrowserWindow } = require('electron/main')

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,

    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
    }
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})