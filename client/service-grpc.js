const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const net = require("node:net");

class Api {
    constructor() {
        const PROTO_PATH = "contacts.proto";
        const packageDefinition = protoLoader.loadSync(PROTO_PATH, {});
        const proto = grpc.loadPackageDefinition(packageDefinition).contacts;
        
        this.client = new proto.ContactService(
            "localhost:3000",
            grpc.credentials.createInsecure()
        );
    }

    register(contactName, ip) {
        return new Promise((resolve, reject) => {
            const request = { name: contactName, ip: ip, status: true }; // status is now a boolean
            this.client.SaveContact(request, (error, response) => {
                if (error) {
                    return reject(error);
                }
                resolve(response);
            });
        });
    }

    searchContactName(contactName) {
        return new Promise((resolve, reject) => {
            const request = { name: contactName };
            this.client.SearchContact(request, (error, response) => {
                if (error) {
                    return reject(error);
                }
                // Convert the status from string to boolean
                if (response.contact) {
                    response.contact.status = response.contact.status === "true";
                }
                resolve(response.contact);
            });
        });
    }

    retrieveMsgOffline(contactName) {
        console.log("RETRIEVING MSG OFFLINE")
        return new Promise((resolve, reject) => {
            const request = { name: contactName };
            this.client.GetMessages(request, (error, response) => {
                if (error) {
                    return reject(error);
                }
                resolve(response.messages);
            });
        });
    }

    sendMessageOffline(sendingTo, name, content, date) {
        return new Promise((resolve, reject) => {
            const request = { sendingTo, name, content, date };
            this.client.SendMessage(request, (error, response) => {
                if (error) {
                    return reject(error);
                }
                resolve(response);
            });
        });
    }

    updateStatus(status, name) {
        return new Promise((resolve, reject) => {
            const request = { status: status, name }; // status is now a boolean
            this.client.UpdateStatus(request, (error, response) => {
                if (error) {
                    return reject(error);
                }
                resolve(response);
            });
        });
    }
}

class Service {
    constructor(username, status, port, document) {
        this.api = new Api();
        this.username = username;
        this.contactList = [];
        this.contactHistory = [];
        this.status = !!status; // Ensure status is a boolean
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

    connectTo(address, contactName, sendKnownHosts = true, loopback = false, status = true, add = true) {
        return new Promise((resolve, reject) => {
            const splittedAddress = address.split(":");
    
            if (splittedAddress.length < 2) {
                return reject(new Error("Invalid host address. Expected host:port"));
            }
    
            const port = splittedAddress.splice(-1, 1)[0];
            const host = splittedAddress.join(":");
    
            const socket = net.createConnection({ port, host }, () => {
                this.contactList.push({ name: contactName, connection: socket, status: !!status }); // Ensure status is a boolean
                this.listenClientData(socket);
                this.sendFirstMessage(socket, this.port, loopback, host, port, contactName, this.status);
                if (add) {
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
            return;
        }

        const remoteAddress = socket.remoteAddress;
        const { myPort, name, status } = data;
        console.log("DATA HANDLE FIRST MESSAGE")
        console.log(name)
        console.log(status)
        console.log(remoteAddress)
        console.log(myPort)

        if (!data.loopback) {
            this.connectTo(`${remoteAddress}:${myPort}`, name, true, true, status, false);
        }
    }

    sendFirstMessage(socket, myPort, loopback = false, host, port, contactName) {
        if (this.firstMessageSent && this.contactList.map((obj) => obj.port).includes(port)) {
            return;
        }
        if (this.contactList.find((obj) => obj.name == contactName)["port"] == undefined) {
            this.contactList.find((obj) => obj.name == contactName)["port"] = port;
        }

        const obj = {
            type: "first",
            myPort,
            loopback,
            host,
            status: this.status, // status is already a boolean
            name: this.username
        };

        this.firstMessageSent = true;

        this.sendMessage(socket, JSON.stringify(obj));
    }

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

    async sendMessageSocket(contactName, content) {
        console.log("Searching Contact")
        const contact = this.contactList.find((obj) => obj.name === contactName);

        if (!contact) {
            throw new Error('Contato não existe');
        }

        console.log(contact)

        if (contact.status) { // status is a boolean
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
            this.updateHistory(contactName, content, false);
            await this.api.sendMessageOffline(contactName, this.username, content, new Date());
        }
    }

    async updateStatus(status) {
        this.status = !!status;
        console.log("UPDATE STATUS BROADCAST")
        console.log(this.status)
        this.broadcastMessage(JSON.stringify({ type: "status", status: this.status, name: this.username }));
        return await this.api.updateStatus(this.status, this.username);
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
            let contact = this.contactList.find((obj) => obj.name === message.name);
            if (!contact) {
                this.contactList.push({ name: message.name, connection: socket, status: true });
                this.contactHistory.push({ name: message.name, history: [] });
                this.handleContactList();
            }
            contact = this.contactList.find((obj) => obj.name === message.name);
            if (!contact) {
                this.contactList.push({ name: message.name, connection: socket, status: true });
            }

            let history = this.contactHistory.find((obj) => obj.name == message.name);
            if (!history) {
                this.contactHistory.push({ name: message.name, history: [] });
                history = this.contactHistory.find((obj) => obj.name == message.name);
            }
            this.updateHistory(message.name, message.content, true);
            this.updateChatUI(message.name);
            this.notifyNewMessage(message.name);
            this.handleContactList();
        }

        if (type === "status") {
            console.log("STATUS")
            const contact = this.contactList.find((obj) => obj.name == data.name);
            console.log(data.status)
            if (contact) {
                contact.status = data.status; // Convert status to boolean
                this.handleContactList();
            }
        }
    }

    onConnection(socket) {}

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

    async registerContact(contactName) {
        try {
            const contactExists = await this.api.searchContactName(contactName);

            if (contactExists) {
                const history = this.getHistory(contactName);
                if (!history) {
                    this.contactHistory.push({ name: contactName, history: [] });
                }
                await this.connectTo(contactExists.ip, contactName, false, false, contactExists.status);

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
            contact.connection.end();
        }

        console.log(`Contato ${contactName} removido da lista de contatos.`);
    }

    removeContactHistory(contactName) {
        this.contactHistory = this.contactHistory.filter(history => history.name !== contactName);

        console.log(`Histórico de mensagens do contato ${contactName} removido.`);
    }

    handleContactList() {
        const contactListDOM = document.getElementsByClassName('contact-list')[0];

        while (contactListDOM.firstChild) {
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
                this.removeContact(element.name);
                this.removeContactHistory(element.name);
                const contactInfo = document.querySelector('.contact-info');
                if (contactInfo.innerHTML == element.name) {
                    contactInfo.innerHTML = '';
                }

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

    updateHistory(contactName, content, recieve = true, date) {
        const existContact = this.contactList.find((obj) => obj.name == contactName);
        if (!existContact) {
            throw new Error('Contato não existe');
        }
        let history = this.contactHistory.find((obj) => obj.name == contactName);
        if (!history) {
            this.contactHistory.push({ name: contactName, history: [] });
            history = this.contactHistory.find((obj) => obj.name == contactName);
        }
        history['history'].push({ name: recieve ? contactName : this.username, content, date: date ? date : new Date(Date.now()) });
    }

    getHistory(contactName) {
        return this.contactHistory.find((obj) => obj.name == contactName);
    }

    getContacts() {
        return this.contactList.map(obj => ({ name: obj['name'], status: obj['status'] }));
    }

    async getMsgsOffline() {
        try {
            const messages = await this.api.retrieveMsgOffline(this.username);
            if(messages) {
                messages.sort((a, b) => new Date(a.date) - new Date(b.date));
            }

            for (const message of messages) {
                const { sendingTo, name, content, date } = message;

                if (sendingTo !== this.username) {
                    continue;
                }

                let contactExists = this.contactList.find(contact => contact.name === name);

                if (!contactExists) {
                    contactExists = await this.registerContact(name);
                }

                let history = this.getHistory(name);
                if (!history) {
                    this.contactHistory.push({ name: name, history: [] });
                    history = this.getHistory(name);
                }

                const messageExists = history.history.some(hist =>
                    hist.content === content && new Date(hist.date).getTime() === new Date(date).getTime()
                );

                if (!messageExists) {
                    this.updateHistory(name, content, true, date);
                    this.updateChatUI(name);
                    this.notifyNewMessage(name);
                }
            }

            this.handleContactList();
        } catch (error) {
            console.error("Erro ao recuperar mensagens offline:", error);
        }
    }
}

module.exports = Service;
