var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var index = require('./routes/index');
var users = require('./routes/users');
var net = require('net');

var app = express();
var expressWs = require('express-ws')(app);

const sep = ' ';

// Tracks established WebSocket connections by mapping a client (IP, port)
// pairing to a `ws` object
var wsDict = {}

// Prepare Unix socket that exposes Kernel socket stats
const traceClient = net.connect({
    // TODO: Remove hard-coding
    path: '/var/run/tcpexpose.sock'
});
traceClient.setEncoding();

// Remember listening socket of this server to allow access when tearing down
// a WebSocket connection.  This is necessary because the information is gone
// in the OS by the time that it is queried by the application.
var local_ip, local_port;

// The Unix socket writes TCP state data to this process in response to a
// `flush` command (see `pollSocket`).  State information is then parsed here
// and written out to the appropriate WebSocket client.  The client is matched
// using the socket address points and the JSON-encoded data is relayed as-is.
traceClient.on('data', function(msg){
    msgs = msg.split('\n');

    // Batch directional messages into single update for a WebSocket client
    var batches = {}
    msgs.forEach(function(message){
        // Discard empty messages
        if (message.length == 0) {
            return;
        }

        try {
            m = JSON.parse(message);
        } catch (err) {
            // Discard unparsable messages
            console.log(err);
            return;
        }

        // Build dictionary key as TCP socket quartet
        k = m['saddr'] + sep + m['daddr'] + sep + m['sport'] + sep + m['dport'];

        if (k in batches) {
            // Append message to existing collection
            batches[k].push(m)
        } else if (reverseClientID(k) in batches) {
            // Append message to existing matching collection
            batches[reverseClientID(k)].push(m)
        } else {
            // Create new collection
            batches[k] = [m]
        }

    });

    // Write batched traces out to matching WebSocket client
    for (var batch in batches) {
        if (batch in wsDict) {
            try {
                wsDict[batch].send(JSON.stringify(batches[batch]));
            } catch (err) {
                // Remove tracked ws connection when WebSocket connection closes
                unregisterClient(batch);
                console.log(err);
            }
        }
    }
})


// Returns the local and remote IP and port associated with a connected client
function getClientID(req) {
    var remote_ip, remote_port;

    if (local_ip == undefined) {
        local_ip = req.connection.localAddress;
    }
    if (local_port == undefined) {
        local_port = req.connection.localPort;
    }

    if (req.header('X-Real-IP') && req.header('X-Real-Port')) {
        // Proxy case
        remote_ip = req.header('X-Real-IP');
        remote_port = req.header('X-Real-Port');
    } else {
        // Direct case
        remote_ip = req.connection.remoteAddress;
        remote_port = req.connection.remotePort;
    }
    result = local_ip + sep + remote_ip + sep + local_port + sep + remote_port;
    return result;
}

// Returns the remote and local IP and port associated with a connected client
function reverseClientID(id) {
    var parts = id.split(sep);
    return parts[1] + sep + parts[0] + sep + parts[3] + sep + parts[2];
}

// Poll Unix socket recurringly by requesting TCP stats associated with a
// target client's IP and source port.
function pollSocket(id) {
    try {
        traceClient.write(id);
    } catch (err) {
        // TODO: Define behaviour for broken connection to Unix socket
        console.log(err);
    }

    // Schedule next poll
    if (id in wsDict) {
        setTimeout(pollSocket, 3000, id);
    }
}

// Track connected WebSocket clients so that trace responses can be relayed
// asynchronously to the client after a polling request is made. Note that
// TCP connections are tracked separately for each direction.
function registerClient(id, ws) {
    wsDict[id] = ws;
    wsDict[reverseClientID(id)] = ws;
}

// Stop tracking connected WebSocket client. Note that this action removes
// two entries as TCP connections are tracked separately for each direction.
function unregisterClient(id) {
    delete wsDict[id];
    delete wsDict[reverseClientID(id)];
}

// When receiving the first message from a connected WebSocket client,
// resgister the client and initiate polling the trace Unix socket for it's
// TCP state information.
//
// When a client disconnects, unregister it to signal the end of polling for
// that TCP connection.
app.ws('/', function(ws, req) {
    ws.on('message', function(msg) {
        var id = getClientID(req);
        if (id in wsDict) {
            // Ignore msg if already polling for client
            return
        } else {
            registerClient(id, ws);
            pollSocket(id);
        }
    });

    ws.on('close', function() {
        var id = getClientID(req);
        unregisterClient(id);
    });
});


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index);
app.use('/users', users);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handler
app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

app.listen(3000, function() {
    console.log('Example app listening on port 3000!')
})

module.exports = app;
