var http = require('http')
var url = require('url')
var sys = require("sys")
var fs = require("fs")
var path = require('path')
var formidable = require('formidable')
var util = require('util')
var lazy = require("lazy")

var google = require("./lib/google");
var store = require("./lib/storage");

var HOST = 'localhost';
var PORT = 8081;
var CLIENT_PATH = 'client';

var mimeTypes = {
    "html": "text/html",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "js": "text/javascript",
    "css": "text/css",
    "tcx": "application/tcx+xml"};


// Wipe previous upload data on startup - DISABLED for testing
// deleteUploadDir(); 

var server = http.createServer(function (request, response) {
  
  var url_parts = url.parse(request.url, true);
  var path_name = url_parts.pathname;
  
  var adjust_mode = url_parts.query['adjust_mode'];
  if ((adjust_mode + '') == '[object Event]') {
	 adjust_mode = null;
  }
  
  // API request of JSON data for file_id
  if (path_name.indexOf('/data/') === 0) {
 	 var file_id = path_name.substring('/data/'.length);
 	 
  	 handleJSONDataRequest(request, response, file_id, adjust_mode);
  	 return;
  }
  
  // Handle file upload and external redirect to /uploads/[file_id]
  if (path_name === '/uploads' && request.method.toLowerCase() == 'post') {
  	upload_TCX_Data(request, response);
  	return;
  }
  
  // Internal redirect for /uploads/[file_id]
  if (path_name.indexOf('/uploads/') === 0) {
	path_name = '/view_upload.html';
  }
  
  // File export
  if (path_name.indexOf('/export/') === 0) {
	  var file_id = url_parts.query.file_id;
	  sys.debug("Exporting file " + file_id + " with adjust mode " + adjust_mode);
	  export_adjusted_TCX(response, file_id, adjust_mode);
	  return;
  }
  
  // Default page
  if (!path_name || path_name == '/') {
	path_name = '/index.html';
  }
  
  serve_static_resource(request, response, path_name);
  
})

server.listen(PORT, HOST);


// =============================================================================================

// Write upload to disk and redirect to /uploads/[file_id]
function upload_TCX_Data(req, res) {
	
	if (!fs.existsSync(store.UPLOAD_DIR)) {
  		fs.mkdirSync(store.UPLOAD_DIR);
	}
	
	var form = new formidable.IncomingForm();
	
	form.uploadDir = store.UPLOAD_DIR;
	form.keepExtensions = false;
    form.parse(req, function(err, fields, files) {
      	var tempFile = files.gpsdata.path;
      	var file_id = tempFile.substring(store.UPLOAD_DIR.length + 1);

	    sys.debug('received upload of file: ' + file_id + ' ' + files.gpsdata.name);
      	
      	store.store_file_info(file_id, files.gpsdata);
      	
      	var file_url = 'http://' +req.headers.host + '/' + store.UPLOAD_DIR + '/'+file_id;
      	
      	sys.debug('Redirecting to ' + file_url);
      	res.writeHead(301, {'Location': file_url} );
		res.end();
    });
}

// Fetch all relevant data including latitude, longitude, uploaded elevation, 
// and google elevation for the given file_id as a JSON object.
function handleJSONDataRequest(req, res, file_id, adjust_mode) {
	loadOrProcessData(res, file_id, function(err, data) {
		if (err) {
	        sys.error(util.inspect(err));
			show_error(res, 501, 'Internal error attempting to read parsed upload.');
			return;
		}
		
		if (!doAdjustment(res, data, adjust_mode)) {
			return;
		}
		
        res.writeHead(200, {'Content-Type': 'text/javascript'});
        res.end(JSON.stringify(data));
    })
}

function loadOrProcessData(response, file_id, callback) {
	// Verify file was uploaded
	var file_name = path.join(process.cwd(), store.UPLOAD_DIR, file_id);
	if (!fs.existsSync(file_name)) {
  		callback('404 - Not an upload: ' + file_id);
        return;
	}
	
	store.loadProcessedData(file_id, function(err, fileData) {
	   if (!err) {
	        // Used cached parsed/Google data
	        callback(null, fileData);
	   } else {
	       if (err.code != 'ENOENT') {
	         sys.error(util.inspect(err));
	         callback(err);
	         return;
	       }
	       
	       // File not yet parsed, do it now
	       processUpload(response, file_id, function(returnData) {
	    	   callback(null, returnData);
	       });
	   }
	})
}

function processUpload(res, file_id, parse_callback) {	

    store.parseUpload(file_id, function(err, data) {  
            if (err) {
             sys.error(util.inspect(err));
             show_error(response, 501, 'Server error.');
             return;
           }
              
            data.googleElevation = [];  		
       		var nextUnfetchedIndex = 0;
       		var GoogleCallback = function(lastIndexProcessed, returnData) {
               if (lastIndexProcessed >= returnData.latitude.length - 1) {
                    store.savedProcessedData(file_id, data);
                    parse_callback(data);
                    return;
                }
                
                nextUnfetchedIndex = Math.min(lastIndexProcessed + 1, returnData.latitude.length);
                google.getGoogleElevations(res, returnData, nextUnfetchedIndex, GoogleCallback);
            }
            
       		google.getGoogleElevations(res, data, nextUnfetchedIndex, GoogleCallback);  		
	})
}

function doAdjustment(response, data, adjust_mode) {
	// Default
	if (!adjust_mode) {
		adjust_mode = 'FixedBestFit';
	}
	
	if (adjust_mode == 'UseGoogle') {
		data.adjustedElevation = data.googleElevation;
	} else if (adjust_mode == 'FixedBestFit') {
		fixedShiftAdjustment(data, 0, data.latitude.length - 1);
	} else if (adjust_mode == 'FixedBestFitPartition') {
		fixedShiftPartitionedAdjustment(data);
	} else {
		show_error(response, 400, 'Invalid adjustment mode paramater.');
		return false;
	}
	
	return true;
}

function fixedShiftPartitionedAdjustment(data) {
    var start = 0;
    var end = 0;
    
    var lastDistance = data.distance[0];
    var lastElevation = data.uploadElevation[0];
    var samePointStart = null;
    
    for (end = 1; end < data.uploadElevation.length; end++) {
        var distance = data.distance[end];
        var elevation = data.uploadElevation[end];
        
        var distanceDelta = (distance - lastDistance) * 1000; //km > m
        var elevationDelta = elevation - lastElevation;
        
        lastDistance = distance;
        lastElevation = elevation;
        
        if (!distanceDelta) {    
            
            if (Math.abs(elevationDelta) < 5) {
                continue;
            }
            
                    
            if (!samePointStart) {
                samePointStart = end;
                sys.debug("Same point elevation discrepancy of " + elevationDelta + "m at " + distance + "km, partitioning");
                fixedShiftAdjustment(data, start, end - 1);
                start = end;
            }

        } else {      
            //TODO: This is supposing that distance has been recorded via bike sensor and not GPS  
            var horizDistance = Math.sqrt(Math.pow(distanceDelta,2) - Math.pow(elevationDelta,2));
	        var grade = 100 * elevationDelta / horizDistance;
	        if (grade > 40 || grade < -60) {
	            sys.debug("Suspicious grade of " + grade + " at " + distance + "km, v. delta " + elevationDelta +"m, h. delta " + distanceDelta + ", partitioning");
	            fixedShiftAdjustment(data, start, end - 1);
	            start = end;
	        }
            
            samePointStart = null;
	    }
    }
    
    fixedShiftAdjustment(data, start, data.uploadElevation.length - 1);
}

function fixedShiftAdjustment(data, start, end, bias) {
    if (start > end) {
      return;
    }

    // Initialize adjustment data
    if (!data.adjustedElevation) {
        data.adjustedElevation = [];
        data.elevationDelta = [];
        for (var i = 0; i < start; i++) {
            data.adjustedElevation[i] = data.uploadElevation[i];
            data.elevationDelta[i] = 0;
        }
        for (var i = end + 1; i < data.uploadElevation.length; i++) {
            data.adjustedElevation[i] = data.uploadElevation[i];
            data.elevationDelta[i] = 0;
        }
    }
    
    var maxDeltaIndex = 0;
    var inclusionGroup = [];
    var maxInclusion = Math.max(1, Math.round((end - start) * 0.25));
    for (var i = start; i <= end; i++) {
    	var inclusionIndex = i - start;
        var delta = data.googleElevation[i] - data.uploadElevation[i];
        data.elevationDelta[i] = delta;
        
        if (inclusionIndex < maxInclusion) {
        	inclusionGroup.push(delta);
            if (Math.abs(delta) > Math.abs(inclusionGroup[maxDeltaIndex])) {
            	maxDeltaIndex = inclusionIndex;
            }
            
        } else {
        	if (Math.abs(delta) < Math.abs(inclusionGroup[maxDeltaIndex])) {
	        	inclusionGroup[maxDeltaIndex] = delta;
	        	for (var j = 0; j < maxInclusion; j++) {
	        		if (Math.abs(inclusionGroup[j]) > Math.abs(inclusionGroup[maxDeltaIndex])) {
	                	maxDeltaIndex = j;
	                }
	        	}
        	}
        }
    }
    
    // sys.debug(util.inspect(inclusionGroup));
    
    var cummulativeDelta = 0;
    for (var i = 0; i < maxInclusion; i++) {
    	cummulativeDelta += inclusionGroup[i];
    } 

    var fixedAdjustment = cummulativeDelta / maxInclusion;
    if (bias) {
        fixedAdjustment += bias;
    }
    
    sys.debug("Fixed adjustment: From " + start + ":" +  data.distance[start] + " to " + end + ":" + data.distance[end] + " shifted " + fixedAdjustment + "m using " + maxInclusion + " min delta points");
    for (var i = start; i <= end; i++) {
    	data.adjustedElevation[i] = data.uploadElevation[i] + fixedAdjustment;
    } 
}

/*
 * Return the original TCX file content but with elevations replaced with
 * adjusted values.
 */
function export_adjusted_TCX(response, file_id, adjust_mode) {
	var latElStart = '<LatitudeDegrees>';
	var latElEnd = '</LatitudeDegrees>';
	var longElStart = '<LongitudeDegrees>';
	var longElEnd = '</LongitudeDegrees>';
	var altStart = '<AltitudeMeters>';
	var altEnd = '</AltitudeMeters>';
	
	loadOrProcessData(response, file_id, function(err, data) {
		if (err) {
	        sys.error(util.inspect(err));
			show_error(response, 501, 'Internal error attempting to read parsed upload.');
			return;
		}
		
		if (!doAdjustment(response, data, adjust_mode)) {
			return;
		}
		
		var file_name = path.join(process.cwd(), store.UPLOAD_DIR, file_id);

		var tpIndex = 0;
		var lastLat = null;
		var lastLong = null;
		var replacementCount = 0;
		
		var wroteHeader = false;
		new lazy(fs.createReadStream(file_name)).lines.forEach(function(line){
			if (!wroteHeader) {
				response.writeHead(200, {'Content-Type': 'application/tcx+xml'});
				wroteHeader = true;
			}
			
			var line = line.toString();
			if (line.indexOf('<Trackpoint>') != -1) {
				// Don't advanced index for track-points with no position
				if (lastLat != null && lastLong != null) {
					tpIndex++;
				}
				
			    lastLat = null;
				lastLong = null;
			} else if (line.indexOf(latElStart) != -1) {
				var value = line.substring(line.indexOf(latElStart) + latElStart.length, line.indexOf(latElEnd));
				lastLat = parseFloat(value);
			} else if (line.indexOf(longElStart) != -1) {
				var value = line.substring(line.indexOf(longElStart) + longElStart.length, line.indexOf(longElEnd));
				lastLong = parseFloat(value);
			} else if (line.indexOf(altStart) != -1) {
				var value = line.substring(line.indexOf(altStart) + altStart.length, line.indexOf(altEnd));
				var elevation = value;
				
				var dataLat = data.latitude[tpIndex];
				var dataLong = data.longitude[tpIndex];
				var dataElevation = data.uploadElevation[tpIndex];
				
				if (dataLat === lastLat && dataLong === lastLong && parseFloat(dataElevation) == elevation) {
					var newElevation = data.adjustedElevation[tpIndex];
					var replacedLine = line.replace(elevation, newElevation);
					response.write(replacedLine + "\n");
					replacementCount++;
					return;
			    }
			}
			
			response.write(line.toString() + "\n");
		}).join(function() {
			sys.debug('Exported file ' + file_id + ' with ' + replacementCount + ' adjustments.');
			response.end();
		});
    })
}

function serve_static_resource(req, res, uri) {
    var filename = path.join(process.cwd(), CLIENT_PATH, uri);
    fs.exists(filename, function(exists) {
        if(!exists) {
        	sys.log("404 Not Found - " + filename);
            show_error(res,404,"404 Not Found");
            return;
        }
        
        
        var extension = path.extname(filename).split(".")[1];
        var mimeType = mimeTypes[extension.toLowerCase()];

        sys.log("Serving file: " + filename + ' with mime/type ' + mimeType);
        res.writeHead(200, mimeType);

        var fileStream = fs.createReadStream(filename);
        fileStream.pipe(res);
        return fileStream;
    });
}




function show_error(response, errorCode, message) {
	sys.log("Error: " + errorCode + ' - ' + message);
    response.writeHead(errorCode, {'Content-Type': 'text/html'});
    response.write('<title>Error ' + errorCode + '</title>');
    response.write('<p>' + message + '<\p>');
  	response.end();
}


// http://maps.googleapis.com/maps/api/elevation/json?locations=49.31643,-123.137&sensor=true
