// Implementação da lógica de tal forma que na view so seja chamada as funções com os argumentos necessários
// Comunicação com o Servidor
const net = require('node:net'); 


class Api {
    constructor() {
        this.vm_url = "http://192.168.56.1:3000"
        this.url = "http://localhost:3000";
    }

    async register(contactName, ip) {
        const endpoint = "/save";
        const body = {
            name: contactName,
            ip: ip,
            status: true
        };

        const json = JSON.stringify(body);
        try {
            const response = await fetch(this.url + endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: json
            });
            return response.json();
        } catch (e) {
            if (e.message.includes('Failed to fetch') || e.message.includes('ERR_CONNECTION_REFUSED')) {
                const response = await fetch(this.vm_url + endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: json
                });
                return response.json();
            } else {
                throw e;
            }
        }
    }

    async searchContactName(contactName) {
        const endpoint = "/search?name=" + contactName;
        try {
            const response = await fetch(this.url + endpoint)
            const data = await response.json();
            return data;
        } catch (e) {
            if (e.message.includes('Failed to fetch') || e.message.includes('ERR_CONNECTION_REFUSED')) {
                const response = await fetch(this.vm_url + endpoint);
                const data = await response.json();
                return data;
            } else {
                throw e;
            }
        }
    }

    async retrieveMsgOffline(contactName) {
        const endpoint = `/messages?name=${contactName}`;

        try {
            const response = await fetch(this.url + endpoint);
            if (!response.ok) {
                throw new Error('Failed to retrieve offline messages');
            }

            const data = await response.json();
            return data.messages;
        } catch (error) {
            if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION_REFUSED')) {
                const response = await fetch(this.vm_url + endpoint);
                if (!response.ok) {
                    throw new Error('Failed to retrieve offline messages');
                }

                const data = await response.json();
                return data.messages;
            } else {
                console.error('Error retrieving offline messages:', error);
                return [];
            }
        }
    }

    async sendMessageOffline(sendingTo, name, content, date) {
        const endpoint = "/message";
        const body = {
            sendingTo,
            name,
            content,
            date
        };

        try {
            const response = await fetch(this.url + endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            return response.json();
        } catch (e) {
            if (e.message.includes('Failed to fetch') || e.message.includes('ERR_CONNECTION_REFUSED')) {
                const response = await fetch(this.vm_url + endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                return response.json();
            } else {
                throw e;
            }
        }
    }

    async updateStatus(status, name) {
        const endpoint = "/status?name=" + name;
        const body = {
            status: status
        };
        try {
            const response = await fetch(this.url + endpoint, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            return await response.json();
        } catch (e) {
            if (e.message.includes('Failed to fetch') || e.message.includes('ERR_CONNECTION_REFUSED')) {
                const response = await fetch(this.vm_url + endpoint, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                return response.json();
            } else {
                console.log(e);
                throw e;
            }
        }
    }
}



class Service {
    constructor(username,status,port,document, vm) {
        this.api = new Api(vm);
        this.username = username;
        this.contactList = []; // Lista de Nomes
        this.contactHistory = []; // Lista de Objetos com {Name: [{name,content}]]}
        this.status = status;
        this.port = port;
        this.document = document;
        this.firstMessageSent = false;

        const server = net.createServer((socket) =>
            this.handleClientConnection(socket)
        );

        server.listen(port, () => console.log("Listening on port: ", port));
    }

    handleClientConnection(socket) {
        socket.firstMessageSent = false;
        this.listenClientData(socket);
    }

    getHostObj(host, port) {
        return { host, port };
    }

    connectTo(address, contactName, sendKnownHosts = true, loopback = false, status=true, add=true) {
        return new Promise((resolve, reject) => {
            const splittedAddress = address.split(":");
    
            if (splittedAddress.length < 2) {
                return reject(new Error("Invalid host address. Expected host:port"));
            }
    
            const port = splittedAddress.splice(-1, 1)[0];
            const host = splittedAddress.join(":");
    
            const socket = net.createConnection({ port, host }, () => {
                this.contactList.push({name: contactName, connection: socket, status: status});
                this.listenClientData(socket);
                this.sendFirstMessage(socket, this.port, loopback, host, port, contactName, this.status);
                if(add) {
                    this.handleContactList();
                }
                resolve();
            });
    
            socket.on('error', (err) => {
                reject(err);
            });
        });
    }

    handleFirstMessage(socket, data) {
        if (data.type !== "first") {
            return;
        }

        if (this.firstMessageSent) {
            // If this socket has already sent the first message, return to avoid looping
            return;
        }


        const remoteAddress = socket.remoteAddress;
        const { myPort, name, status } = data;
        
        const hostObj = this.getHostObj(remoteAddress, myPort);
        //this.handleContactList();

        if (!data.loopback) {
            this.connectTo(`${remoteAddress}:${myPort}`, name, true, true, status,false);
        }
    }

    sendFirstMessage(socket, myPort, loopback = false, host,port, contactName) {
        if (this.firstMessageSent && this.contactList.map((obj) => obj.port).includes(port)) {
            return; // Prevent sending the first message again if it was already sent
        }
        if(this.contactList.find((obj) => obj.name == contactName )["port"] == undefined) {
            this.contactList.find((obj) => obj.name == contactName )["port"] = port;
        }

        const obj = {
            type: "first",
            myPort,
            loopback,
            host,
            status: this.status,
            name: this.username
        };

        this.firstMessageSent = true; 

        this.sendMessage(socket, JSON.stringify(obj));
    }

    // Função que implementa a escuta de novas mensagens
    listenClientData(socket) {
        this.onConnection(socket);

        socket.on("data", (bufferData) => {
            const jsonData = bufferData.toString();
            const data = JSON.parse(jsonData);

            this.onData(socket, data);

            this.handleFirstMessage(socket, data);
        });
    }

    async firstRegister(contactName, ip) {
        return await this.api.register(contactName, ip);
    }
    // Via socket
    async sendMessageSocket(contactName, content) {
        const contact = this.contactList.find((obj) => obj.name === contactName);
    
        if (!contact) {
            throw new Error('Contato não existe');
        }
    
        // Verifica o status do contato
        if (contact.status) {
            const body = {
                type: "message",
                message: {
                    content: content,
                    name: this.username
                }
            };
            this.updateHistory(contactName, content, false);
            this.sendMessage(contact.connection, JSON.stringify(body));
        } else {
            // Se o status for false, envia a mensagem para o servidor
            this.updateHistory(contactName, content, false);
            await this.api.sendMessageOffline(contactName, this.username, content, new Date());
        }
    }

    async updateStatus(status) {
        this.status = status
        this.broadcastMessage(JSON.stringify({type: "status", status: this.status, name: this.username}));
        return await this.api.updateStatus(status,this.username);
    }

    notifyNewMessage(contactName) {
        const contactElements = document.getElementsByClassName('contact');
        for (let contactBox of contactElements) {
            const contactNameElement = contactBox.querySelector('span');
            if (contactNameElement && contactNameElement.innerHTML === contactName) {
                contactBox.classList.add('new-message');
            }
        }
    }


    onData(socket, data) {
        const { remoteAddress } = socket;
        const type = data.type;
        if (type === "message") {
            const message = data.message;
            // Verifica se o contato já existe na lista de contatos
            let contact = this.contactList.find((obj) => obj.name === message.name);
            if (!contact) {
                // Adiciona o contato à lista se ainda não existir
                this.contactList.push({ name: message.name, connection: socket, status: true });
                this.contactHistory.push({ name: message.name, history: [] });
                console.log(`Contato ${message.name} adicionado após o envio da mensagem.`);
                this.handleContactList(); // Atualiza a lista de contatos na UI
            }
            contact = this.contactList.find((obj) => obj.name === message.name);
            if(!contact) {
                this.contactList.push({ name: message.name, connection: socket, status: true });
            }

            let history = this.contactHistory.find((obj) => obj.name == message.name);
            if(!history) {
                this.contactHistory.push({ name: message.name, history: [] });
                history = this.contactHistory.find((obj) => obj.name == message.name);
            }
            this.updateHistory(message.name, message.content, true);
            this.updateChatUI(message.name);
            this.notifyNewMessage(message.name)
            this.handleContactList(); // Atualiza a lista de contatos na UI
        }
    
        if (type === "status") {
            const contact = this.contactList.find((obj) => obj.name == data.name);
            if(contact) {
                contact.status = data.status;
                this.handleContactList();
            }
        }
    }

    onConnection(socket) {

    }

    // Enviar o nome e o status para cada um
    broadcastMessage(jsonData) {
        this.contactList.map((obj) => obj.connection).forEach((socket) => this.sendMessage(socket, jsonData));
    }

    sendMessage(socket, jsonData) {

        try {
            if (!socket._writableState.ended) {
                socket.write(jsonData);
            }
        } catch (e) {
            console.log("Algum erro?");
            console.log(e);
        }
    }

    // Registrar meus contatos
    // Vou receber o nome do cantato e atrelar ao usuário
    async registerContact(contactName) {
        try {
            // Primeiro, busca o contato no servidor
            const contactExists = await this.api.searchContactName(contactName);

            // Se o contato existir no servidor, adiciona à lista de contatos
            if (contactExists) {
                const history = this.getHistory(contactName);
                if(!history) {
                    this.contactHistory.push({ name: contactName, history: [] });    
                }
                await this.connectTo(contactExists.ip,contactName, false,false,contactExists.status);

                console.log(`Contact ${contactName} has been registered.`);
                return true;
            } else {
                console.log(`Contact ${contactName} does not exist in the server.`);
            }
        } catch (error) {
            console.error("Error searching for contact:", error);
        }
    }

    removeContact(contactName) {
        this.contactList = this.contactList.filter(contact => contact.name !== contactName);
        const contact = this.contactList.find(contact => contact.name === contactName);
        if (contact && contact.connection) {
            contact.connection.end(); // Encerra a conexão do socket, se ainda existir
        }
    
        console.log(`Contato ${contactName} removido da lista de contatos.`);
    }

    removeContactHistory(contactName) {
        this.contactHistory = this.contactHistory.filter(history => history.name !== contactName);
        
        console.log(`Histórico de mensagens do contato ${contactName} removido.`);
    }

    handleContactList() {
        
        const contactListDOM = document.getElementsByClassName('contact-list')[0];
        
        while(contactListDOM.firstChild) {
            contactListDOM.removeChild(contactListDOM.firstChild);
        }
        const contactList = this.getContacts();
        contactList.forEach(element => {
            const contactBox = document.createElement('div');
            contactBox.classList.add('contact');
            contactBox.style.background = element.status ? "white" : "gray";

            const contactName = document.createElement('span');
            contactName.innerHTML = element.name;
            contactName.style.background = element.status ? "white" : "gray";
            contactBox.appendChild(contactName);
    
            const removeButton = document.createElement('button');
            removeButton.innerHTML = "Remover";
            removeButton.classList.add('remove-btn');
            removeButton.style.marginLeft = "10px";
            contactBox.appendChild(removeButton);

            contactListDOM.appendChild(contactBox);
    
            contactBox.addEventListener('click', (e) => {
                e.preventDefault();
                const contactInfo = document.querySelector('.contact-info');
                contactInfo.innerHTML = element.name;
                this.updateChatUI(element.name);
                contactBox.classList.remove('new-message');
            });
    
            removeButton.addEventListener('click', (e) => {
                e.preventDefault();
                //
                this.removeContact(element.name);
                this.removeContactHistory(element.name);
                const contactInfo = document.querySelector('.contact-info');
                if(contactInfo.innerHTML == element.name) {
                    contactInfo.innerHTML = '';
                }
    
                // Atualiza a lista de contatos
                this.handleContactList();
            });
        });
    }


    updateChatUI(contactName) {
        if (document.querySelector('.contact-info').innerHTML !== contactName) {
            return;
        }
    
        const chatHistoryData = this.getHistory(contactName);
    
    
        const chatHistory = document.querySelector('.chat-history');
    
        chatHistory.innerHTML = '';
    
        if (chatHistoryData && chatHistoryData.history) {
            chatHistoryData.history.sort((a, b) => new Date(a.date) - new Date(b.date));
    
            chatHistoryData.history.forEach(message => {
                const messageContainer = document.createElement('div');
                messageContainer.className = 'chat-message';
                messageContainer.setAttribute('target', message.name === this.username ? 'self' : 'other');
    
                const messageText = document.createElement('span');
                messageText.textContent = message.content;
    
                messageContainer.appendChild(messageText);
                chatHistory.appendChild(messageContainer);
            });
    
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }
    }


    // Vai ser chamado tanto ao receber uma mensagem, quanto ao enviar uma mensagem
    // Recieve = true => Recebi, false => Enviando
    updateHistory(contactName,content, recieve = true, data) {
        const existContact = this.contactList.find((obj) => obj.name == contactName);
        if(!existContact) {
            throw new Error('Contato não existe');
        }
        // Verifica se o contato está online ou não
        // Envia diretamente se conseguir, se não envia pro servidor
        let history = this.contactHistory.find((obj) => obj.name == contactName);
        if(!history) {
            this.contactHistory.push({name: contactName, history: []});
            history = this.contactHistory.find((obj) => obj.name == contactName);
        }
        history['history'].push({name:  recieve ? contactName : this.username, content, data: data ? data : new Date(Date.now())});
    }

    // Buscar o histórico de mensagens com X contato
    getHistory(contactName) {
        // Pega as mensages na memória e tbm na fila e retorna a mais atualizada
        return this.contactHistory.find((obj) => obj.name == contactName);
    }
    
    // Pegar todos os contatos atuais
    getContacts() {
        return this.contactList.map(obj => ({ name: obj['name'], status: obj['status'] }));
    }

    async getMsgsOffline() {
        try {
        
            const messages = await this.api.retrieveMsgOffline(this.username);
            messages.sort((a, b) => new Date(a.date) - new Date(b.date))
            
            for (const message of messages) {
                console.log("MENSAGEM RECEBIDA DO SERVIDOR OFFLINE")
                console.log(message)
                const { sendingTo, name, content, date } = message;
    
                if (sendingTo !== this.username) {
                    continue;
                }
    
                console.log(this.contactList)
                let contactExists = this.contactList.find(contact => contact.name === name);
    
                if (!contactExists) {
                    contactExists = await this.registerContact(name);
                    console.log(contactExists)
                }
    
                let history = this.getHistory(name);
                if (!history) {
                    this.contactHistory.push({ name: name, history: [] });
                    history = this.getHistory(name);
                }
    
                const messageExists = history.history.some(hist => 
                    hist.content === content && new Date(hist.date).getTime() === new Date(date).getTime()
                );
                
                console.log("Mensagem existe?", messageExists);
                
                if (!messageExists) {
                    console.log("Chamando updateHistory");
                    
                    this.updateHistory(name, content, true, date);
                    this.updateChatUI(name);
                    this.notifyNewMessage(name);
                } else {
                    console.log("Mensagem duplicada não adicionada:", content);
                }
            }
    
            console.log("Mensagens offline recuperadas e histórico atualizado.");
            this.handleContactList()
        } catch (error) {
            console.error("Erro ao recuperar mensagens offline:", error);
        }
    }
}

module.exports = Service