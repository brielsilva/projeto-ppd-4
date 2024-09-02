const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const amqp = require("amqplib");
const redis = require("redis");

const rabbitmq_url = process.env.RABBITMQ_URL || "amqp://localhost";
const host = process.env.REDIS_HOST || 'localhost';
const portRedis = process.env.REDIS_PORT || 6379;
const redis_client = redis.createClient({
    url: `redis://${host}:${portRedis}`
});

redis_client.on("error", (err) => {
    console.error("Redis error:", err);
});

(async () => {
    try {
        await redis_client.connect();
        console.log("Sucesso");
    } catch(err) {
        console.log("Erro ao se conectar: " + err);
    }
})();

const contacts = [];

// Load the protobuf
const PROTO_PATH = "./contacts.proto";
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {});
const proto = grpc.loadPackageDefinition(packageDefinition).contacts;

function saveContact(call, callback) {
    const { name, ip, status } = call.request;

    const existingContact = contacts.find(contact => contact.name === name);
    if (existingContact) {
        return callback(null, { message: "Contact already exists" });
    }

    const newContact = { name, ip, status };
    contacts.push(newContact);

    (async () => {
        try {
            const connection = await amqp.connect(rabbitmq_url);
            const channel = await connection.createChannel();
            const queue_name = `contacts_${name}`;
            await channel.assertQueue(queue_name, { durable: true });
            console.log(`Fila criada para o contato ${name}: ${queue_name}`);
            connection.close();
            consumeMessages(queue_name);
            return callback(null, { message: "Contact saved successfully", contact: newContact });
        } catch (err) {
            console.error(`Erro ao criar fila para o contato ${name}:`, err);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Failed to create contact queue"
            });
        }
    })();
}

function sendMessage(call, callback) {
    const { sendingTo, name, content, date } = call.request;

    if (!name || !content || !date || !sendingTo) {
        return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "Name, content, date, and sendingTo are required"
        });
    }

    const message = { sendingTo, name, content, date };
    const queue_name = `contacts_${sendingTo}`;

    publishMessage(message, queue_name);
    callback(null, { message: "Message sent successfully" });
}

async function publishMessage(message, queue_name) {
    try {
        const connection = await amqp.connect(rabbitmq_url);
        const channel = await connection.createChannel();
        await channel.assertQueue(queue_name, { durable: true });
        channel.sendToQueue(queue_name, Buffer.from(JSON.stringify(message)));
        console.log("Mensagem publicada na fila do RabbitMQ:", message);
        setTimeout(() => {
            connection.close();
        }, 500);
    } catch (err) {
        console.error("Erro ao publicar mensagem no RabbitMQ:", err);
    }
}

async function consumeMessages(queue_name) {
    try {
        const connection = await amqp.connect(rabbitmq_url);
        const channel = await connection.createChannel();
        await channel.assertQueue(queue_name, { durable: true });

        channel.consume(queue_name, (msg) => {
            if (msg !== null) {
                const message = JSON.parse(msg.content.toString());
                const contactName = message.sendingTo;
                redis_client.lPush(`contact:${contactName}:messages`, JSON.stringify(message));
                console.log("Mensagem recebida e armazenada no Redis:", message);
                channel.ack(msg);
            }
        });
    } catch (err) {
        console.error("Erro ao consumir mensagens do RabbitMQ:", err);
    }
}

function getMessages(call, callback) {
    const { name } = call.request;

    if (!name) {
        return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "Contact name is required"
        });
    }

    redis_client.lRange(`contact:${name}:messages`, 0, -1)
        .then((messages) => {
            console.log("messages off");
            console.log(messages);
            const parsedMessages = messages.map((message) => JSON.parse(message));
            console.log("PARSED MESSAGES");
            console.log(parsedMessages);

            // Callback com as mensagens
            callback(null, { messages: parsedMessages });

            // Limpar a fila e o cache Redis para aquele nome
            return clearQueueAndCache(name);
        })
        .catch((err) => {
            console.error("Failed to retrieve messages from Redis:", err);
            callback({
                code: grpc.status.INTERNAL,
                message: "Failed to retrieve messages from Redis"
            });
        });
}

async function clearQueueAndCache(name) {
    try {
        const queue_name = `contacts_${name}`;
        
        // Limpar a fila no RabbitMQ
        const connection = await amqp.connect(rabbitmq_url);
        const channel = await connection.createChannel();
        await channel.assertQueue(queue_name, { durable: true });
        await channel.purgeQueue(queue_name);
        console.log(`Fila ${queue_name} purgada com sucesso`);

        // Limpar o cache Redis
        await redis_client.del(`contact:${name}:messages`);
        console.log(`Cache Redis para contact:${name}:messages limpo com sucesso`);
        
        connection.close();
    } catch (err) {
        console.error(`Erro ao limpar fila e cache para ${name}:`, err);
    }
}

function searchContact(call, callback) {
    const { name } = call.request;

    const contact = contacts.find(contact => contact.name === name);

    if (contact) {
        callback(null, { contact });
    } else {
        callback({
            code: grpc.status.NOT_FOUND,
            message: "Contact not found"
        });
    }
}

function updateStatus(call, callback) {
    console.log("Calling Update Status")
    const { name, status } = call.request;

    let existingContact = contacts.find(contact => contact.name === name);
    console.log(existingContact)

    if (existingContact) {
        existingContact.status = status;
        console.log(contacts.find(contact => contact.name === name));
        callback(null, { contact: existingContact });
    } else {
        callback({
            code: grpc.status.NOT_FOUND,
            message: "Contact not found"
        });
    }
}

function main() {
    const server = new grpc.Server();
    server.addService(proto.ContactService.service, {
        SaveContact: saveContact,
        GetMessages: getMessages,
        SendMessage: sendMessage,
        SearchContact: searchContact,
        UpdateStatus: updateStatus,
    });
    server.bindAsync("0.0.0.0:3000", grpc.ServerCredentials.createInsecure(), () => {
        server.start();
        console.log("gRPC server running at http://localhost:3000");
    });
}

main();
