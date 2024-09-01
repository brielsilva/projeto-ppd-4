const express = require("express");
const amqp = require("amqplib");
const redis = require("redis");
const app = express();
const port = 3000;

const rabbitmq_url = process.env.RABBITMQ_URL || "amqp://localhost";
const host = process.env.REDIS_HOST || 'localhost';
const portRedis = process.env.REDIS_PORT || 6379;
const redis_client = redis.createClient({
    url: `redis://${host}:${portRedis}`
    // host: process.env.REDIS_HOST || 'localhost',
    // port: process.env.REDIS_PORT || 6379
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

// Middleware para parsear JSON no corpo da requisição
app.use(express.json());

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

// Lista interna para armazenar os dados dos contatos
let contacts = [];

app.put("/status", (req,res) => {

    const { name } = req.query;

    const {status} = req.body;

    const existingContact = contacts.find(contact => contact.name === name);

    existingContact['status'] = status;

    return res.status(201).json(existingContact);
})

app.post("/save", async (req, res) => {
    const { name, ip, status } = req.body;

    // Verifica se o contato já existe
    const existingContact = contacts.find(contact => contact.name === name);
    if (existingContact) {
        return res.status(400).json({ error: "Contact already exists" });
    }

    // Adiciona o novo contato à lista
    const newContact = { name, ip, status };
    contacts.push(newContact);

    console.log(contacts)

    try {
        const connection = await amqp.connect(rabbitmq_url);
        const channel = await connection.createChannel();
        const queue_name = `contacts_${name}`;
        await channel.assertQueue(queue_name, { durable: true });
        console.log(`Fila criada para o contato ${name}: ${queue_name}`);
        connection.close();
    } catch (err) {
        console.error(`Erro ao criar fila para o contato ${name}:`, err);
        return res.status(500).json({ error: "Failed to create contact queue" });
    }

    consumeMessages(`contacts_${name}`);  // Começar a consumir mensagens para essa fila

    return res.status(201).json({ message: "Contact saved successfully", contact: newContact });
});

app.post("/message", (req, res) => {
    const { sendingTo, name, content, date } = req.body;

    if (!name || !content || !date || !sendingTo) {
        return res.status(400).json({ error: "Name, content, date, and sendingTo are required" });
    }

    const message = { sendingTo, name, content, date };
    const queue_name = `contacts_${sendingTo}`;
    publishMessage(message, queue_name);

    return res.status(201).json({ message: "Message sent successfully" });
});

app.get("/messages", async (req, res) => {
    const { name } = req.query;

    if (!name) {
        return res.status(400).json({ error: "Contact name is required" });
    }
    try {
        const messages = await redis_client.lRange(`contact:${name}:messages`, 0, -1);
        const parsedMessages = messages.map((message) => JSON.parse(message));
        return res.status(200).json({ messages: parsedMessages });
    } catch (err) {
        console.error("Failed to retrieve messages from Redis:", err);
        return res.status(500).json({ error: "Failed to retrieve messages from Redis" });
    }
});

app.get("/search", (req, res) => {
    const { name } = req.query;

    const contact = contacts.find(contact => contact.name === name);

    if (contact) {
        return res.status(200).json(contact);
    } else {
        return res.status(404).json({ error: "Contact not found" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
