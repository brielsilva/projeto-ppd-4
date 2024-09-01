const Service = require('./service')

const chat = new Service('Gabriel');

chat.registerContact('Leo')

chat.updateHistory('Leo', 'Hey man', false);

console.log(chat.getHistory('Leo'))
