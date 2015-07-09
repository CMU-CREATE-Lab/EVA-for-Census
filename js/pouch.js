function pouchCache(dbName, doAggregate){
    this.progress = 0;
    this.totalDocs = 0;
    this.doAggregate = doAggregate;
    ldb = "local-" + dbName;
    rdb = "http://evareader:evareader@eva.cmucreatelab.org:5984/" + dbName;
    this.localDB = new PouchDB(ldb);
    this.remoteDB = new PouchDB(rdb);
    
    this.replicateRemoteDB = function(params, callback) {

        var start = performance.now();
        console.log(start);

        this.localURLDB.replicate.from(this.remoteDB, {
            live: false
        })
        .on('change', function (info) {
            console.log("Change:" + info);
        }).on('complete', function (info) {
            // handle complete
            console.log("Complete:" + info);
            var end = performance.now();
            var time = (end - start) / 1000;
            // console.log(end);
            console.log('Execution time: ' + time);

            this.localURLDB.info().then(function (info) {
                callback(null, 'True');
            });
        }).on('uptodate', function (info) {
            console.log("Up to date:" + info);
        }).on('error', function (err) {
            console.log("Error:" + info);
            callback("Error:" + info, null);
        });
    };


    this.getPathFromLocalURLDB = function(params, callback) {
        this.localURLDB.get(params, function (err, doc) {
            if (err) {
                console.log('Error:' + err);
                return;
            }
            console.log(doc);
            callback(null, doc);

        });
    };

    // Change to actually query DB not specific DB
    this.getPathFromDB = function(params, callback) {
        this.localDB.get(params, function (err, doc) {
            if (err) {
                console.log('Didnt find in localURLDB :' + err);

                async.series([
                    function (callback) {
                        this.getPathFromRemoteDB(params, callback);
                    }.bind(this),
                    function (callback) {
                        this.getPathFromLocalURLDB(params, callback);
                    }.bind(this)
                ],
                             // optional callback
                    function (err, results) {
                        if (err) {
                            console.log('Error in series: ' + err)
                            console.log(results)
                            callback('Error in series: ' + err, null);
                        }

                    console.log('Result of the series: ', results[1]);
                    callback(null, results[1]);
                });

            } else {

                //if found in DB
                console.log('After series:' + doc.url);
                callback(null, doc);
            }
        })
    };

    this.docList = function(params) {
        var files = params;
        return files;
    };

    this.getFromLocalDB = function(params, callback) {
        this.localDB.get(params, {"attachments": true}, function (err, doc) {
            if (err) {
                //            If we don't find the result we want the series to conitnue
                callback(null, "not found", null);
                return;
            }
//            console.log("Found in local cache: " + doc);
//            console.log('We already have the doc in local: ' + doc);
            //        We found the doc so no need to continue doing the series.
            callback(null, "Found", doc);
            return;
        });
    };

    this.blobToArrayBuffer = function(buf) {
        var arrayBuffer;
        var fileReader = new FileReader();
        fileReader.onload = function() {
            arrayBuffer = this.result;
            console.log('Converted to arraybuffer: ' + arrayBuffer);
            console.log(arraybufferToString(arrayBuffer).substr(0,1000) );
            return arrayBuffer;
        };
        fileReader.readAsArrayBuffer(buf);

    };

    this.arraybufferToString = function(buf) {
        var dataView = new DataView(buf);
        var decoder = new TextDecoder('utf-8');
        var decodedString = decoder.decode(dataView);
        return decodedString;
    };



    this.base64ToUint8Array = function(attachment) {
        var byteCharacters = atob(attachment);
        var byteNumbers = new Array(byteCharacters.length);
        for (var i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        var byteArray = new Uint8Array(byteNumbers);
        return byteArray;
    };
    
    this.makeProgress = function(percent){
//        console.log("Set Progressbar: " + percent)
//        console.log("progress: " + this.progress + " total:" + this.totalDocs + " prog:" +  (this.progress*100/this.totalDocs));
        $('#dataProgressBar').css('width', (percent)+'%');
    }


    this.Uint8ToBase64 = function(u8Arr){
        var CHUNK_SIZE = 0x8000; //arbitrary number
        var index = 0;
        var length = u8Arr.length;
        var result = '';
        var slice;
        while (index < length) {
            slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
            result += String.fromCharCode.apply(null, slice);
            index += CHUNK_SIZE;
        }
        return btoa(result);
    };

    this.cacheLocalDB = function(doc) {

        this.localDB.put(doc, function(err, res) {
            if(err)
                console.log('Cache Failed: ' + err);

//            console.log('Put in cache worked: ' + res)
        });
    };

    this.inflateAttachment = function(attachment){
//        var start = performance.now();

        //    var binarydata = base64ToUint8Array(attachment); // Inline here? Is this faster than function call?!
        var byteCharacters = atob(attachment);
        var byteNumbers = new Array(byteCharacters.length);
        for (var i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        var byteArray = new Uint8Array(byteNumbers);
        var restored = pako.inflate(byteArray);//, { to: 'string' });
//        var end = performance.now();
//        var time = (end - start) / 1000;
//        console.log('Unzip time: ' + time);
        return restored;


    };


    this.downloadFile = function(doc, callback) {

        var url = window.location.href
        var arr = url.split("/");
        var result = arr[0] + "//" + arr[2];
        var mydoc = doc;

        console.log(result + "/txt/" + doc.url)
        var xhr = new XMLHttpRequest();
        xhr.open('GET', result + "/txt/" + doc.url, true);
        xhr.responseType = 'blob';


        xhr.onload = function (e) {
            var buf = this.response;
            this.blobToArrayBuffer(buf);
            // var decodedString = arraybufferToString(buf);
            // console.log(decodedString.substr(0,1000));
            this.cacheLocalDB(mydoc, buf);
            callback(null, buf);
        };

        xhr.send();
    };


    this.downloadDoc = function(params, callback) {
        this.remoteDB.get(params, {"attachments": true}, function (err, doc) {
            if (err) {
                // If we don't find the result we want the series to conitnue
                
                callback("NOT FOUND IN REMOTE DB!", null);
                alert("Something went wrong. " + err + " Please referesh the page. params: " + params)
                return;
            }
//            console.log(doc);
//            console.log('We have a doc from remote: ' + doc);
            // We found the doc so no need to continue doing the series.
            this.cacheLocalDB(doc);
            callback(null, doc);
            return;
        }.bind(this));

    };


    this.appendBuffer = function( buffer1, buffer2 ) {
        if(!buffer1){
            return buffer2;
        }

        var tmp = new Uint8Array( buffer1.buffer.byteLength + buffer2.buffer.byteLength );
        tmp.set( buffer1, 0 );
        tmp.set( buffer2, buffer1.buffer.byteLength );
        return tmp;
    };

    this.getDoc = function(params, callback) {
        
        async.waterfall([
            function (callback) {
                //TODO: make sure the doc is up to date with remoteDB. Revision check.
                this.getFromLocalDB(params, callback);
            }.bind(this),
            function (arg1, arg2, callback) {
                if(!arg2){
                    this.downloadDoc(params, callback);
                }else{
                    callback(null, arg2);
                }
            }.bind(this)
        ], function (err, result) {
            if(err){
                console.log("The series error: " + err);
                return null;
            }

            var res = [];
            var arrbuf = null;
            if(params == "pa_rac_all" || params == "pa_wac_all"){
                for(i=2002; i< 2012; i++){
                    var filename = params.substring(0,7)+i;

                    if(this.doAggregate)
                        arrbuf = this.appendBuffer(arrbuf, this.inflateAttachment(result._attachments[filename].data));
                    else
                        res.push(this.inflateAttachment(result._attachments[filename].data));

                    this.makeProgress( (this.progress*100/this.totalDocs) + ((i-2002)/(2012-2002))*(100/this.totalDocs)) ;
                }
                if(this.doAggregate)
                    res.push(arrbuf);
                
                this.progress++;
                this.makeProgress((this.progress*100/this.totalDocs));
            } else{
                var filename = params
                arrbuf = this.inflateAttachment(result._attachments[filename].data);
                res.push(arrbuf);;
                this.progress++;
                this.makeProgress((this.progress*100/this.totalDocs));
            }
            
            // console.log("File name: " + filename);
            callback(null, res);
        }.bind(this));
    };

    this.getDocs = function(params, callback) {
        //get the list of docs we need
        var fl = this.docList(params);
//        console.log(fl);
        
        this.totalDocs = fl.length;
        this.progress = 1;
        
        this.makeProgress((this.progress*100/this.totalDocs));
        async.mapSeries(fl, this.getDoc.bind(this), function(err, results){
            // results is now an array of stats for each file
            if(err){
                console.log("The series error: " + err);
                return null;
            }
//            console.log("Final result: " + results[0][0][0]);
            var buf = null;
            if(this.doAggregate){   
//                console.log("num Docs: " + results.length);
                for(var i = 0 ; i < results.length; i++){
//                    console.log("num Attachments: " + results[i].length);
                    for(var j = 0 ; j < results[i].length; j++){
                        buf = this.appendBuffer(buf, results[i][j]);
                        results[i][j] = null;
                    }
                    results[i] = null;
                }
//                $('#dataProgressBar').css('width', (100)+'%');
//                console.log("size: "+buf.buffer.byteLength);
                callback(buf);
            }else{
//                console.log("num Docs: " + results.length);
//                for(var i = 0 ; i < results.length; i++){
//                    console.log("num Attachments: " + results[i].length);
//                }
                callback(results);
            }
            
        }.bind(this));

    };
    
}

