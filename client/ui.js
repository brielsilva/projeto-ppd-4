// Middlaware que conversa com o servidor e atualiza a UI
// const Service = require('./service')
const Service = require('./service-grpc')

class UiAdapter {
    constructor(username, status, port) {
        this.service = new Service(username, status, port, document);
        this.username = username;
        this.status = status;
    }

    async register(contactName, ip) {
        return await this.service.firstRegister(contactName, ip);
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

    handleContactList() {
        const contactListDOM = document.querySelector('.contact-list');

        while (contactListDOM.firstChild) {
            contactListDOM.removeChild(contactListDOM.firstChild);
        }
        console.log("Pegando nova lista")
        const contactList = this.service.getContacts();
        console.log("Nova lista: ")
        console.log(contactList)
        contactList.forEach(element => {
            const contactBox = document.createElement('div');
            contactBox.classList.add('contact');
            contactBox.style.background = element.status ? "white" : "gray";

            
            
            const contactName = document.createElement('span');
            contactName.innerHTML = element.name;
            contactName.style.background = element.status ? "white" : "gray";
            
            const contactContainer = document.createElement('div');
            contactContainer.style.width = '20px';
            contactContainer.style.height = '20px';
            contactContainer.style.cursor = 'pointer';
            contactContainer.appendChild(contactName);
            
            const removeButton = document.createElement('button');
            removeButton.innerHTML = "Remover";
            removeButton.classList.add('remove-btn');
            removeButton.style.marginLeft = "10px"; 
            contactBox.appendChild(contactContainer)
            contactBox.appendChild(removeButton);

            
            contactListDOM.appendChild(contactBox);
    
            
            contactContainer.addEventListener('click', (e) => {
                e.preventDefault();
                const contactInfo = document.querySelector('.contact-info');
                contactInfo.innerHTML = element.name;
                this.updateChatUI(element.name);
                contactBox.classList.remove('new-message'); 
            });
    
            
            removeButton.addEventListener('click', (e) => {
                e.preventDefault();
                
                this.service.removeContact(element.name);
                this.service.removeContactHistory(element.name);
                const contactInfo = document.querySelector('.contact-info');
                console.log("EXCLUINDO")
                console.log(contactInfo.innerHTML)
                console.log(element.name)
                if(contactInfo.innerHTML == element.name) {
                    document.querySelector('.contact-info').innerHTML = '';
                }
    
                
                this.handleContactList();
                document.querySelector('.contact-info').innerHTML = '';
            });
        });
    }

    async addNewContact(contactName) {
        const contactExist = this.service.getContacts().find((obj) => obj.name == contactName);
        if(contactExist) {
            this.handleContactList();
        } else {
            await this.service.registerContact(contactName)
            this.handleContactList();
        }

    }

    updateChatHistory() { }

    async changeStatus() {
        this.status = !this.status;
        return await this.service.updateStatus(this.status) // Impede que o Service receba mensagens
    }

    async handleChangeStatus() {
        const prevStatus = this.status;
        console.log("HANDLE CHANGE STATUS")
        const d = await this.changeStatus();
        console.log("APOS CHANGESTATUS")
        console.log(d);
        console.log("AQUI")
        if (!prevStatus) { // False indo para True
            // Chama o serviço para pegar mensagens novas na fila, isso vai chamar e atualizar o chatHistory
            // do serviço, permitindo que novas mensagens cheguem
            // Adicione na UI depois um símbolo de notificação
            await this.service.getMsgsOffline();
            document.querySelector('#messageForm').removeAttribute('disabled');
            document.querySelector('#btn-send').removeAttribute('disabled');
        } else {
            document.querySelector('#messageForm').setAttribute('disabled', true);
            document.querySelector('#btn-send').setAttribute('disabled', true);
        }
    };
    

    addNewMessage(contactName, content) {
        this.service.sendMessageSocket(contactName, content);
        this.updateChatUI(contactName);
    }

    

    updateChatUI(contactName) {
        if (document.querySelector('.contact-info').innerHTML !== contactName) {
            return;
        }
    
    
        const chatHistoryData = this.service.getHistory(contactName);
    
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
}

document.addEventListener("DOMContentLoaded", function () {

})

let uiAdapter;

let counter = 0;
document.addEventListener("DOMContentLoaded", function () {
    const modal = document.getElementById("contactModal");

    const form = document.getElementById("contactForm");
    const nameInput = document.getElementById("name");

    form.onsubmit = function (event) {
        event.preventDefault();
        const name = nameInput.value.trim();
        uiAdapter.addNewContact(name);
        uiAdapter.handleContactList();
        nameInput.value = ''
        modal.style.display = "none";
    };

    const btn = document.querySelector(".btn-add");

    const span = document.querySelector(".close");

    btn.onclick = function () {
        modal.style.display = "block";
        modal.classList.add('show');
        nameInput.tabIndex = 1;
        requestAnimationFrame(() => {
            nameInput.focus();
        });
        nameInput.focus();
    }

    span.onclick = function () {
        modal.classList.remove('show');
        nameInput.value = ''
    }

    window.onclick = function (event) {
        if (event.target == modal) {
            modal.classList.remove('show');
        }
    }
});

const minPort = 4000;
const maxPort = 5000;

async function getLocalIPAddress() {
    return new Promise((resolve, reject) => {
        const pc = new RTCPeerConnection({iceServers: []});
        pc.createDataChannel("");
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .catch(err => reject(err));

        pc.onicecandidate = (event) => {
            if (event && event.candidate && event.candidate.candidate) {
                const candidate = event.candidate.candidate;
                const regex = /(?:\d{1,3}\.){3}\d{1,3}/;
                const ipMatch = candidate.match(regex);
                if (ipMatch) {
                    resolve(ipMatch[0]);
                    pc.close();
                }
            }
        };

        setTimeout(() => {
            pc.close();
            reject(new Error("Failed to retrieve IP address"));
        }, 1000);
    });
}



document.addEventListener("DOMContentLoaded", async function () {
    const port = Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;
    let ipAddres = ''
    try {
        ipAddress = await getLocalIPAddress();
    } catch (e) {
        ipAddres = 'localhost'
    }
    const host = ipAddress + ":" + port;
    const modal = document.getElementById("nameModal");

    
    const form = document.getElementById("nameForm");
    const nameInput = document.getElementById("name-user");
    const errorMessage = document.getElementById("error-message");

    form.onsubmit = async function (event) {
        event.preventDefault(); 

        const name = nameInput.value.trim();

        if (name.length >= 3) {
            alert("Nome recebido: " + name);
            document.querySelector('.user-name').innerHTML = name
            modal.classList.remove('show');
        } else {
            errorMessage.style.display = "block"; 
        }

        uiAdapter = new UiAdapter(name, true, port);
        const response = await uiAdapter.register(name, host);
        console.log(response);
        uiAdapter.handleContactList()
    };
});


document.getElementById('messageForm').addEventListener('submit', function (event) {
    event.preventDefault();

    const messageInput = document.getElementById('message');
    const message = messageInput.value.trim();

    const name = document.querySelector('.contact-info').innerHTML;

    if (message) {
        console.log('Mensagem enviada:', message);

        uiAdapter.addNewMessage(name, message)

        
        messageInput.value = '';
    }
});

document.getElementById("toggleStatus").addEventListener("click", function() {
    const statusText = document.getElementById("statusText");
    uiAdapter.handleChangeStatus();
    if (statusText.textContent === "Online") {
        statusText.textContent = "Offline";
    } else {
        statusText.textContent = "Online";
    }
});