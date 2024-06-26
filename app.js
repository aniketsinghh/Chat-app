// Requires
var favicon = require('serve-favicon');
var s = require("underscore.string");
var readline = require('readline');
var express = require('express');
<<<<<<< HEAD
var colors = require('colors');
=======
>>>>>>> 3d5e683 (v0.20.27 - Updated logging function and fixed localStorage emoji issue)
var sockjs = require('sockjs');
var https = require('https');
var chalk = require('chalk');
var path = require('path');
var fs = require('fs');

//Library Wrappers
var pack = require("./package.json");
var logger = require('./lib/logger/');
var mysql = require('./lib/mysql/');

//Middleware
var loginCheck = require('./middleware/loginCheck.js');

//Routes
var routes = require('./routes/index.js');

//App
var app = express();

// Variables
var config = {
    log: true,
    readline: false, //This is breaking on some machines, also to be deprecated with express routes.
    ipadr: '127.0.0.1',
    port: 3000,
    ssl: false
};

var logInfo    = chalk.bold.blue('[Info] ');
var logStop    = chalk.bold.red.dim('[Stop] ');
var logPM      = chalk.bold.yellow.dim('[PM] ');
var logError   = chalk.bold.red.dim('[Error] ');
var logSocket  = chalk.bold.magenta('[Socket] ');
var logStart   = chalk.bold.green.dim('[Start] ');
var logMessage = chalk.bold.cyan.dim('[Message] ');

var lastTime = [];
var rateLimit = [];
var currentTime = [];
var rateInterval = [];

var chat = sockjs.createServer();
var clients = [];
var users = {};
var bans = [];
var uid = 1;

var alphanumeric = /^\w+$/;


// Config
if(config.ssl) {
    var options = {
        key: fs.readFileSync('/path/to/your/ssl.key'),
        cert: fs.readFileSync('/path/to/your/ssl.crt')
    },
    server = https.createServer(options);
}

if(config.readline) {
    var rl = readline.createInterface(process.stdin, process.stdout);
    rl.setPrompt('[--:--:--][CONSOLE] ');
    rl.prompt();
}


// Express
//app.use(logger.express);
app.set('view engine', 'ejs');
app.use(favicon(__dirname + '/public/img/favicon.png'));

//Login Check
app.use(loginCheck);
/*
Sets up res.locals.user object to be used.
res.locals.user.logged_in contains boolean for logged_in user.
*/

//Routes
app.use('/chat', express.static(__dirname + '/public'));
app.get('/chat', function (req, res) {
    res.render('pages/index', {version:pack.version});
});

app.use('/', function(req, res, next){
    res.redirect('/chat'); //Temp redirect pre-login
});
      

// Connections
var server = app.listen(config.port, config.ipadr, function() {
    var host = server.address().address,
        port = server.address().port;

    consoleLog(logStart, 'Listening at http://' + host + ':' + port);
});

chat.on('connection', function(conn) {
    consoleLog(logSocket, chalk.underline(conn.id) +': connected');
    rateLimit[conn.id] = 1;
    lastTime[conn.id] = Date.now();
    currentTime[conn.id] = Date.now();

    clients[conn.id] = {
        id: uid,
        un: null,
        ip: conn.headers['x-forwarded-for'],
        role: 0,
        con: conn
    };

    users[uid] = {
        id: uid,
        oldun: null,
        un: null,
        role: 0
    };
    
    if(bans.indexOf(clients[conn.id].ip) > -1) {
        conn.write(JSON.stringify({type:'server', info:'rejected', reason:'banned'}));
        conn.close();
    }

    conn.write(JSON.stringify({type:'server', info:'clients', clients:users}));
    conn.write(JSON.stringify({type:'server', info:'user', client:users[uid]}));
    conn.on('data', function(message) {
        currentTime[conn.id] = Date.now();
        rateInterval[conn.id] = (currentTime[conn.id] - lastTime[conn.id]) / 1000;
        lastTime[conn.id] = currentTime[conn.id];
        rateLimit[conn.id] += rateInterval[conn.id];

        if(rateLimit[conn.id] > 1)
            rateLimit[conn.id] = 1;
        if(rateLimit[conn.id] < 1 && JSON.parse(message).type != 'delete' && JSON.parse(message).type != 'typing' && JSON.parse(message).type != 'ping')
            return conn.write(JSON.stringify({type:'server', info:'spam'}));
        else {
            try {
                var data = JSON.parse(message);

                if(data.type == 'ping') return false;
                if(data.type == 'typing') return sendToAll({type:'typing', typing:data.typing, user:clients[conn.id].un});
                if(data.type == 'delete' && clients[conn.id].role > 0) sendToAll({type:'server', info:'delete', mid:data.message});
                if(data.type == 'update') return updateUser(conn.id, data.user);
                if(data.type == 'pm') consoleLog(logMessage, '[PM] ' + chalk.underline(clients[conn.id].un) + ' to ' + chalk.underline(data.extra) + ': ' + data.message);
                else consoleLog(logMessage, '[' + data.type.charAt(0).toUpperCase() + data.type.substring(1) + '] ' + chalk.underline(clients[conn.id].un) + ': ' + data.message);

                handleSocket(clients[conn.id], message);
            } catch(err) {
                return consoleLog(logError, err);
            }
            rateLimit[conn.id] -= 1;
        }
    });

    conn.on('close', function() {
        consoleLog(logSocket, chalk.underline(conn.id) + ': disconnected');
        sendToAll({type:'typing', typing:false, user:clients[conn.id].un});
        sendToAll({type:'server', info:'disconnection', user:users[clients[conn.id].id]});
        delete users[clients[conn.id].id];
        delete clients[conn.id];
    });
});

chat.installHandlers(server, {prefix:'/socket',log:function(){}});


// Util
function updateUser(id, name) {
    if(name.length > 2 && name.length < 17 && name.indexOf(' ') < 0 && !checkUser(name) && name.match(alphanumeric) && name != 'Console' && name != 'System') {
        if(clients[id].un == null) {
            clients[id].con.write(JSON.stringify({type:'server', info:'success'}));
            uid++;
        }

        users[clients[id].id].un = name;
        sendToAll({
            type: 'server',
            info: clients[id].un == null ? 'connection' : 'update',
            user: {
                id: clients[id].id,
                oldun: clients[id].un,
                un: name,
                role: clients[id].role
            }
        });
        clients[id].un = name;
    } else {
        var motive = 'format',
            check = false;

        if(!name.match(alphanumeric)) motive = 'format';
        if(name.length < 3 || name.length > 16) motive = 'length';
        if(checkUser(name) ||  name == 'Console' || name == 'System') motive = 'taken';
        if(clients[id].un != null) check = true;

        clients[id].con.write(JSON.stringify({type:'server', info:'rejected', reason:motive, keep:check}));
        if(clients[id].un == null) clients[id].con.close();
    }
}

function sendToAll(data) {
    for(var client in clients)
        clients[client].con.write(JSON.stringify(data));
}

function sendToOne(data, user, type) {
    for(var client in clients) {
        if(clients[client].un == user) {
            if(type == 'message') clients[client].con.write(JSON.stringify(data));
            if(type == 'role') {
                clients[client].role = data.role;
                users[clients[client].id].role = data.role;
            }
        }
    }
}

function sendBack(data, user) {
    clients[user.con.id].con.write(JSON.stringify(data));
}

function checkUser(user) {
    for(var client in clients) {
        if(clients[client].un == user)
            return true;
    }
    return false;
}

function getUserByName(name) {
    for(client in clients)
        if(clients[client].un == name)
            return clients[client];
}

function handleSocket(user, message) {
    var data = JSON.parse(message);

    data.id = user.id;
    data.user = user.un;
    data.type = s.escapeHTML(data.type);
    data.message = s.escapeHTML(data.message);
    data.mid = (Math.random() + 1).toString(36).substr(2, 5);

    switch(data.type) {
        case 'pm':
            if(data.extra != data.user && checkUser(data.extra)) {
                sendToOne(data, data.extra, 'message');
                data.subtxt = 'PM to ' + data.extra;
                sendBack(data, user);
            } else {
                data.type = 'light';
                data.subtxt = null;
                data.message = checkUser(data.extra) ? 'You can\'t PM yourself' : 'User not found';
                sendBack(data, user);
            }
            break;

        case 'global': case 'kick': case 'ban': case 'role':
            if(user.role > 0) {
                if(data.type == 'global') {
                    if(user.role == 3) {
                        return sendToAll(data);
                    } else {
                        data.subtxt = null;
                        data.message = 'You don\'t have permission to do that';
                        return sendBack(data, user);
                    }
                } else {
                    data.subtxt = null;
                    if(data.message != data.user) {
                        if(checkUser(data.message)) {
                            switch(data.type) {
                                case 'ban':
                                    var time = parseInt(data.extra);

                                    if(!isNaN(time) && time > 0) {
                                        if(user.role > 1 && getUserByName(data.message).role == 0) {
                                            for(var client in clients) {
                                                if(clients[client].un == data.message)
                                                    bans.push(clients[client].ip);
                                            }
                                            data.extra = data.message;
                                            data.message = data.user + ' banned ' + data.message + ' from the server for ' + time + ' minutes';

                                            setTimeout(function() {
                                                bans.splice(bans.indexOf(clients[user.con.id].ip))
                                            }, time * 1000 * 60);

                                            return sendToAll(data);
                                        } else {
                                            data.message = 'You don\'t have permission to do that';
                                            return sendBack(data, user);
                                        }
                                    } else {
                                        data.type = 'light';
                                        data.message = 'Use /ban [user] [minutes]';
                                        return sendToOne(data, data.user, 'message')
                                    }
                                    break;

                                case 'role':
                                    if(data.extra > -1 && data.extra < 4) {
                                        if(user.role == 3) {
                                            var role;
                                            data.role = data.extra;
                                            data.extra = data.message;

                                            if(data.role == 0) role = 'User';
                                            if(data.role == 1) role = 'Helper';
                                            if(data.role == 2) role = 'Moderator';
                                            if(data.role == 3) role = 'Administrator';
                                            data.message = data.user + ' set ' + data.message + ' role to ' + role;
                                            sendToOne(data, JSON.parse(message).message, 'role');
                                            sendToAll({type:'server', info:'clients', clients:users});
                                        } else {
                                            data.message = 'You don\'t have permission to do that';
                                            return sendBack(data, user);
                                        }
                                    } else {
                                        data.type = 'light';
                                        data.message = 'Use /role [user] [0-3]';
                                        return sendToOne(data, data.user, 'message')
                                    }
                                    break;

                                case 'kick':
                                    if(user.role > 1 && getUserByName(data.message).role == 0) {
                                        data.extra = data.message;
                                        data.message = data.user + ' kicked ' + data.message + ' from the server';
                                    } else {
                                        data.message = 'You don\'t have permission to do that';
                                        return sendBack(data, user);
                                    }
                                    break;
                            }                            
                            sendToAll(data);
                        } else {
                            data.type = 'light';
                            data.message = 'User not found';
                            sendBack(data, user);
                        }
                    } else {
                        data.message = 'You can\'t do that to yourself';
                        sendBack(data, user);
                    }
                }
            } else {
                data.message = 'You don\'t have permission to do that';
                sendBack(data, user);
            }
            break;

        default:
            sendToAll(data);
            break;
    }
}

function getTime() {
    var now = new Date(),
        time = [now.getHours(), now.getMinutes(), now.getSeconds()];
 
    for(var i = 0; i < 3; i++) {
        if(time[i] < 10)
            time[i] = "0" + time[i];
    }
 
    return time.join(":");
}

function consoleLog(type, message) {
    if(config.log) {
        if(config.readline) {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            console.log('[' + getTime() + '] ' + type + message);
            rl.prompt(true);
        } else {
            console.log('[' + getTime() + '] ' + type + message);
        }
    }
}


// Intern
if(config.readline) readLine();
function readLine() {
    rl.on('line', function(line) {
        var data = {};
        if(line.indexOf('/role') == 0) {
            var string = 'Console gave ' + line.substring(6) + ' administrator permissions';

            data.message = string;
            data.user = 'Console';
            data.type = 'role';
            data.extra = line.substring(6);
            data.role = 3;

            sendToAll(data);
            sendToOne(data, line.substring(6), data.type);
        }

        rl.prompt();
    }).on('close', function() {
        consoleLog(logStop, 'Shutting down\n');
        process.exit(0);
    });
}
