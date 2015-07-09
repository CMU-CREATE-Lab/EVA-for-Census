"use strict";

function DataManager(settings){

	this._dbName = settings.dbName;
	this._localDB = new PouchDB(this._dbName);
	this._tilingVersion = settings.tilingVersion;


	this._currentDataset = settings.currentDataset;
	this._datapath = settings.dmDataPath;
	this._datasetS = settings.datasetS;
	this._aggLevels = settings.aggLevels;
	this._minCacheable = settings.minCacheable;
	this._steps = settings.steps;
	this._maxGPUPoints = settings.maxGPUPoints;
	this._precisions = settings.precisions;

	this._manFileName = settings.manFileName;
	this._worldMinLong = settings.worldMinLong;
	this._worldMaxLong  = settings.worldMaxLong;
	this._worldMinLat = settings.worldMinLat;
	this._worldMaxLat  = settings.worldMaxLat ;
	this._maxNumStreams = settings.maxNumStreams;
	this._staticAggLevel = settings.staticAggLevel;
	this._garbageCollectionSize = settings.garbageCollectionSize;
	this._minCacheableSize = settings.minCacheableSize;
	//	this._inflateWorker = new Worker("js/inflateWorker.js");

	this._debug = settings.debug;

	//	this._downloadQ = async.queue(this.getDoc, this._maxNumStreams);
	this._downloadQ = [];
	this.dmInitialize();
}


DataManager.prototype._manifest = [];
DataManager.prototype._memory = [];
DataManager.prototype._viewList = [];
DataManager.prototype._staticList = [];
DataManager.prototype._transferQ = [];
DataManager.prototype._transferQProgress = [];
DataManager.prototype._numViewPoints = 0;
DataManager.prototype._numLoadedPoints = 0;
DataManager.prototype._loadedmemorySize = 0;
DataManager.prototype._numStaticFiles = 0;
DataManager.prototype._staticsLoaded = false;
DataManager.prototype._numStaticLayers  = 0;
DataManager.prototype._manifestLoaded = false;
DataManager.prototype._inAsync = false;
DataManager.prototype._numRunningStreams = 0;
DataManager.prototype._currentAggLevel = "";
var sp = window.location.href.split("?");
DataManager.prototype._hostURL = sp[0].replace(/\/*#*$/, "");


//============================ UTILS & Main Functions =============================

function changeDataset(newSettings){
	if(dm._currentDataset == newSettings.currentDataset)
		return;

	if(newSettings.debug){
		console.log("=========== Chaning Dataset =============");
		console.log(newSettings.currentDataset);
	}

	dm = new DataManager(newSettings);
}


function removeFromArray(arr, val){

	position = arr.indexOf(val);

	if ( ~position ) {
		return arr.splice(position, 1);
	}else{
		console.error("ArrayRemoval: didn't find removal item");
	}

}

function inflateFile(fbuf, toString){
	if (toString)
		var restored = pako.inflate(fbuf, { to: 'string' });
	else 
		var restored = pako.inflate(fbuf);

	return restored;
}

function Uint8ToBase64(u8Arr){
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
}

function blobToArrayBuffer(buf, callback) {
	//	this.LOG(buf);
	var fileReader = new FileReader();  
	fileReader.onload = function(e){
		var arrayBuffer = this.result;
		//        this.LOG('Converted to arraybuffer: ' + arrayBuffer);
		//        this.LOG(arraybufferToString(arrayBuffer).substr(0,1000) );
		callback(null, arrayBuffer);
	};
	fileReader.readAsArrayBuffer(buf);

}

function arraybufferToString(buf) {
	var dataView = new DataView(buf);
	var decoder = new TextDecoder('utf-8');
	var decodedString = decoder.decode(dataView);
	return decodedString;
}


function base64ToUint8Array(fbuf) {
	var byteCharacters = atob(fbuf);
	var byteNumbers = new Array(byteCharacters.length);
	for (var i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	var byteArray = new Uint8Array(byteNumbers);
	return byteArray;
}



//gets arrays

function appendBuffer( buffer1, buffer2 ) {
	if(!buffer1){
		return buffer2;
	}

	var tmp = new Uint8Array( buffer1.buffer.byteLength + buffer2.buffer.byteLength );
	tmp.set( buffer1, 0 );
	tmp.set( buffer2, buffer1.buffer.byteLength );
	return tmp;
};


function append2Buffers( buffer1, buffer2 ) {
	if(!buffer1){
		return buffer2;
	}

	var tmp = new Uint8Array( buffer1.buffer.byteLength + buffer2.buffer.byteLength );
	tmp.set( buffer1, 0 );
	tmp.set( buffer2, buffer1.buffer.byteLength );
	return tmp;
}

function appendArrayOfBuffers( buffarray ) {
	if(buffarray.length == 0){
		return null;
	}else if(buffarray.length == 1){
		return buffarray[0];
	}
	var newSize = 0;

	for(var i = 0 ; i < buffarray.length; i++ ){
		newSize += buffarray[i].buffer.byteLength
	}

	var tmp = new Uint8Array(newSize);
	var offset = 0;

	for(var i = 0 ; i < buffarray.length; i++ ){
		tmp.set( buffarray[i], 0 );	
		offset += buffarray[i].buffer.byteLength;
	}
	return tmp;
}

// ========================== End of Utils ==========================
DataManager.prototype.
LOG = function(s){
	if(this._debug){
		console.log(s)
	}
}


DataManager.prototype.
getDocs = function(params, callback) {
	var localDM = this;


	var unsortedQ = [];
	for(var key in params){
		unsortedQ.push(key);
	}
	var SortedQ = [];
	var i = Math.ceil(unsortedQ.length/2);
	var j = i - 1;

	while (j >= 0){
		SortedQ.push(unsortedQ[j--]);
		if (i < unsortedQ.length) SortedQ.push(unsortedQ[i++]);
	}


	localDM.LOG(SortedQ);

	for(var index = 0 ; index < SortedQ.length; index++){
		var key = SortedQ[index];
		//		console.log(params[key])
		localDM.LOG("RunningStreams: " + localDM._numRunningStreams)
		if(localDM._numRunningStreams >= localDM._maxNumStreams){
			return
		}

		if(!localDM._transferQ[key]){
			localDM._transferQ[key] = true;
			localDM.getDoc(params[key], callback);
		} 
		//		delete params[key];
	}

}

DataManager.prototype.
getDoc = function(params, callback) {
	var localDM = params.dm;
	//Check memory first
	if(localDM._memory[params.key]!=null){
		callback(localDM._memory[params.key], localDM);
		localDM.LOG("had Memory for: " + params.key);
		return
	}
	localDM._numRunningStreams++;

	async.waterfall([
		function (callback) {
			//TODO: make sure the doc is up to date with remoteDB. Revision check.
			if(params.doCache){
				localDM.getAttachmentFromLocalDB(params, callback);
			}else{
				callback(null, "not found", null);
			}
		},
		function (arg1, arg2, callback) {
			if(!arg2){
				localDM.downloadFile(params, callback);
			}else{
				callback(null, arg2);
			}
		},
		//		function (arg1, callback) {
		//			blobToArrayBuffer(arg1, callback);
		//			//			this.LOG(arg1)
		//		},
		function (arg1, callback) {
			var workerMessage = {"data": arg1, "toString": params.toString};
			localDM.LOG("sending to worker: " + params.key);
			var inflateWorker = new Worker("js/inflateWorker.js");
			inflateWorker.postMessage(workerMessage);
			inflateWorker.onmessage = function(unpackedData){
				//				localDM.LOG("got back from worker");
				//				localDM.LOG(unpackedData);
				callback(null,unpackedData.data);
			}

		}
	], function (err, result) {
		if(err){
			localDM.LOG(["Error occured in getdoc in series." , err].join());
			localDM._numRunningStreams--;
			delete localDM._transferQ[params.key];
			callback(null)
			return;
		}
		localDM.LOG(["getDoc was able to get the buffer for " , params.key].join());
		//		this.LOG(result)
		//		var arrbuf = inflateFile(result, params.toString);
		//		localDM.LOG("result: ")
		//		localDM.LOG(result)
		var arrbuf = result;
		localDM._memory[params.key] = arrbuf;
		//		LOADEDLIST[params.key] = true;
		localDM._loadedmemorySize += arrbuf.length;

		if(params.key != localDM._manFileName){
			localDM._numLoadedPoints += localDM._manifest[params.key].numpoints;

			localDM.LOG([params.key , " | fsize: " , localDM._manifest[params.key].fsize/1000 , " added mem: " , arrbuf.byteLength/1000 , " current mem: " , localDM._loadedmemorySize/1000 , " Number of current view points: " , localDM._numViewPoints , " Num Points added: " , localDM._manifest[params.key].numpoints ," Num Loaded points: " , localDM._numLoadedPoints].join())
		}

		//TODO: send it as MEM[key] makes a difference?
		localDM._numRunningStreams--;
		delete localDM._transferQ[params.key];
		if(Object.keys(localDM._transferQ).length == 0){
			localDM.LOG(">>>>>>>>>>> Transfers done <<<<<<<<<")
			localDM._transferQProgress = [];
//			if(localDM._staticsLoaded)
//				$('#download-progress-bar').css('background','#FF620D');
			setTimeout(function(){ 
				$('#download-progress-bar').hide();
//				$('#download-progress-bar').css('background','#FFD4A3');
				$('#download-progress-bar').css('width', (0)+'%');
			}, 750);

		}
		callback(arrbuf, localDM);

		//		if(notAsync)
		//			callback(arrbuf);
		//		else
		//			callback(null,"got it");
	});
};

DataManager.prototype.
getAttachmentFromLocalDB = function(params, callback) {
	var localDM = this;
	this._localDB.getAttachment(params.key, 'fblobs', function (err, doc) {
		if (err) {
			//            If we don't find the result we want the series to conitnue
			callback(null, "not found", null);
			return;
		}
		//this.LOG("Found in local cache: " + doc);
		//this.LOG('We already have the doc in local: ' + doc);
		//We found the doc so no need to continue doing the series.
		//this.LOG("Found in local data: " + id);
		//this.LOG(doc)
		if( params.key != localDM._manFileName){
			localDM._transferQProgress[params.key] = doc.size;
			localDM.makeProgress();
		}
		callback(null, "Found", doc);
		//        callback(null, "Found", doc._attachments["attach_" + params].data);

		//        callback(null, "Found", doc);

		return;
	});
}

DataManager.prototype.
getFromLocalDB = function(params, callback) {
	var localDM = this;
	localDM._localDB.get(params.key, {attachments: true}, function (err, doc) {
		if (err) {
			//            If we don't find the result we want the series to conitnue
			callback(null, "not found", null);
			return;
		}
		//            this.LOG("Found in local cache: " + doc);
		//            this.LOG('We already have the doc in local: ' + doc);
		//        We found the doc so no need to continue doing the series.
		localDM.LOG("Found in local data: ");
		localDM.LOG(doc)
		//		this.LOG(doc._attachments.fblobs.data);

		if( params.key != manFileName){
			localDM._transferQProgress[params.key] = doc._attachments.fblobs.data.size;
			localDM.makeProgress();
		}

		callback(null, "Found", doc._attachments.fblobs.data);
		//        callback(null, "Found", doc._attachments["attach_" + params].data);

		//        callback(null, "Found", doc);

		return;
	});
}



DataManager.prototype.
makeProgress = function(){
	var downloadSize = 0.0;
	var totalSize = 0.0
	for(var key in this._transferQProgress){
		if(!this._manifestLoaded)
			return;
		downloadSize += this._transferQProgress[key];
		totalSize += 1.04*this._manifest[key].fsize;
	}
	var percentComplete = Math.min(100*downloadSize/totalSize,100); //oEvent.loaded / oEvent.total;
	this.LOG(["progress: " , percentComplete].join())
	//        this.LOG("progress: " + progress + " total:" + totalDocs + " prog:" +  (progress*100/totalDocs));
	$('#download-progress-bar').css('width', (percentComplete)+'%');
}


DataManager.prototype.
cacheLocalDB = function(doc) {
	var localDM = this;
	localDM._localDB.put(doc, function(err, res) {
		if(err)
			localDM.LOG(["Cache Failed: " , err].join());

		//            this.LOG('Put in cache worked: ' + res)
	});
}



DataManager.prototype.
cacheFile = function(params, fileBuf){
	//	this.LOG(params)
	var doc = {
		"_id": params.key,
		"_attachments": {
			"fblobs": {
				"content_type": "application/octet-stream",
				"data": fileBuf
			}
		}
	}
	var localDM = this;
	//	this.LOG("cache file: " )
	//	this.LOG(doc._attachments.fblobs);
	localDM._localDB.put(doc).then(function (result) {
		localDM.LOG(result);
		// handle result
	}).catch(function (err) {
		localDM.LOG(err);
	});

}

DataManager.prototype.
downloadFile = function(params, callback) {
	var localDM = this;

	var xhr = new XMLHttpRequest();
	xhr.open('GET', params.url, true);
	xhr.responseType = 'blob';
	xhr.addEventListener("progress", function(e) {
		localDM.updateProgress(e, params.key);
	}, false);
	//	this.LOG(params)
	var gotError = false;
	// One error checking is enough.
	xhr.onreadystatechange = function (oEvent) {  
		if (xhr.readyState === 4) {  
			if (xhr.status === 200) {  
				//				console.log(oXHR.responseText)  
			} else {  
				if(gotError)
					return;
				gotError = true;
				localDM.LOG("=============> Steady Error", xhr.statusText);  
				delete localDM._transferQ[params.key];
				callback(xhr.statusText);
				return;

			}  
		}  
	}; 

	xhr.onload = function (e) {
		var buf = this.response;

		if (this.readyState == this.DONE && xhr.status != 200) {

			if(gotError)
				return;
			gotError = true;

			localDM.LOG("=============> Error", xhr.statusText);  
			delete localDM._transferQ[params.key];
			//send error to async queue
			callback(xhr.statusText);
			return;
		}

		localDM.LOG(["Downloaded the file: " , params.url].join())
		//		this.LOG(buf);
		//		removeFromArray(this._transferQ, xhr)
		if(params.doCache){
			localDM.cacheFile(params, buf)
		}
		//		this.LOG("after removal from DL queue: " + transferQ.length)	
		callback(null, buf);
		//        blobToArrayBuffer(buf, callback);

		// var decodedString = arraybufferToString(buf);
		// this.LOG(decodedString.substr(0,1000));
		//            cacheLocalDB(mydoc, buf);
		//        callback(buf);
	};
	//	this._transferQ.push(xhr);

	//	this.LOG("after addition to DL queue: " + transferQ.length)
	xhr.send();
}


DataManager.prototype.
processManifest = function(buffer, localDM){
	if(!buffer){
		localDM.LOG("Couldn't download the manifest. Please refresh.")
		return;
	}


	//    var uncomp = inflateFile(buffer);
	//    this.LOG(uncomp);
	var lines = buffer.split('\n');
	var length = lines.length;
	var man = [];
	for(var index = 0 ; index < length; index++){
		//		this.LOG(index + "," + length)
		var line = lines[index];
		//		this.LOG("line = " + line)

		var kv = line.split(":");
		var key = kv[0]
		if(kv[1]==null){
			localDM.LOG("Invalid line in man")
			continue
		}

		var vals = kv[1].split(',');
		var data = {
			"numpoints": parseInt(vals[0]),// -125
			"fsize": parseInt(vals[1]),
		};

		//		var key = line.substring(0,line.lastIndexOf(","));
		//		var val = line.substring(line.lastIndexOf(",") + 1);
		man[key] = data;
		localDM._memory[key] = null;
		//		this.LOG(man[key][0])
		//		this.LOG("key = " + key  + " value = " + val);
		//        this.LOG(index);
	}

	man[localDM._manFileName] = {
		"numpoints": length,// -125
		"fsize": buffer.byteLength,
	};

	localDM._manifest = man;
	//	this.LOG("manifest: ");
	//	this.LOG(manifest);
	localDM.LOG("manifest loaded.")
	localDM._manifestLoaded = true;
	localDM._manifest.byteLength
	return localDM._manifest;
}

DataManager.prototype.
setupManifest = function() {
	//lehd-chunks/pa_rac_2007
	//	this.LOG(hostURL + datapath + "man.gz")
	var params = {
		"key": this._manFileName,
		"url": this._hostURL + this._datapath + this._manFileName,// -125
		"toString": true,	// -66
		"doCache": true,	// 24
		"dm": this
	}
	//    var docurl = "/data/lehd-chunks/pa_rac_2007"
	this.getDoc(params, this.processManifest);
}

DataManager.prototype.
getView = function(params, agglevel, dataset){

	var longstep = this._steps[agglevel][0]; 
	var latstep = this._steps[agglevel][1];
	var longprecision = this._precisions[agglevel][0];
	var latprecision = this._precisions[agglevel][1];

	var minLong = Math.max(params.minLong, this._worldMinLong) || this._worldMinLong;
	var maxLong = Math.min(params.maxLong, this._worldMaxLong) || this._worldMaxLong;
	var minLat = Math.max(params.minLat, this._worldMinLat) || this._worldMinLat;
	var maxLat = Math.min(params.maxLat, this._worldMaxLat) || this._worldMaxLat;

	//		this.LOG(params.minLong)
	//		this.LOG(minLong)
	//		this.LOG("long: " + parseFloat(minLong - (minLong) ) / longstep)
	minLong = (this._worldMinLong + Math.floor(parseFloat(minLong - (this._worldMinLong) ) / longstep) * longstep)
	maxLong = (this._worldMinLong + Math.ceil( parseFloat(maxLong - (this._worldMinLong) ) / longstep) * longstep)
	minLat = (this._worldMinLat + Math.floor(parseFloat(minLat - (this._worldMinLat) ) / latstep) * latstep)
	maxLat = (this._worldMinLat + Math.ceil( parseFloat(maxLat - (this._worldMinLat) ) / latstep) * latstep)


	//		this.LOG("steps: " + longstep + " " + latstep);
	//		this.LOG("long: " + minLong + " " + maxLong)
	//		this.LOG("lat: " + minLat + " " + maxLat)
	var keyList = [];
	var pointcount = 0;

	for (var long_offset=minLong; long_offset < maxLong; long_offset+=longstep){
		for( var lat_offset = minLat; lat_offset < maxLat; lat_offset+=latstep) {
			var key = dataset[0] + this._aggLevels[agglevel][0] + "_" + (long_offset).toFixed(longprecision) + "_" + (lat_offset).toFixed(latprecision);
			if(this._manifest[key]){
				pointcount += this._manifest[key].numpoints;
				keyList[key] = true;
			}
		}
	}

	return [pointcount,keyList]
}

DataManager.prototype.
viewManager = function( params ){

	var dataset = params.dataset || this._currentDataset;
	//TODO Fix this, this shouldn't change like this, statics have to be reloaded

	var startlevel = params.agglevel || "block";

	//	this.LOG(aggLevels)
	//	this.LOG(dataset)
	//	this.LOG(dataset[0])
	//	this.LOG(startlevel)
	//	this.LOG(aggLevels.indexOf(startlevel))
	var agglevel = this._aggLevels.indexOf(startlevel)
	if(agglevel==-1)
		return null;

	for(; agglevel < this._aggLevels.length; agglevel++){
		//		this.LOG(agglevel)
		var r = this.getView(params,agglevel,dataset)
		var pointcount = r[0]
		var keyList = r[1]

		//		this.LOG("viewList: ")
		//		for(key in keyList){
		//			this.LOG(key)
		//		}




		// Add statics:
		for(var key in this._staticList){
			if(this._staticList.hasOwnProperty(key))
				if(keyList[key] != true){
					//					this.LOG(["Adding static key: " , key].join());
					pointcount += this._manifest[key].numpoints;
					keyList[key] = true;
				}
		}

		//		this.LOG("viewList after: ")
		//		for(key in keyList){
		//			this.LOG(key)
		//		}
		//
		//		this.LOG("---- after addition ----")
		// We can use this view
		if(pointcount < this._maxGPUPoints){

			//Hacky fix for showin tracts for missing blocks before they are loaded. 
			if(agglevel == 0){
				for(var key in keyList){
					if(keyList.hasOwnProperty(key)){
						if(this._memory[key] ==null){
							//							this.LOG("missing: " + key);
							var coo = this.keyToCoordinates(key);
							var long = coo[0];
							var lat = coo[1];
							var params = {
								"minLong": long,// -125
								"maxLong": long+this._steps[agglevel][0],	// -66
								"minLat": lat ,	// 24
								"maxLat": lat + this._steps[agglevel][1],	//50
								"agglevel": this._aggLevels[agglevel+1]
							}


							var replacement = this.getView(params,agglevel+1,dataset);
							var rkeys = replacement[1];

							for(var rkey in rkeys){
								if(rkeys.hasOwnProperty(rkey)){
									//									this.LOG("replacement: " + rkey);		
									if(this._memory[rkey]){
										keyList[rkey] = true;
										pointcount += this._manifest[rkey].numpoints;
									}
								}
							}


						}
					}
				}
			}

			//			this.LOG(["============ Chose: " , this._aggLevels[agglevel] , " Number of Points (+statics): " , pointcount].join())
			//			numViewPoints =  pointcount;
			if(this._currentAggLevel != this._aggLevels[agglevel]){
				this._currentAggLevel = this._aggLevels[agglevel];
				$('#download-progress-text').text(this._aggLevels[agglevel].toUpperCase());
			}

			return [pointcount, keyList];	
		}
	}	

}

// Hacky!
DataManager.prototype.
keyToAggLevelNum = function(key){
	for(var i = 0 ; i < this._aggLevels.length; i++)
		if(key[1] == this._aggLevels[i][0])
			return this._aggLevels.indexOf(this._aggLevels[i]);

}

DataManager.prototype.
keyTodatasetName = function(key){
	for(var i = 0 ; i < this._datasetS.length; i++)
		if(key[0] == this._datasetS[i][0])
			return this._datasetS[i];

}

// Hacky
DataManager.prototype.
keyToCoordinates = function(key){
	var sp = key.split("_");
	var long = parseFloat(sp[1]);
	var lat = parseFloat(sp[2]);
	//	this.LOG("Long: " + long + " lat: " + lat );
	return [long, lat];

}


// Make sure viewList is properly filled before calling this
DataManager.prototype.
downloadManager = function(keyList, callback){
	var DLList = []
	var fsize = 0;
	var newnumpoints = 0;
	for(var key in keyList ){
		if(keyList.hasOwnProperty(key)){
			if(this._memory[key]==null){
				var man = this._manifest[key];
				var agglevel = this.keyToAggLevelNum(key);
				var dataset = this.keyTodatasetName(key);
				var doCache = (agglevel>= this._aggLevels.indexOf(this._minCacheable)) || (man.fsize>= this._minCacheableSize);
				var filepath = this._hostURL + this._datapath + this._currentDataset + "/" + this._aggLevels[agglevel] + "/" + key

				var prms = {
					"key": key,
					"url": filepath,
					"toString": false,	
					"doCache": doCache,
					"dm": this
				}
				fsize += man.fsize;
				newnumpoints += man.numpoints;
				DLList[prms.key] = prms;
				if(!this._transferQProgress[prms.key])
					this._transferQProgress[prms.key] = 0;
			}
		}
	}


	if(newnumpoints !=0){
		if ($('#download-progress-bar').is(':hidden'))
			$('#download-progress-bar').show();
		//		this._aggLevels[agglevel];
		//		this._downloadProgress = 0;
		//		this.LOG("downloadmanager again")
		//		var s = "";
		//		for(var pm in DLList)
		//			s = s + " " + DLList[pm].key;
		//		this.LOG(s);
		this.garbageCollect(newnumpoints);
		this.getDocs(DLList, callback)
	}
	//	return DLList
}


//TODO: what if something is loading from previous call?
DataManager.prototype.
garbageCollect = function( numnewpoints){


	if(this._numLoadedPoints + numnewpoints > this._garbageCollectionSize){
		this.LOG(["will be downloading: " , numnewpoints , " num loaded points: " , this._numLoadedPoints].join())
		for(var key in this._memory ){
			if(this._memory.hasOwnProperty(key) && key != this._manFileName){
				if(this._memory[key] != null ){
					if(this._viewList[key] != true){

						this.LOG(["UNUSED memory: " , key].join())
						this.LOG([" Release size: " , this._manifest[key].numpoints , " was: " , this._numLoadedPoints , " will be: " , (this._numLoadedPoints - this._manifest[key].numpoints)].join() )
						this._loadedmemorySize -= this._memory[key].length;
						this._numLoadedPoints -= this._manifest[key].numpoints;
						this._memory[key] = null;
						if(this._numLoadedPoints + this._numnewpoints < this._garbageCollectionSize){
							return;
						}
					}
				}
			}
		}
	}

}

DataManager.prototype.
getBuffersWithCallback = function(params, callback){
	//	this.LOG("----- get buffer with params: ")

	var localDM = this;
	if(localDM._inAsync){
		return;
	}
	//	this.LOG(params)


	async.until(
		function () { return localDM._manifestLoaded && localDM._staticsLoaded},
		function (callback) {
			localDM._inAsync = true;
			setTimeout(callback, 100);
		},
		function (err) {
			localDM._inAsync = true;
			//			this.LOG(manifest)
			var r = localDM.viewManager(params);
			localDM._numViewPoints = r[0];
			localDM._viewList = r[1];
			//			localDM.LOG(["viewList Size: " , localDM._viewList.length].join())
			//			var downloadlist = 
			localDM.downloadManager(r[1], callback);
			//			localDM.LOG("Finished");
			localDM._inAsync = false;
			//			this.LOG("downloadlist: " +downloadlist.length)
			//			getDocs(downloadlist, callback)

		}
	);
}


DataManager.prototype.
getCounties = function( callback){
	var params = {
		"minLong": this._worldMinLong,// -125
		"maxLong": this._worldMaxLong,	// -66
		"minLat": this._worldMinLat,	// 24
		"maxLat": this._worldMaxLat,	//50
		"agglevel": "county"
	}

	this.getBuffersWithCallback(params, callback);
}

DataManager.prototype.
getTracts = function( callback){
	var params = {
		"minLong": this._worldMinLong,// -125
		"maxLong": this._worldMaxLong,	// -66
		"minLat": this._worldMinLat,	// 24
		"maxLat": this._worldMaxLat,	//50
		"agglevel": "tract"
	}

	this.getBuffersWithCallback(params, callback);
}



// progress on transfers from the server to the client (downloads)
DataManager.prototype.
updateProgress = function(oEvent, key) {
	if (oEvent.lengthComputable) {
		this._transferQProgress[key] = oEvent.loaded ;
		this.makeProgress();
	} else {
		this.LOG("Can't get file size")
	}
}

// worry about Object.keys(staticList).length compatibility?
DataManager.prototype.
setupStatics = function(buffs, localDM){
	localDM._numStaticFiles++;
	localDM.LOG(["Got Statics of length: " , buffs.length].join())
	localDM.LOG(localDM._staticList);
	localDM.LOG(localDM._numStaticFiles)
	if(localDM._numStaticFiles == Object.keys(localDM._staticList).length){
		localDM._staticsLoaded = true;
		localDM.LOG("done with manifest AND STATICS");
		localDM.LOG("==============================");
	}
}

DataManager.prototype.
getStatics = function(){
	//	this.LOG("setting up statics")
	this._numStaticLayers  = this._aggLevels.length - this._aggLevels.indexOf(this._staticAggLevel)
	this._staticList = [];
	this._numStaticFiles = 0;
	this._numLoadedPoints = 0;
	this._loadedmemorySize = 0;
	this._staticsLoaded = false;
	var numstaticpoints = 0

	var localDM = this;
	async.until(
		function () { return localDM._manifestLoaded },
		function (callback) {
			setTimeout(callback, 100);
		},
		function (err) {
			var stList = [];
			for(var i = localDM._numStaticLayers; i < localDM._aggLevels.length ; i++){
				var params = {
					"minLong": localDM._worldMinLong,// -125
					"maxLong": localDM._worldMaxLong,	// -66
					"minLat": localDM._worldMinLat,	// 24
					"maxLat": localDM._worldMaxLat,	//50
					"agglevel": localDM._aggLevels[i]
				}
				stList.push(localDM.viewManager(params)[1]);
			}
			//			localDM.LOG(stList)
			var vl = [];
			for(var i in stList){
				var keyList =  stList[i];
				for(var key in keyList){
					if(keyList.hasOwnProperty(key)){
						localDM.LOG(["key I got from view manager: " , key].join());
						numstaticpoints += localDM._manifest[key].numpoints;
						localDM.LOG(["points for the key: " , localDM._manifest[key].numpoints].join());
						localDM._staticList[key] = true;
						vl[key] = true;
					}
				}
			}

			// get buffers
			localDM.LOG(vl);
			localDM.LOG(["Number of points in statics: " , numstaticpoints].join())

			localDM._numViewPoints = numstaticpoints;
			localDM._viewList = vl;
			localDM.downloadManager(vl, localDM.setupStatics)
		}
	);
}

DataManager.prototype.
dmInitialize = function(){
	this.setupManifest();
	this.getStatics();

}

DataManager.prototype.
getBuffers = function(params){
	this.getBuffersWithCallback(params,this.getDocCallback)
}

//For testing only
DataManager.prototype.
getCounty = function(callback){
	var params = {
		"url": this._hostURL  + this._datapath + this._dataset + "/county/"+ this._dataset + "_county_-125_24.gz",// -125
		"toString": false,	// -66
		"doCache": true	// 24
	}
	this.getDoc(params, callback);
}


//For testing only
DataManager.prototype.
getDocCallback = function(buff, localDM){
	if(buff)
		localDM.LOG(["getDoc result: " , buff.length].join());
	//	this.LOG("Size of all buffers: " + appendArrayOfBuffers(buff).byteLength );
}

