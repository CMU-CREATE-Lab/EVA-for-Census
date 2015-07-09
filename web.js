var express = require('express');
var compression = require('compression');
var bodyParser = require('body-parser');
var fs = require('fs');
var shortId = require('shortid');

var app = express();
app.use(compression());
app.use(bodyParser.json());

app.use('/js', express.static(__dirname + '/js'));
app.use('/css', express.static(__dirname + '/css'));
app.use('/fonts', express.static(__dirname + '/fonts'));
app.use('/resources', express.static(__dirname + '/resources', {maxAge: oneHour}));

var oneHour = 3600000;

app.get('/', function (req, res) {
    fs.readFile('html/index.html', function (err, buffer) {
        if (err) throw err;
        res.send(buffer.toString());
    });
});

app.get('/help', function (req, res) {
    fs.readFile('html/help.html', function (err, buffer) {
        if (err) throw err;
        res.send(buffer.toString());
    });
});

// share (create): receive a snapshot, create a share file, send the file hash
app.post('/createShareHistory', function (req, res) {
    var fname = 'history-' + Date.now() + '-' + shortId.generate();
    var fout = fs.createWriteStream('resources/shares/' + fname, {'flags': 'a'});

    fout.on('open', function() {
        fs.chmodSync('resources/shares/' + fname, 0666);
        var obj = {type: "history", uid: fname, count: 0, snapshots: req.body};
        fout.write(JSON.stringify(obj));
    })
    
    res.send(fname);
});

// share (read): receive a file hash, read the content from share folder and return it
app.post('/loadShareView', function (req, res) {
    fs.readFile('resources/shares/' + req.body.uid, function (err, buffer) {
        if (err) {
            res.send(JSON.stringify({}));
        } else {
            var obj = JSON.parse(buffer.toString());

            // make necessary changes to the share file
            obj.count++;
            var fout = fs.createWriteStream('resources/shares/' + obj.uid);
            fout.write(JSON.stringify(obj));

            // send info to client
            res.send(JSON.stringify(obj));
        }
    });
});

// start the server
var port = process.env.PORT;
app.listen(port, function() {
    console.log("Listening on " + port);
});
