importScripts('pako.min.js');


function inflateBlob(e) {

	var reader = new FileReaderSync();
	var arrayBuffer = reader.readAsArrayBuffer(e.data.data);
//	console.log(arrayBuffer)

	if (e.data.toString){
		var restored = pako.inflate(arrayBuffer, { to: 'string' });
		self.postMessage(restored);

	}else {
		var restored = pako.inflate(arrayBuffer); 
		//			self.postMessage(restored.buffer,[restored.buffer]);
		self.postMessage(restored);//,[restored.buffer]);
	}
	close();

}

function inflateBlobAsync(e) {// Doesn't work in FF. Fileread in workers is slower?!

	var fileReader = new FileReader();  
	fileReader.onload = function(res){
		var arrayBuffer = this.result;

		if (e.data.toString){
			var restored = pako.inflate(arrayBuffer, { to: 'string' });
			self.postMessage(restored);

		}else {
			var restored = pako.inflate(arrayBuffer); 
			//			self.postMessage(restored.buffer,[restored.buffer]);
			self.postMessage(restored);//,[restored.buffer]);
		}
		close();

	};
	fileReader.readAsArrayBuffer(e.data.data);

}

onmessage = function (e) {
	inflateBlob(e);
};
